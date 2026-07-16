// POST /api/purchase/webhook/revenuecat — RC 결제 웹훅(BACKEND_SYSTEM §13.18). Authorization 시크릿 검증(fail-closed).
// RC → 이 웹훅 → decidePurchaseEvent(순수) → applyWallet(+/−다이아, 멱등키=스토어거래id) → (지급 적용 시) 매출 롤업.
// 소모성 다이아만 원장 지급. 엔타이틀먼트(광고제거·DLC)는 RC customerInfo 소유라 무시. 샌드박스 무시.
// **감사 로깅(§13.22)**: 단계마다 purchase_event 1행(received/auth/decided/grant.applied|deduped/refund/ignored/error) — 관찰 전용(fire-and-forget).
import { NextResponse } from 'next/server';
import { applyWallet } from '../../../../../lib/wallet';
import { verifyWebhookAuth, decidePurchaseEvent, purchaseKey, refundKey, recordPurchaseRevenue, recordRevenueKrwOnce, priceKrwOf } from '../../../../../lib/revenuecat';
import { logPaymentEventAfter } from '../../../../../lib/paymentLog';
import { notifyPurchase, notifyRefundDropped } from '../../../../../lib/notify';
import { reportError } from '../../../../../lib/observability';
import { afterSafe } from '../../../../../lib/afterSafe';

export const dynamic = 'force-dynamic';

// 로깅용 식별자만 추출(비밀 아님 — id·type·환경·귀속·상품). 원본 바디는 저장 안 함(§13.22 §E).
function evMeta(ev: unknown): { rcEventId: string | null; eventType: string | null; environment: string | null; rcAppUserId: string | null; productId: string | null; storeTxnId: string | null; price: number | null; currency: string | null } {
  const e = (ev && typeof ev === 'object' ? ev : {}) as Record<string, any>;
  return {
    rcEventId: e.id != null ? String(e.id) : null,
    eventType: e.type != null ? String(e.type) : null,
    environment: e.environment != null ? String(e.environment) : null,
    rcAppUserId: e.app_user_id != null ? String(e.app_user_id) : null,
    productId: e.product_id != null ? String(e.product_id) : null,
    storeTxnId: e.transaction_id != null ? String(e.transaction_id) : e.id != null ? String(e.id) : null,
    price: priceKrwOf(e),
    currency: e.currency != null ? String(e.currency) : null,
  };
}

