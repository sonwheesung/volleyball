// POST /api/purchase/webhook/revenuecat — RC 결제 웹훅(BACKEND_SYSTEM §13.18). Authorization 시크릿 검증(fail-closed).
// RC → 이 웹훅 → decidePurchaseEvent(순수) → applyWallet(+/−다이아, 멱등키=스토어거래id) → (지급 적용 시) 매출 롤업.
// 소모성 다이아만 원장 지급. 엔타이틀먼트(광고제거·DLC)는 RC customerInfo 소유라 무시. 샌드박스 무시.
import { NextResponse } from 'next/server';
import { applyWallet } from '../../../../../lib/wallet';
import { verifyWebhookAuth, decidePurchaseEvent, purchaseKey, refundKey, recordPurchaseRevenue } from '../../../../../lib/revenuecat';
import { reportError } from '../../../../../lib/observability';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  // 인증 실패면 401(RC가 재시도 안 하게 — 위조 방지). fail-closed: 시크릿 미설정도 거부.
  if (!verifyWebhookAuth(req.headers.get('authorization'))) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }
  try {
    const body = (await req.json()) as { event?: unknown };
    const d = decidePurchaseEvent(body?.event);
    if (d.action === 'ignore') return NextResponse.json({ ok: true, ignored: d.reason });

    const grant = d.action === 'grant';
    const key = grant ? purchaseKey(d.userId, d.storeTxnId) : refundKey(d.userId, d.storeTxnId);
    const delta = grant ? d.diamonds : -d.diamonds; // 환불은 음수(applyWalletTx가 refund만 음수잔액 허용)
    const r = await applyWallet(d.userId, delta, grant ? 'purchase' : 'refund', key, d.productId);
    if (!r.ok) {
      // 유저 미존재(FK)·DB 오류 등 → 500으로 RC 재시도 유도(confirm 폴백도 별도 수렴). 위조 아님.
      return NextResponse.json({ ok: false, reason: r.reason }, { status: 500 });
    }
    // 매출 롤업은 **실제 적용된 지급**만(멱등 — 웹훅 재시도/폴백 중복 시 이중집계 방지).
    if (grant && r.applied) await recordPurchaseRevenue(d.priceKrw, d.diamonds);
    return NextResponse.json({ ok: true, applied: r.applied, balance: r.balance });
  } catch (e) {
    reportError(e, 'purchase/webhook/revenuecat');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
