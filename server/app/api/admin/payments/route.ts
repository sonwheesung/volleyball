// /api/admin/payments — 개별 결제/환불 내역(원장 이벤트). requireAdmin(fail-closed §13.15).
//   원천: walletLedger(reason in purchase|refund) — 시각·유저·종류·다이아(delta)·상품(ref)·적용후잔액.
//   ※ 건별 KRW 금액은 결제 검증(#43·Purchase 테이블) 후 붙는다(현재는 다이아 기준 이벤트).
import { NextResponse } from 'next/server';
import { and, desc, eq, inArray, count } from 'drizzle-orm';
import { db } from '../../../../db';
import { walletLedger } from '../../../../db/schema';
import { isAdmin } from '../../../../lib/admin';
import { PROJ_CODE } from '../../../../lib/proj';
import { reportError } from '../../../../lib/observability';

export const dynamic = 'force-dynamic';
const KINDS = ['purchase', 'refund'];

export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const url = new URL(req.url);
    const kind = url.searchParams.get('kind') || 'all'; // all | purchase | refund
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const kinds = kind === 'purchase' ? ['purchase'] : kind === 'refund' ? ['refund'] : KINDS;
    const where = and(eq(walletLedger.projCode, PROJ_CODE), inArray(walletLedger.reason, kinds));

    const [tot] = await db.select({ n: count() }).from(walletLedger).where(where);
    const rows = await db
      .select({ id: walletLedger.id, userId: walletLedger.userId, reason: walletLedger.reason, delta: walletLedger.delta, ref: walletLedger.ref, balanceAfter: walletLedger.balanceAfter, createdAt: walletLedger.createdAt })
      .from(walletLedger).where(where).orderBy(desc(walletLedger.createdAt)).limit(limit).offset(offset);

    return NextResponse.json({ ok: true, total: tot?.n ?? 0, limit, offset, payments: rows });
  } catch (e) {
    reportError(e, 'admin/payments');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
