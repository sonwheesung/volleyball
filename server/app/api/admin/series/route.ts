// /api/admin/series — 관리자 시계열(매출·광고·환불) 일/주/월/연 집계. requireAdmin(fail-closed §13.15).
//   metric=revenue: statsDaily 롤업(매출·결제건수). metric=ad|refund: walletLedger 이벤트(건수·고유유저·다이아).
//   버킷: day 30 · week 12 · month 12 · year 5. 전부 UTC 경계.
import { NextResponse } from 'next/server';
import { and, eq, gte } from 'drizzle-orm';
import { db } from '../../../../db';
import { statsDaily, walletLedger } from '../../../../db/schema';
import { isAdmin } from '../../../../lib/admin';
import { PROJ_CODE } from '../../../../lib/proj';
import { reportError } from '../../../../lib/observability';

export const dynamic = 'force-dynamic';

type Gran = 'day' | 'week' | 'month' | 'year';
const N: Record<Gran, number> = { day: 30, week: 12, month: 12, year: 5 };
const MD = (t: number) => { const d = new Date(t); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; };

function buildBuckets(gran: Gran, now: Date): { label: string; start: number; end: number }[] {
  const out: { label: string; start: number; end: number }[] = [];
  const n = N[gran];
  const Y = now.getUTCFullYear(), M = now.getUTCMonth(), D = now.getUTCDate();
  const today = Date.UTC(Y, M, D);
  if (gran === 'day') {
    for (let i = n - 1; i >= 0; i--) { const s = today - i * 86400000; out.push({ label: MD(s), start: s, end: s + 86400000 }); }
  } else if (gran === 'week') {
    for (let i = n - 1; i >= 0; i--) { const e = today - (i * 7 - 1) * 86400000; const s = e - 7 * 86400000; out.push({ label: MD(s), start: s, end: e }); }
  } else if (gran === 'month') {
    for (let i = n - 1; i >= 0; i--) { const s = Date.UTC(Y, M - i, 1); const e = Date.UTC(Y, M - i + 1, 1); out.push({ label: `${new Date(s).getUTCFullYear()}-${String(new Date(s).getUTCMonth() + 1).padStart(2, '0')}`, start: s, end: e }); }
  } else {
    for (let i = n - 1; i >= 0; i--) { const s = Date.UTC(Y - i, 0, 1); const e = Date.UTC(Y - i + 1, 0, 1); out.push({ label: String(new Date(s).getUTCFullYear()), start: s, end: e }); }
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

    if (metric === 'revenue') {
      const fromDay = new Date(bk[0].start).toISOString().slice(0, 10);
      const sd = await db.select().from(statsDaily).where(and(eq(statsDaily.projCode, PROJ_CODE), gte(statsDaily.day, fromDay)));
      const revenue = new Array(bk.length).fill(0), purchases = new Array(bk.length).fill(0);
      for (const s of sd) { const i = bidx(bk, Date.parse(`${String(s.day)}T00:00:00Z`)); if (i >= 0) { revenue[i] += s.revenueKrw; purchases[i] += s.purchaseCount; } }
      return NextResponse.json({ ok: true, metric, gran, labels, revenue, purchases });
    }
    if (metric === 'ad' || metric === 'refund') {
      const rows = await db.select({ c: walletLedger.createdAt, u: walletLedger.userId, d: walletLedger.delta }).from(walletLedger)
        .where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.reason, metric), gte(walletLedger.createdAt, new Date(bk[0].start))));
      const cnt = new Array(bk.length).fill(0), diamonds = new Array(bk.length).fill(0);
      const uset = bk.map(() => new Set<string>());
      for (const r of rows) { if (!r.c) continue; const i = bidx(bk, r.c.getTime()); if (i >= 0) { cnt[i]++; uset[i].add(r.u); diamonds[i] += Math.abs(r.d); } }
      return NextResponse.json({ ok: true, metric, gran, labels, count: cnt, users: uset.map((s) => s.size), diamonds });
    }
    return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
  } catch (e) {
    reportError(e, 'admin/series');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
