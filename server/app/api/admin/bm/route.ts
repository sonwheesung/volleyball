// /api/admin/bm — ⑤ BM(수익화) 원장 파생분(실데이터). requireAdmin(fail-closed §13.15).
//   [자체-롤업]만: walletLedger(reason='purchase', ref=productId)에서 상품별 **다이아 지급 건수·합·결제자 수** + 결제전환(고유 payer/총가입).
//   ※ ARPU/ARPPU/상품별 매출액(KRW)은 RevenueCat 연동(#43) 후 [외부-sync] — 여기 없음(ANALYTICS_PLAN §6.2 ⑤). KRW 매출은 statsDaily(=0)·series metric=revenue.
//   결정론 격리(§8): 순수 메타 집계 — 시드/리플레이 무관.
import { NextResponse } from 'next/server';
import { and, eq, gte, isNull, count } from 'drizzle-orm';
import { db } from '../../../../db';
import { users, walletLedger } from '../../../../db/schema';
import { isAdmin } from '../../../../lib/admin';
import { PROJ_CODE } from '../../../../lib/proj';
import { reportError } from '../../../../lib/observability';

export const dynamic = 'force-dynamic';

// 조회 윈도우(일 단위) — 상품별 집계는 시계열이 아니라 기간 합계. 일/주/월 토글은 윈도우 폭만 바꾼다.
const WIN_DAYS: Record<string, number> = { day: 30, week: 84, month: 365 };

export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const url = new URL(req.url);
    const gran = url.searchParams.get('granularity') || 'day';
    const winDays = WIN_DAYS[gran] ?? 30;
    const from = new Date(Date.now() - winDays * 86400000);

    // 상품별 다이아 지급(reason='purchase', ref=productId) — 건수·다이아 합·고유 결제자
    const rows = await db.select({ ref: walletLedger.ref, delta: walletLedger.delta, userId: walletLedger.userId, createdAt: walletLedger.createdAt })
      .from(walletLedger)
      .where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.reason, 'purchase'), gte(walletLedger.createdAt, from)));
    const byRef = new Map<string, { grants: number; diamonds: number; payers: Set<string> }>();
    const allPayers = new Set<string>();
    for (const r of rows) {
      const key = r.ref || '(미지정)';
      let e = byRef.get(key); if (!e) { e = { grants: 0, diamonds: 0, payers: new Set() }; byRef.set(key, e); }
      e.grants++; e.diamonds += Math.max(0, r.delta); e.payers.add(r.userId); allPayers.add(r.userId);
    }
    const products = Array.from(byRef.entries())
      .map(([productId, v]) => ({ productId, grants: v.grants, diamonds: v.diamonds, payers: v.payers.size }))
      .sort((a, b) => b.grants - a.grants);

    // 결제전환(윈도우 무관 전체) — 고유 결제자 / 총가입(비삭제)
    const payerAll = await db.selectDistinct({ u: walletLedger.userId }).from(walletLedger)
      .where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.reason, 'purchase')));
    const [tot] = await db.select({ n: count() }).from(users).where(and(eq(users.projCode, PROJ_CODE), isNull(users.deletedAt)));
    const totalUsers = tot?.n ?? 0;
    const payers = payerAll.length;
    const conversion = totalUsers > 0 ? Math.round((payers / totalUsers) * 1000) / 10 : 0;

    return NextResponse.json({ ok: true, gran, winDays, products, windowPayers: allPayers.size, payers, totalUsers, conversion });
  } catch (e) {
    reportError(e, 'admin/bm');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