export async function POST(req: Request) {
  // 인증 실패면 401(RC가 재시도 안 하게 — 위조 방지). fail-closed: 시크릿 미설정도 거부.
  if (!verifyWebhookAuth(req.headers.get('authorization'))) {
    logPaymentEventAfter({ source: 'webhook', stage: 'webhook.auth.rejected', ok: false, outcome: 'rejected', reasonCode: 'SIGNATURE_MISMATCH' });
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }
  let m: ReturnType<typeof evMeta> | null = null;
  try {
    const body = (await req.json()) as { event?: unknown };
    m = evMeta(body?.event);
    logPaymentEventAfter({ source: 'webhook', stage: 'webhook.received', ok: true, ...m });

    const d = decidePurchaseEvent(body?.event);
    if (d.action === 'ignore') {
      // 무시도 기록(샌드박스·익명유저·미지원타입·미등록상품) — "지급 왜 안 됐나" 감사. 샌드박스는 별도 stage로.
      // **익명 환불(anonymous-refund)은 조용한 유실 금지**(§13.18 B1): fail 코드(ok:false)로 txn·상품·금액을 남기고
      //   관측 채널(디스코드)로 알려 관리자가 수동 환불(§13.17) 여부를 판단하게 한다(지급 익명은 현행 무시 — confirm이 메꿈).
      const dropped = d.reason === 'anonymous-refund';
      const stage = dropped ? 'refund.anonymous.dropped' : d.reason === 'sandbox' ? 'webhook.sandbox.filtered' : 'webhook.ignored';
      logPaymentEventAfter({ source: 'webhook', stage, ok: !dropped, outcome: 'ignored', reasonCode: d.reason, ...m });
      if (dropped) afterSafe(() => notifyRefundDropped({ productId: m!.productId, storeTxnId: m!.storeTxnId, priceKrw: m!.price, rcAppUserId: m!.rcAppUserId, eventType: m!.eventType }));
      return NextResponse.json({ ok: true, ignored: d.reason });
    }

    logPaymentEventAfter({ source: 'webhook', stage: 'webhook.type.decided', ok: true, ...m, productId: d.productId, storeTxnId: d.storeTxnId, rcAppUserId: d.userId, diamondsDelta: d.action === 'grant' ? d.diamonds : -d.diamonds, price: d.priceKrw });

    const grant = d.action === 'grant';
    const key = grant ? purchaseKey(d.userId, d.storeTxnId) : refundKey(d.userId, d.storeTxnId);
    const delta = grant ? d.diamonds : -d.diamonds; // 환불은 음수(applyWalletTx가 refund만 음수잔액 허용)
    const r = await applyWallet(d.userId, delta, grant ? 'purchase' : 'refund', key, d.productId);
    if (!r.ok) {
      // 유저 미존재(FK)·DB 오류 등 → 500으로 RC 재시도 유도(confirm 폴백도 별도 수렴). 위조 아님.
      logPaymentEventAfter({ source: 'webhook', stage: grant ? 'webhook.grant.error' : 'webhook.refund.error', ok: false, outcome: 'error', reasonCode: r.reason, idempotencyKey: key, ...m, userId: d.userId, productId: d.productId, storeTxnId: d.storeTxnId, diamondsDelta: delta });
      return NextResponse.json({ ok: false, reason: r.reason }, { status: 500 });
    }
    // applied=지급/회수 실제 반영 · applied=false=멱등 dedup(웹훅 재시도/폴백 경쟁에서 짐 — 정상). 둘을 구분 로깅(§F6 경쟁 감사).
    logPaymentEventAfter({
      source: 'webhook',
      stage: grant ? (r.applied ? 'webhook.grant.applied' : 'webhook.grant.deduped') : (r.applied ? 'webhook.refund.applied' : 'webhook.refund.deduped'),
      ok: true, outcome: r.applied ? 'applied' : 'deduped', idempotencyKey: key,
      ...m, userId: d.userId, productId: d.productId, storeTxnId: d.storeTxnId, diamondsDelta: delta, balanceAfter: r.balance, price: d.priceKrw,
    });
    // 매출 롤업은 **실제 적용된 지급**만 건수·다이아 1회(멱등 — 웹훅 재시도/폴백 중복 시 이중집계 방지).
    if (grant && r.applied) {
      await recordPurchaseRevenue(d.priceKrw, d.diamonds, d.storeTxnId);
    } else if (grant && !r.applied) {
      // confirm 폴백이 먼저 지급(KRW null)하고 웹훅이 뒤늦게 dedup된 경우 — 건수·다이아는 confirm이 이미 집계했고 KRW만
      // 미기록(그대로 두면 관리자 매출 영구 ₩0, DoD "매출 1건 조회" 위반 §13.18 A1). 이 txn의 KRW를 **보충**(멱등 마커로
      // 이중집계 차단, 다이아 재지급·건수 증가 없음). 웹훅 재시도로 다시 와도 마커가 있어 skipped.
      const krw = await recordRevenueKrwOnce(d.storeTxnId, d.priceKrw);
      if (krw === 'recorded') {
        logPaymentEventAfter({ source: 'webhook', stage: 'webhook.revenue.krw.backfilled', ok: true, outcome: 'applied', idempotencyKey: key, ...m, userId: d.userId, productId: d.productId, storeTxnId: d.storeTxnId, price: d.priceKrw });
      }
    }
    // 디스코드 알림은 실제 반영(applied)만 — 응답 후(after) 전송, 정확히 1건(dedup된 재시도/폴백은 알림 없음).
    if (r.applied) afterSafe(() => notifyPurchase({ kind: grant ? 'purchase' : 'refund', productId: d.productId, diamonds: d.diamonds, priceKrw: d.priceKrw, environment: m!.environment, source: 'webhook', userId: d.userId }));
    return NextResponse.json({ ok: true, applied: r.applied, balance: r.balance });
  } catch (e) {
    reportError(e, 'purchase/webhook/revenuecat');
    logPaymentEventAfter({ source: 'webhook', stage: 'webhook.error', ok: false, outcome: 'error', errorMessage: e instanceof Error ? e.message : String(e), ...(m ?? {}) });
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
