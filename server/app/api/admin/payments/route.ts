// /api/admin/payments — 원장 이벤트 조회. requireAdmin(fail-closed §13.15).
//   원천: walletLedger — 시각·유저·종류·다이아(delta)·상품/메모(ref)·적용후잔액.
//   두 모드:
//     ① 결제 퍼널(기존): `kind`=all|purchase|refund → purchase/refund만(BM 결제·환불 내역).
//     ② 유저 원장 조회(2026-07-16, P2-c §13.26): `reason`(8종 중 1 또는 'all')+`userId`+`since` → 전 reason 원장 + **합계(sum)**.
//        §13.26 백업 보상(백업 시점 이후 camp 차감 합)을 콘솔만으로 산출 → 개인 쿠폰 발급까지 완결(curl 제거).
//   ※ 건별 KRW는 결제검증(#43·statsDaily) 후. 여기 delta는 다이아 기준.
import { NextResponse } from 'next/server';
import { and, desc, eq, inArray, count, gte, sql, type SQL } from 'drizzle-orm';
import { db } from '../../../../db';
import { walletLedger } from '../../../../db/schema';
import { isAdmin } from '../../../../lib/admin';
import { PROJ_CODE } from '../../../../lib/proj';
import { reportError } from '../../../../lib/observability';

export const dynamic = 'force-dynamic';
const FUNNEL_KINDS = ['purchase', 'refund'];
// 원장 조회 모드에서 허용하는 reason(사칭·오타 방어). 'all'=제약 없음(전 reason).
const LEDGER_REASONS = new Set(['purchase', 'refund', 'camp', 'adjust', 'ad', 'achievement', 'coupon', 'welcome']);

export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const url = new URL(req.url);
    const reasonParam = url.searchParams.get('reason'); // 있으면 원장 조회 모드(②)
    const userId = url.searchParams.get('userId') || '';
    const sinceRaw = url.searchParams.get('since') || ''; // ISO 날짜/시각
    const kind = url.searchParams.get('kind') || 'all';   // 퍼널 모드(①)
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

    const conds: SQL[] = [eq(walletLedger.projCode, PROJ_CODE)];
    const ledgerMode = reasonParam !== null; // reason 파라미터 존재 = 원장 조회 모드
    if (ledgerMode) {
      // ② 원장 조회: reason(8종/‘all’) + userId + since. 'all'이면 reason 제약 없음.
      if (reasonParam !== 'all') {
        if (!LEDGER_REASONS.has(reasonParam)) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
        conds.push(eq(walletLedger.reason, reasonParam));
      }
    } else {
      // ① 결제 퍼널: kind=all→purchase+refund, 또는 단일.
      const kinds = kind === 'purchase' ? ['purchase'] : kind === 'refund' ? ['refund'] : FUNNEL_KINDS;
      conds.push(inArray(walletLedger.reason, kinds));
    }
    if (userId) conds.push(eq(walletLedger.userId, userId));
    if (sinceRaw) {
      const since = new Date(sinceRaw);
      if (Number.isNaN(since.getTime())) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
      conds.push(gte(walletLedger.createdAt, since));
    }
    const where = and(...conds);

    // 총건수 + delta 합계(§13.26 보상 계산 — 페이지 아닌 필터 전체 합).
    const [agg] = await db
      .select({ n: count(), sum: sql<number>`coalesce(sum(${walletLedger.delta}), 0)::int` })
      .from(walletLedger).where(where);
    const rows = await db
      .select({ id: walletLedger.id, userId: walletLedger.userId, reason: walletLedger.reason, delta: walletLedger.delta, ref: walletLedger.ref, balanceAfter: walletLedger.balanceAfter, createdAt: walletLedger.createdAt })
      .from(walletLedger).where(where).orderBy(desc(walletLedger.createdAt)).limit(limit).offset(offset);

    return NextResponse.json({ ok: true, total: agg?.n ?? 0, sum: agg?.sum ?? 0, limit, offset, payments: rows });
  } catch (e) {
    reportError(e, 'admin/payments');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
