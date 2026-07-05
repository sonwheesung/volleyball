// GET /api/admin/payment-events — 결제 이벤트 감사 로그 조회(§13.22). requireAdmin(fail-closed §13.15).
//   원천: purchase_event(단계별 진단). 필터: source·onlyFail(실패만)·txn(storeTxnId로 한 결제 추적)·reason. 페이지네이션.
//   "돈 내고 0개" 감사: txn=스토어거래id로 조회 → 시간순 단계(purchase→confirm/webhook grant.applied|deduped) 재구성.
import { NextResponse } from 'next/server';
import { and, desc, eq, count } from 'drizzle-orm';
import { db } from '../../../../db';
import { purchaseEvent } from '../../../../db/schema';
import { isAdmin } from '../../../../lib/admin';
import { PROJ_CODE } from '../../../../lib/proj';
import { reportError } from '../../../../lib/observability';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const url = new URL(req.url);
    const source = url.searchParams.get('source'); // client|webhook|confirm
    const txn = url.searchParams.get('txn');       // storeTxnId(한 결제 추적)
    const onlyFail = url.searchParams.get('fail') === '1';
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

    const conds = [eq(purchaseEvent.projCode, PROJ_CODE)];
    if (source === 'client' || source === 'webhook' || source === 'confirm') conds.push(eq(purchaseEvent.source, source));
    if (txn) conds.push(eq(purchaseEvent.storeTxnId, txn));
    if (onlyFail) conds.push(eq(purchaseEvent.ok, false));
    const where = and(...conds);

    const [tot] = await db.select({ n: count() }).from(purchaseEvent).where(where);
    const rows = await db
      .select({
        id: purchaseEvent.id, createdAt: purchaseEvent.createdAt, source: purchaseEvent.source, stage: purchaseEvent.stage,
        ok: purchaseEvent.ok, outcome: purchaseEvent.outcome, reasonCode: purchaseEvent.reasonCode, errorMessage: purchaseEvent.errorMessage,
        userId: purchaseEvent.userId, storeTxnId: purchaseEvent.storeTxnId, rcEventId: purchaseEvent.rcEventId, requestId: purchaseEvent.requestId,
        eventType: purchaseEvent.eventType, productId: purchaseEvent.productId, diamondsDelta: purchaseEvent.diamondsDelta, balanceAfter: purchaseEvent.balanceAfter,
        price: purchaseEvent.price, currency: purchaseEvent.currency, environment: purchaseEvent.environment, platform: purchaseEvent.platform, appVersion: purchaseEvent.appVersion, detail: purchaseEvent.detail,
      })
      // txn 추적은 시간순(오래→최신)으로 단계 재구성, 그 외는 최신순.
      .from(purchaseEvent).where(where).orderBy(txn ? purchaseEvent.createdAt : desc(purchaseEvent.createdAt)).limit(limit).offset(offset);

    return NextResponse.json({ ok: true, total: tot?.n ?? 0, limit, offset, events: rows });
  } catch (e) {
    reportError(e, 'admin/payment-events');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
