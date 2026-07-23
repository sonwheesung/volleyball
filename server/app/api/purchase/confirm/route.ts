// POST /api/purchase/confirm — 클라 구매 resolve 후 폴백(BACKEND_SYSTEM §13.18). 웹훅 지연·유실 시 "돈 내고 0개" 방지.
// body: { storeTxnId, productId, requestId?, platform?, appVersion? }. requireUserId(Bearer). RC REST 재검증 → applyWallet(같은 키) → 웹훅과 dedup 수렴.
// **감사 로깅(§13.22)**: received/reverify.result/grant.applied|deduped/rejected/error 단계 기록(상관 requestId — 클라 브레드크럼과 이음).
import { NextResponse } from 'next/server';
import { requireUserId } from '../../../../lib/auth';
import { rcVerifyPurchase, recordPurchaseRevenue } from '../../../../lib/revenuecat';
import { applyPurchaseGrant } from '../../../../lib/pass';
import { logPaymentEventAfter } from '../../../../lib/paymentLog';
import { notifyPurchase } from '../../../../lib/notify';
import { reportError } from '../../../../lib/observability';
import { afterSafe } from '../../../../lib/afterSafe';

export const dynamic = 'force-dynamic';

// RC 재검증 실패사유 → 정규화 reason_code(리서치 §C). 원사유도 detail로 보존.
function reasonCodeOf(reason: string): string {
  if (reason === 'rc-unconfigured') return 'RC_UNCONFIGURED';
  if (reason === 'unknown-product') return 'ITEM_UNAVAILABLE';
  if (reason === 'txn-not-found') return 'RECEIPT_INVALID';
  if (reason === 'rc-network') return 'NETWORK';
  if (reason.startsWith('rc-http-')) return 'BACKEND_ERROR';
  return reason;
}

