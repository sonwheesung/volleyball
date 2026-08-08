// /api/admin/series — 관리자 시계열(가입·매출·광고·환불) 일/주/월/연 집계. requireAdmin(fail-closed §13.15).
//   metric=signups: users.createdAt 버킷(① 사용자 현황). metric=revenue: statsDaily 롤업(매출·결제건수).
//   metric=ad|refund: walletLedger 이벤트(건수·고유유저·다이아). 버킷: day 30 · week 12 · month 12 · year 5. 전부 UTC 경계.
import { NextResponse } from 'next/server';
import { and, eq, gte } from 'drizzle-orm';
import { db } from '../../../../db';
import { statsDaily, walletLedger, users } from '../../../../db/schema';
import { isAdmin } from '../../../../lib/admin';
import { PROJ_CODE } from '../../../../lib/proj';
import { reportError } from '../../../../lib/observability';
import { internalScope, isExcluded, internalMeta } from '../../../../lib/internalScope';
import { kstMd } from '../../../../lib/dates';

export const dynamic = 'force-dynamic';

type Gran = 'day' | 'week' | 'month' | 'year';
const N: Record<Gran, number> = { day: 30, week: 12, month: 12, year: 5 };
// 버킷 경계·라벨은 **KST**(§13.15 시간대 정정 2026-08-08). 종전 UTC 경계는 한국 기준 오전 9시에 하루가 바뀌었다.
const KST_MS = 9 * 60 * 60_000;
const MD = (kstWall: number) => kstMd(new Date(kstWall - KST_MS)); // 인자는 KST 벽시계(UTC 필드로 표현) → 실제 순간으로 되돌려 라벨

// ★ 계산은 **KST 벽시계 공간**(now+9h 의 UTC 필드)에서 하고, 경계값만 -9h 해서 실제 UTC 순간으로 되돌린다.
//   이렇게 해야 "월/연 경계"까지 한국 달력과 맞는다(단순히 9시간 빼는 방식은 월말·연말에 어긋난다).
function buildBuckets(gran: Gran, now: Date): { label: string; start: number; end: number }[] {
  const out: { label: string; start: number; end: number }[] = [];
  const n = N[gran];
  const k = new Date(now.getTime() + KST_MS); // KST 벽시계
  const Y = k.getUTCFullYear(), M = k.getUTCMonth(), D = k.getUTCDate();
  const today = Date.UTC(Y, M, D);
  const utc = (kstWall: number) => kstWall - KST_MS; // KST 벽시계 → 실제 UTC 순간
  if (gran === 'day') {
    for (let i = n - 1; i >= 0; i--) { const s = today - i * 86400000; out.push({ label: MD(s), start: utc(s), end: utc(s + 86400000) }); }
  } else if (gran === 'week') {
    for (let i = n - 1; i >= 0; i--) { const e = today - (i * 7 - 1) * 86400000; const s = e - 7 * 86400000; out.push({ label: MD(s), start: utc(s), end: utc(e) }); }
  } else if (gran === 'month') {
    for (let i = n - 1; i >= 0; i--) { const s = Date.UTC(Y, M - i, 1); const e = Date.UTC(Y, M - i + 1, 1); out.push({ label: `${new Date(s).getUTCFullYear()}-${String(new Date(s).getUTCMonth() + 1).padStart(2, '0')}`, start: utc(s), end: utc(e) }); }
  } else {
    for (let i = n - 1; i >= 0; i--) { const s = Date.UTC(Y - i, 0, 1); const e = Date.UTC(Y - i + 1, 0, 1); out.push({ label: String(new Date(s).getUTCFullYear()), start: utc(s), end: utc(e) }); }
  }
  return out;
}
const bidx = (bk: { start: number; end: number }[], t: number): number => { for (let i = 0; i < bk.length; i++) if (t >= bk[i].start && t < bk[i].end) return i; return -1; };

export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const url = new URL(req.url);
    const metric = url.searchParams.get('metric') || 'revenue';
    const gran = (url.searchParams.get('granularity') || 'day') as Gran;
    if (!(['day', 'week', 'month', 'year'] as string[]).includes(gran)) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    const bk = buildBuckets(gran, new Date());
    const labels = bk.map((b) => b.label);

    const scope = await internalScope(req); // §13.30 — 내부 계정 제외(signups·ad·refund. revenue는 사전 롤업이라 불가)

    if (metric === 'signups') {
      // ① 사용자 현황 — 가입 수(신규/일주월). 소프트삭제 포함(가입은 일어난 사실 — 총 유입).
      const rows = await db.select({ c: users.createdAt }).from(users)
        .where(and(eq(users.projCode, PROJ_CODE), gte(users.createdAt, new Date(bk[0].start)),
          ...(scope.includeInternal ? [] : [eq(users.internal, false)])));
      const count = new Array(bk.length).fill(0);
      for (const r of rows) { if (!r.c) continue; const i = bidx(bk, r.c.getTime()); if (i >= 0) count[i]++; }
      return NextResponse.json({ ok: true, metric, gran, labels, count, internal: internalMeta(scope) });
    }
    if (metric === 'revenue') {
      // statsDaily.day 는 **KST 달력일**(라이터도 KST — revenuecat/retention). 조회 하한도 같은 규약으로 맞춘다.
      const fromDay = new Date(bk[0].start + KST_MS).toISOString().slice(0, 10);
      const sd = await db.select().from(statsDaily).where(and(eq(statsDaily.projCode, PROJ_CODE), gte(statsDaily.day, fromDay)));
      const revenue = new Array(bk.length).fill(0), purchases = new Array(bk.length).fill(0);
      for (const s of sd) { const i = bidx(bk, Date.parse(`${String(s.day).slice(0, 10)}T00:00:00Z`) - KST_MS); if (i >= 0) { revenue[i] += s.revenueKrw; purchases[i] += s.purchaseCount; } }
      // ⚠ statsDaily는 userId 없는 사전 롤업이라 내부 계정을 못 뺀다(§13.30 E) — 응답에 그대로 고지.
      return NextResponse.json({ ok: true, metric, gran, labels, revenue, purchases, internal: internalMeta(scope, ['revenue', 'purchases']) });
    }
    if (metric === 'ad' || metric === 'refund') {
      const rows = await db.select({ c: walletLedger.createdAt, u: walletLedger.userId, d: walletLedger.delta }).from(walletLedger)
        .where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.reason, metric), gte(walletLedger.createdAt, new Date(bk[0].start))));
      const cnt = new Array(bk.length).fill(0), diamonds = new Array(bk.length).fill(0);
      const uset = bk.map(() => new Set<string>());
      for (const r of rows) { if (!r.c) continue; if (isExcluded(scope, r.u)) continue; // §13.30
        const i = bidx(bk, r.c.getTime()); if (i >= 0) { cnt[i]++; uset[i].add(r.u); diamonds[i] += Math.abs(r.d); } }
      return NextResponse.json({ ok: true, metric, gran, labels, count: cnt, users: uset.map((s) => s.size), diamonds, internal: internalMeta(scope) });
    }
    return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
  } catch (e) {
    reportError(e, 'admin/series');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
