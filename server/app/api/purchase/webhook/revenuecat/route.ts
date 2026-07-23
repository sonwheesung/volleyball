// POST /api/purchase/webhook/revenuecat — RC 결제 웹훅(BACKEND_SYSTEM §13.18 · ATTENDANCE_PASS_SYSTEM §A·§B·§C). Authorization 시크릿 검증(fail-closed).
// RC → 이 웹훅 → decidePurchaseEvent(순수) → applyPurchaseGrant(팩 base+1+1 / 패스 grant) 또는 환불(패스 클로백 / 팩 base+보너스 회수).
// 소모성 다이아 팩·출석 패스만 원장/패스 지급. 엔타이틀먼트(광고제거·DLC)는 RC customerInfo 소유라 무시. 샌드박스 필터.
// **감사 로깅(§13.22)**: 단계마다 purchase_event 1행 — 관찰 전용(fire-and-forget).
import { NextResponse } from 'next/server';
import { applyWallet } from '../../../../../lib/wallet';
import { verifyWebhookAuth, decidePurchaseEvent, refundKey, recordPurchaseRevenue, recordRevenueKrwOnce, priceKrwOf } from '../../../../../lib/revenuecat';
import { applyPurchaseGrant, clawbackPass, reversePackBonus } from '../../../../../lib/pass';
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
      const dropped = d.reason === 'anonymous-refund';
      const stage = dropped ? 'refund.anonymous.dropped' : d.reason === 'sandbox' ? 'webhook.sandbox.filtered' : 'webhook.ignored';
      logPaymentEventAfter({ source: 'webhook', stage, ok: !dropped, outcome: 'ignored', reasonCode: d.reason, ...m });
      if (dropped) afterSafe(() => notifyRefundDropped({ productId: m!.productId, storeTxnId: m!.storeTxnId, priceKrw: m!.price, rcAppUserId: m!.rcAppUserId, eventType: m!.eventType }));
      return NextResponse.json({ ok: true, ignored: d.reason });
    }

    const grant = d.action === 'grant';
    logPaymentEventAfter({ source: 'webhook', stage: 'webhook.type.decided', ok: true, ...m, productId: d.productId, storeTxnId: d.storeTxnId, rcAppUserId: d.userId, diamondsDelta: grant ? d.diamonds : -d.diamonds, price: d.priceKrw });

    // ── 출석 패스(diamond_pass) 경로 — 원장 팩 지급과 분리(창은 attendance_passes, 지급은 pass_daily로만) ──
    if (d.kind === 'pass') {
      if (grant) {
        const g = await applyPurchaseGrant({ userId: d.userId, storeTxnId: d.storeTxnId, productId: d.productId, sandbox: d.sandbox, purchasedAt: d.purchasedAt, withBonus: true });
        const pass = g.kind === 'pass' ? g.pass : { ok: false as const, reason: 'not-pass' };
        if (!pass.ok) {
          logPaymentEventAfter({ source: 'webhook', stage: 'webhook.pass.error', ok: false, outcome: 'error', reasonCode: pass.reason, ...m, userId: d.userId, productId: d.productId, storeTxnId: d.storeTxnId });
          return NextResponse.json({ ok: false, reason: pass.reason }, { status: 500 });
        }
        const created = pass.outcome === 'activated' || pass.outcome === 'queued' || pass.outcome === 'queued-overflow';
        logPaymentEventAfter({ source: 'webhook', stage: created ? 'webhook.pass.applied' : 'webhook.pass.deduped', ok: true, outcome: created ? 'applied' : (pass.outcome === 'tombstoned-skip' ? 'cancelled' : 'deduped'), reasonCode: pass.outcome, ...m, userId: d.userId, productId: d.productId, storeTxnId: d.storeTxnId, price: d.priceKrw });
        // 매출·건수 롤업(R2 — 패스 구매도 payer/전환/건수에 편입). 다이아는 0(지급은 pass_daily). 샌드박스 제외.
        if (created && !d.sandbox) await recordPurchaseRevenue(d.priceKrw, 0, d.storeTxnId);
        if (pass.outcome === 'queued-overflow') afterSafe(() => notifyRefundDropped({ productId: d.productId, storeTxnId: d.storeTxnId, priceKrw: d.priceKrw, rcAppUserId: m!.rcAppUserId, eventType: 'PASS_QUEUE_OVERFLOW' }));
        if (pass.outcome === 'activated' || pass.outcome === 'queued') afterSafe(() => notifyPurchase({ kind: 'purchase', productId: d.productId, diamonds: 0, priceKrw: d.priceKrw, environment: m!.environment, source: 'webhook', userId: d.userId }));
        return NextResponse.json({ ok: true, applied: created, outcome: pass.outcome });
      }
      // 패스 환불 — 클로백(B2) + tombstone(B1)
      const cb = await clawbackPass(d.userId, d.storeTxnId, d.productId);
      if (!cb.ok) {
        logPaymentEventAfter({ source: 'webhook', stage: 'webhook.pass.refund.error', ok: false, outcome: 'error', reasonCode: cb.reason, ...m, userId: d.userId, productId: d.productId, storeTxnId: d.storeTxnId });
        return NextResponse.json({ ok: false, reason: cb.reason }, { status: 500 });
      }
      logPaymentEventAfter({ source: 'webhook', stage: 'webhook.pass.refund.applied', ok: true, outcome: cb.outcome === 'clawed' ? 'applied' : 'deduped', reasonCode: cb.outcome, ...m, userId: d.userId, productId: d.productId, storeTxnId: d.storeTxnId, diamondsDelta: -cb.clawback });
      if (cb.outcome === 'clawed') afterSafe(() => notifyPurchase({ kind: 'refund', productId: d.productId, diamonds: cb.clawback, priceKrw: d.priceKrw, environment: m!.environment, source: 'webhook', userId: d.userId }));
      return NextResponse.json({ ok: true, applied: cb.outcome === 'clawed', clawback: cb.clawback });
    }

    // ── 다이아 팩 경로(기존 §13.18 + 1+1 §3.1) ──
    if (grant) {
      const g = await applyPurchaseGrant({ userId: d.userId, storeTxnId: d.storeTxnId, productId: d.productId, sandbox: d.sandbox, purchasedAt: d.purchasedAt, withBonus: true });
      const base = g.kind === 'pack' ? g.base : { ok: false as const, reason: 'not-pack' as const };
      if (!base.ok) {
        logPaymentEventAfter({ source: 'webhook', stage: 'webhook.grant.error', ok: false, outcome: 'error', reasonCode: base.reason, idempotencyKey: undefined, ...m, userId: d.userId, productId: d.productId, storeTxnId: d.storeTxnId, diamondsDelta: d.diamonds });
        return NextResponse.json({ ok: false, reason: base.reason }, { status: 500 });
      }
      const bonusApplied = g.kind === 'pack' && g.bonus?.ok === true && g.bonus.applied === true;
      logPaymentEventAfter({
        source: 'webhook', stage: base.applied ? 'webhook.grant.applied' : 'webhook.grant.deduped',
        ok: true, outcome: base.applied ? 'applied' : 'deduped',
        ...m, userId: d.userId, productId: d.productId, storeTxnId: d.storeTxnId, diamondsDelta: d.diamonds + (bonusApplied ? d.diamonds : 0), balanceAfter: base.balance, price: d.priceKrw,
      });
      // 매출 롤업 — 실제 적용된 지급만 1회(멱등). 샌드박스 제외. 1+1 보너스는 매출/다이아 집계에서 자동 제외(reason='purchase'만 집계 §3.1).
      if (base.applied && !d.sandbox) {
        await recordPurchaseRevenue(d.priceKrw, d.diamonds, d.storeTxnId);
      } else if (!base.applied && !d.sandbox) {
        const krw = await recordRevenueKrwOnce(d.storeTxnId, d.priceKrw);
        if (krw === 'recorded') logPaymentEventAfter({ source: 'webhook', stage: 'webhook.revenue.krw.backfilled', ok: true, outcome: 'applied', ...m, userId: d.userId, productId: d.productId, storeTxnId: d.storeTxnId, price: d.priceKrw });
      }
      if (base.applied) afterSafe(() => notifyPurchase({ kind: 'purchase', productId: d.productId, diamonds: d.diamonds, priceKrw: d.priceKrw, environment: m!.environment, source: 'webhook', userId: d.userId }));
      return NextResponse.json({ ok: true, applied: base.applied, balance: base.balance });
    }

    // 팩 환불 — 기본 회수(기존 refund 키) + 1+1 보너스 회수(있으면). 월-멱등키는 미복구(§4.2 파밍 차단).
    const ref = d.sandbox ? `${d.productId}:sandbox` : d.productId;
    const r = await applyWallet(d.userId, -d.diamonds, 'refund', refundKey(d.userId, d.storeTxnId), ref);
    if (!r.ok) {
      logPaymentEventAfter({ source: 'webhook', stage: 'webhook.refund.error', ok: false, outcome: 'error', reasonCode: r.reason, idempotencyKey: refundKey(d.userId, d.storeTxnId), ...m, userId: d.userId, productId: d.productId, storeTxnId: d.storeTxnId, diamondsDelta: -d.diamonds });
      return NextResponse.json({ ok: false, reason: r.reason }, { status: 500 });
    }
    const bonusRev = r.applied ? await reversePackBonus(d.userId, d.storeTxnId, d.productId) : { reversed: 0 };
    logPaymentEventAfter({
      source: 'webhook', stage: r.applied ? 'webhook.refund.applied' : 'webhook.refund.deduped',
      ok: true, outcome: r.applied ? 'applied' : 'deduped',
      ...m, userId: d.userId, productId: d.productId, storeTxnId: d.storeTxnId, diamondsDelta: -(d.diamonds + bonusRev.reversed), balanceAfter: r.balance, price: d.priceKrw,
    });
    if (r.applied) afterSafe(() => notifyPurchase({ kind: 'refund', productId: d.productId, diamonds: d.diamonds + bonusRev.reversed, priceKrw: d.priceKrw, environment: m!.environment, source: 'webhook', userId: d.userId }));
    return NextResponse.json({ ok: true, applied: r.applied, balance: r.balance });
  } catch (e) {
    reportError(e, 'purchase/webhook/revenuecat');
    logPaymentEventAfter({ source: 'webhook', stage: 'webhook.error', ok: false, outcome: 'error', errorMessage: e instanceof Error ? e.message : String(e), ...(m ?? {}) });
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