export async function POST(req: Request) {
  const userId = await requireUserId(req); // 익명 폴백 금지(진짜 Bearer sub만) — §13.17 패턴
  if (!userId) {
    logPaymentEventAfter({ source: 'confirm', stage: 'confirm.auth.rejected', ok: false, outcome: 'rejected', reasonCode: 'unauthorized' });
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }
  let ctx: { requestId?: string; platform?: string; appVersion?: string; storeTxnId?: string; productId?: string } = {};
  try {
    const b = (await req.json()) as { storeTxnId?: string; productId?: string; requestId?: string; platform?: string; appVersion?: string };
    const storeTxnId = String(b.storeTxnId ?? '').trim();
    const productId = String(b.productId ?? '').trim();
    ctx = { requestId: b.requestId ? String(b.requestId).slice(0, 64) : undefined, platform: b.platform ? String(b.platform).slice(0, 16) : undefined, appVersion: b.appVersion ? String(b.appVersion).slice(0, 24) : undefined, storeTxnId, productId };
    logPaymentEventAfter({ source: 'confirm', stage: 'confirm.received', ok: true, userId, storeTxnId, productId, requestId: ctx.requestId, platform: ctx.platform, appVersion: ctx.appVersion });

    if (!storeTxnId || !productId) {
      logPaymentEventAfter({ source: 'confirm', stage: 'confirm.rejected', ok: false, outcome: 'rejected', reasonCode: 'bad-request', userId, requestId: ctx.requestId });
      return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    }

    const v = await rcVerifyPurchase(userId, storeTxnId, productId); // 서버 권위 재검증
    if (!v.ok) {
      if (v.reason === 'sandbox') {
        // 웹훅 environment:SANDBOX 필터와 **대칭**(§13.18 D1) — confirm 폴백도 샌드박스는 지급 0(prod 원장 유령 다이아 방지).
        // 무시(200 ignored)로 기록(웹훅 webhook.sandbox.filtered와 짝). 정상 prod 유저는 실제로 여기 도달 안 함(샌드박스 테스터만).
        logPaymentEventAfter({ source: 'confirm', stage: 'confirm.sandbox.filtered', ok: true, outcome: 'ignored', reasonCode: 'sandbox', userId, storeTxnId, productId, requestId: ctx.requestId, platform: ctx.platform, appVersion: ctx.appVersion });
        return NextResponse.json({ ok: true, ignored: 'sandbox' });
      }
      logPaymentEventAfter({ source: 'confirm', stage: 'confirm.reverify.rejected', ok: false, outcome: 'rejected', reasonCode: reasonCodeOf(v.reason), userId, storeTxnId, productId, requestId: ctx.requestId, platform: ctx.platform, appVersion: ctx.appVersion, detail: { rcReason: v.reason } });
      return NextResponse.json({ ok: false, reason: v.reason }, { status: v.reason === 'rc-unconfigured' ? 503 : 402 });
    }

    // 지급 합성 — 팩=base 지급(1+1 보너스는 웹훅 전담: confirm은 purchased_at 미상이라 월키 분기 오지급 방지, withBonus:false).
    // 패스=grantPass(창 생성 + slot 0, B4). 웹훅과 storeTxnId/passId 멱등키 공유 → dedup 수렴.
    const g = await applyPurchaseGrant({ userId, storeTxnId, productId, sandbox: v.sandbox, purchasedAt: new Date(), withBonus: false });
    if (g.kind === 'pass') {
      const pass = g.pass;
      if (!pass.ok) {
        logPaymentEventAfter({ source: 'confirm', stage: 'confirm.pass.error', ok: false, outcome: 'error', reasonCode: pass.reason, userId, storeTxnId, productId, requestId: ctx.requestId });
        return NextResponse.json({ ok: false, reason: pass.reason }, { status: 500 });
      }
      const created = pass.outcome === 'activated' || pass.outcome === 'queued' || pass.outcome === 'queued-overflow';
      logPaymentEventAfter({ source: 'confirm', stage: created ? 'confirm.pass.applied' : 'confirm.pass.deduped', ok: true, outcome: created ? 'applied' : (pass.outcome === 'tombstoned-skip' ? 'cancelled' : 'deduped'), reasonCode: pass.outcome, userId, storeTxnId, productId, requestId: ctx.requestId, platform: ctx.platform, appVersion: ctx.appVersion });
      if (created && !v.sandbox) await recordPurchaseRevenue(null, 0, storeTxnId); // KRW는 웹훅 보충(§13.18 A1) — 패스도 R2 건수 편입
      if (pass.outcome === 'activated' || pass.outcome === 'queued') afterSafe(() => notifyPurchase({ kind: 'purchase', productId, diamonds: 0, priceKrw: null, source: 'confirm', userId }));
      return NextResponse.json({ ok: true, applied: created, outcome: pass.outcome });
    }
    if (g.kind !== 'pack') return NextResponse.json({ ok: false, reason: 'unknown-product' }, { status: 402 });
    const r = g.base;
    if (!r.ok) {
      logPaymentEventAfter({ source: 'confirm', stage: 'confirm.grant.error', ok: false, outcome: 'error', reasonCode: r.reason, userId, storeTxnId, productId, diamondsDelta: v.diamonds, requestId: ctx.requestId });
      return NextResponse.json({ ok: false, reason: r.reason }, { status: 500 });
    }
    // applied=이 폴백이 지급(웹훅보다 먼저 도착) · deduped=웹훅이 이미 지급(정상). 어느 경로가 이겼는지 감사(§F6·폴백 유효성 지표).
    logPaymentEventAfter({ source: 'confirm', stage: r.applied ? 'confirm.grant.applied' : 'confirm.grant.deduped', ok: true, outcome: r.applied ? 'applied' : 'deduped', userId, storeTxnId, productId, diamondsDelta: v.diamonds, balanceAfter: r.balance, requestId: ctx.requestId, platform: ctx.platform, appVersion: ctx.appVersion });
    if (r.applied) {
      // 샌드박스 지급은 매출·건수·다이아 집계 전면 제외(§13.18 D1 정정 2026-07-17 — statsDaily는 실매출 전용).
      if (!v.sandbox) await recordPurchaseRevenue(null, v.diamonds, storeTxnId); // 매출(KRW)는 웹훅이 채움/보충 — confirm은 다이아만(KRW null → 웹훅 dedup 시 recordRevenueKrwOnce가 보충 §13.18 A1)
      afterSafe(() => notifyPurchase({ kind: 'purchase', productId, diamonds: v.diamonds, priceKrw: null, source: 'confirm', userId })); // 폴백이 이겼을 때만(웹훅이 먼저면 여기 deduped→알림 없음)
    }
    return NextResponse.json({ ok: true, applied: r.applied, balance: r.balance });
  } catch (e) {
    reportError(e, 'purchase/confirm');
    logPaymentEventAfter({ source: 'confirm', stage: 'confirm.error', ok: false, outcome: 'error', errorMessage: e instanceof Error ? e.message : String(e), userId, storeTxnId: ctx.storeTxnId, productId: ctx.productId, requestId: ctx.requestId });
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
