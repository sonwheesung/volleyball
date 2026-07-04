// RevenueCat 게이트웨이 (BACKEND_SYSTEM §13.18) — 웹훅 인증·이벤트 판정(순수)·매출 롤업.
// RC는 검증/웹훅/consume 게이트웨이. 다이아 잔액 진실은 우리 원장(applyWallet). 엔타이틀먼트는 RC customerInfo(원장 무관).
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { statsDaily } from '../db/schema';
import { PROJ_CODE } from './proj';
import { ensureProj } from './wallet';
import { productDiamonds } from './products';

export const RC_WEBHOOK_SECRET = process.env.RC_WEBHOOK_SECRET ?? '';
export const RC_REST_API_KEY = process.env.RC_REST_API_KEY ?? '';

// RC 웹훅 이벤트 타입 → 지급/환불/무시. **소모성 다이아 팩 전용**(구독 없음)이라 일회성 이벤트만 처리:
//   지급=INITIAL_PURCHASE·NON_RENEWING_PURCHASE / 회수=CANCELLATION·REFUND. RENEWAL/UNCANCELLATION/EXPIRATION(구독용)은
//   무시 — UNCANCELLATION을 지급으로 두면 원구매와 같은 purchaseKey라 dedup되며 환불 되돌림이 어긋남(엣지). 소모성엔 애초에 안 옴.
const GRANT_TYPES = new Set(['INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE']);
const REFUND_TYPES = new Set(['CANCELLATION', 'REFUND']);

export type PurchaseDecision =
  | { action: 'grant' | 'refund'; userId: string; diamonds: number; storeTxnId: string; productId: string; priceKrw: number | null }
  | { action: 'ignore'; reason: string };

/** RC 웹훅 Authorization 검증 — fail-closed(시크릿 미설정/<16자면 전부 거부, requireAdmin 패턴). RC 대시보드가 보낸 커스텀 헤더값과 비교. */
export function verifyWebhookAuth(authHeader: string | null): boolean {
  if (!RC_WEBHOOK_SECRET || RC_WEBHOOK_SECRET.length < 16) return false;
  const h = authHeader ?? '';
  return h === RC_WEBHOOK_SECRET || h === `Bearer ${RC_WEBHOOK_SECRET}`;
}

/** RC가 KRW로 준 실매출(정수 원). 다른 통화·미제공이면 null(다이아 건수 역산 금지 §13.18). */
export function priceKrwOf(ev: { currency?: string; price_in_purchased_currency?: number }): number | null {
  if (ev.currency === 'KRW' && typeof ev.price_in_purchased_currency === 'number' && Number.isFinite(ev.price_in_purchased_currency)) {
    return Math.max(0, Math.round(ev.price_in_purchased_currency));
  }
  return null;
}

/** 웹훅 이벤트 → 결정(순수·부작용 없음). 서버 권위 다이아(productId 매핑, 클라값 무시). 엔타이틀먼트/미등록/샌드박스/미지원타입=무시. */
export function decidePurchaseEvent(ev: unknown): PurchaseDecision {
  if (!ev || typeof ev !== 'object') return { action: 'ignore', reason: 'no-event' };
  const e = ev as Record<string, unknown>;
  if (e.environment === 'SANDBOX') return { action: 'ignore', reason: 'sandbox' }; // 테스터가 prod 원장에 유령 다이아 발행 방지
  const userId = String(e.app_user_id ?? '');
  const productId = String(e.product_id ?? '');
  const storeTxnId = String(e.transaction_id ?? e.id ?? '');
  if (!userId || !productId || !storeTxnId) return { action: 'ignore', reason: 'missing-fields' };
  // 익명 id($RCAnonymousID:…) — 클라가 Purchases.logIn(userId)를 안 함(§13.18 최대 함정). 유저 FK가 없어 지급 불가라
  // 무시(200)로 재시도 폭풍 방지 → confirm 폴백(진짜 userId Bearer)이 메꾼다. UUID 아닌 app_user_id도 동일 처리.
  if (userId.startsWith('$') || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return { action: 'ignore', reason: 'anonymous-user' };
  }
  const type = String(e.type ?? '');
  const isGrant = GRANT_TYPES.has(type), isRefund = REFUND_TYPES.has(type);
  if (!isGrant && !isRefund) return { action: 'ignore', reason: `type:${type}` };
  const diamonds = productDiamonds(productId);
  if (diamonds == null) return { action: 'ignore', reason: 'entitlement-or-unknown-product' }; // 엔타이틀먼트=RC customerInfo 소유
  return { action: isGrant ? 'grant' : 'refund', userId, diamonds, storeTxnId, productId, priceKrw: priceKrwOf(e as any) };
}

/** confirm 폴백 재검증 — RC REST subscriber 조회로 storeTxnId 실재 확인(웹훅 지연·유실 시 "돈 내고 0개" 방지).
 *  RC_REST_API_KEY 미설정이면 검증 불가 → fail-closed(클라값 신뢰 금지 §13.12). 웹훅과 같은 키로 지급→dedup 수렴. */
export async function rcVerifyPurchase(userId: string, storeTxnId: string, productId: string): Promise<{ ok: true; diamonds: number } | { ok: false; reason: string }> {
  const diamonds = productDiamonds(productId);
  if (diamonds == null) return { ok: false, reason: 'unknown-product' };
  if (!RC_REST_API_KEY) return { ok: false, reason: 'rc-unconfigured' };
  try {
    const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, { headers: { Authorization: `Bearer ${RC_REST_API_KEY}` } });
    if (!res.ok) return { ok: false, reason: `rc-http-${res.status}` };
    const j = (await res.json()) as { subscriber?: { non_subscriptions?: Record<string, Array<{ store_transaction_id?: string; id?: string }>> } };
    const list = j?.subscriber?.non_subscriptions?.[productId] ?? [];
    const found = list.some((t) => String(t.store_transaction_id ?? t.id ?? '') === storeTxnId);
    return found ? { ok: true, diamonds } : { ok: false, reason: 'txn-not-found' };
  } catch { return { ok: false, reason: 'rc-network' }; }
}

/** 멱등키 — 스토어 거래 id 공유 자연키(웹훅·confirm 폴백 두 경로 수렴). productId 키 금지(소모성 재구매 차단됨). */
export const purchaseKey = (userId: string, storeTxnId: string) => `purchase:${userId}:${storeTxnId}`;
export const refundKey = (userId: string, storeTxnId: string) => `refund:${userId}:${storeTxnId}`;

/** 매출 롤업 — 지급이 **실제 적용된(applied)** 경우만 호출(멱등: 웹훅 재시도로 이중집계 방지). 관리자 대시보드 매출/전환율 원천. */
export async function recordPurchaseRevenue(priceKrw: number | null, diamonds: number): Promise<void> {
  const day = new Date().toISOString().slice(0, 10); // UTC 달력일
  await ensureProj();
  await db.insert(statsDaily)
    .values({ projCode: PROJ_CODE, day, revenueKrw: priceKrw ?? 0, purchaseCount: 1, diamondsPurchased: diamonds })
    .onConflictDoUpdate({
      target: [statsDaily.projCode, statsDaily.day],
      set: {
        revenueKrw: sql`${statsDaily.revenueKrw} + ${priceKrw ?? 0}`,
        purchaseCount: sql`${statsDaily.purchaseCount} + 1`,
        diamondsPurchased: sql`${statsDaily.diamondsPurchased} + ${diamonds}`,
        updatedAt: sql`now()`,
      },
    });
}
