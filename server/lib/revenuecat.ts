// RevenueCat 게이트웨이 (BACKEND_SYSTEM §13.18) — 웹훅 인증·이벤트 판정(순수)·매출 롤업.
// RC는 검증/웹훅/consume 게이트웨이. 다이아 잔액 진실은 우리 원장(applyWallet). 엔타이틀먼트는 RC customerInfo(원장 무관).
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { statsDaily, purchaseEvent } from '../db/schema';
import { PROJ_CODE } from './proj';
import { ensureProj } from './wallet';
import { productDiamonds, isPassProduct } from './products';

export const RC_WEBHOOK_SECRET = process.env.RC_WEBHOOK_SECRET ?? '';
export const RC_REST_API_KEY = process.env.RC_REST_API_KEY ?? '';

/** 샌드박스 지급 스위치(§13.18 D1 정정 2026-07-17) — env `RC_SANDBOX_GRANT==='all'`이면 샌드박스(라이선스 테스터
 *  내부테스트 트랙) 결제를 지급 대상으로 통과시킨다. **요청 시점 read**(모듈 const 캐시 금지 — 테스트 A/B로 process.env
 *  조작 즉시 반영·Vercel env 주입 재배포 즉시 반영). 미설정/기타값=off(fail-closed 기본 — 샌드박스 필터 유지).
 *  보안 근거: 샌드박스 결제는 Play 콘솔 **라이선스 테스터 목록(오너 통제)** 계정만 발생. 매출 집계는 제외(호출부 스킵·ref :sandbox 마커). */
export function sandboxGrantEnabled(): boolean {
  return process.env.RC_SANDBOX_GRANT === 'all';
}

// RC 웹훅 이벤트 타입 → 지급/환불/무시. **소모성 다이아 팩 전용**(구독 없음)이라 일회성 이벤트만 처리:
//   지급=INITIAL_PURCHASE·NON_RENEWING_PURCHASE / 회수=CANCELLATION·REFUND. RENEWAL/UNCANCELLATION/EXPIRATION(구독용)은
//   무시 — UNCANCELLATION을 지급으로 두면 원구매와 같은 purchaseKey라 dedup되며 환불 되돌림이 어긋남(엣지). 소모성엔 애초에 안 옴.
const GRANT_TYPES = new Set(['INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE']);
const REFUND_TYPES = new Set(['CANCELLATION', 'REFUND']);

export type PurchaseDecision =
  | { action: 'grant' | 'refund'; userId: string; diamonds: number; storeTxnId: string; productId: string; priceKrw: number | null; sandbox: boolean; kind: 'pack' | 'pass'; purchasedAt: Date }
  | { action: 'ignore'; reason: string };

/** RC 이벤트 거래 발생 시각(purchased_at_ms 우선, 없으면 event_timestamp_ms, 그도 없으면 now). R4 — 1+1 월귀속·패스 start 리셋보정 기준. */
export function eventPurchasedAt(ev: Record<string, unknown>): Date {
  const ms = ev.purchased_at_ms ?? ev.event_timestamp_ms;
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms) : new Date();
}

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
  // 샌드박스 1차 필터 — 기본 무시(테스터가 prod 원장에 유령 다이아 발행 방지). **스위치 on(RC_SANDBOX_GRANT=all)이면
  //   무시하지 않고 정상 진행**(grant/refund 모두 — 라이선스 테스터 결제 테스트 기간용, §13.18 D1 정정 2026-07-17).
  if (e.environment === 'SANDBOX' && !sandboxGrantEnabled()) return { action: 'ignore', reason: 'sandbox' };
  const userId = String(e.app_user_id ?? '');
  const productId = String(e.product_id ?? '');
  const storeTxnId = String(e.transaction_id ?? e.id ?? '');
  if (!userId || !productId || !storeTxnId) return { action: 'ignore', reason: 'missing-fields' };
  // 익명 id($RCAnonymousID:…) — 클라가 Purchases.logIn(userId)를 안 함(§13.18 최대 함정). 유저 FK가 없어 지급 불가라
  // 무시(200)로 재시도 폭풍 방지 → confirm 폴백(진짜 userId Bearer)이 메꾼다. UUID 아닌 app_user_id도 동일 처리.
  if (userId.startsWith('$') || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    // 지급(익명)은 confirm 폴백이 메꾸지만 **환불(익명)은 웹훅 단일경로** — 무흔적 200으로 삼키면 클로백이 조용히 유실된다
    // (§13.18 B1). 익명 CANCELLATION/REFUND는 별도 사유로 구분해 라우트가 fail 코드로 기록+관측하게 한다(지급 익명은 현행 유지).
    const t0 = String(e.type ?? '');
    if (REFUND_TYPES.has(t0)) return { action: 'ignore', reason: 'anonymous-refund' };
    return { action: 'ignore', reason: 'anonymous-user' };
  }
  const type = String(e.type ?? '');
  const isGrant = GRANT_TYPES.has(type), isRefund = REFUND_TYPES.has(type);
  if (!isGrant && !isRefund) return { action: 'ignore', reason: `type:${type}` };
  // 패스 SKU(diamond_pass)는 pass-grant로 분기(§2.1) — 소비성 팩과 달리 다이아 0(창은 attendance_passes, 지급은 pass_daily로만).
  const pass = isPassProduct(productId);
  const diamonds = pass ? 0 : productDiamonds(productId);
  if (!pass && diamonds == null) return { action: 'ignore', reason: 'entitlement-or-unknown-product' }; // 엔타이틀먼트=RC customerInfo 소유
  // sandbox 플래그를 결정에 실어 호출부가 매출 집계 스킵 + 원장 ref에 :sandbox 마커를 붙이게 한다(멱등키는 불변 — store txn 기반).
  const sandbox = e.environment === 'SANDBOX';
  return { action: isGrant ? 'grant' : 'refund', userId, diamonds: diamonds ?? 0, storeTxnId, productId, priceKrw: priceKrwOf(e as any), sandbox, kind: pass ? 'pass' : 'pack', purchasedAt: eventPurchasedAt(e) };
}

/** confirm 폴백 재검증 — RC REST subscriber 조회로 storeTxnId 실재 확인(웹훅 지연·유실 시 "돈 내고 0개" 방지).
 *  RC_REST_API_KEY 미설정이면 검증 불가 → fail-closed(클라값 신뢰 금지 §13.12). 웹훅과 같은 키로 지급→dedup 수렴. */
export async function rcVerifyPurchase(userId: string, storeTxnId: string, productId: string): Promise<{ ok: true; diamonds: number; sandbox: boolean; kind: 'pack' | 'pass' } | { ok: false; reason: string }> {
  const pass = isPassProduct(productId);
  const diamonds = pass ? 0 : productDiamonds(productId); // 패스는 즉시 다이아 0(창 생성만) — confirm도 grantPass로 분기
  if (!pass && diamonds == null) return { ok: false, reason: 'unknown-product' };
  if (!RC_REST_API_KEY) return { ok: false, reason: 'rc-unconfigured' };
  try {
    const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, { headers: { Authorization: `Bearer ${RC_REST_API_KEY}` } });
    if (!res.ok) return { ok: false, reason: `rc-http-${res.status}` };
    const j = (await res.json()) as { subscriber?: { non_subscriptions?: Record<string, Array<{ store_transaction_id?: string; id?: string; is_sandbox?: boolean }>> } };
    const list = j?.subscriber?.non_subscriptions?.[productId] ?? [];
    const match = list.find((t) => String(t.store_transaction_id ?? t.id ?? '') === storeTxnId);
    if (!match) return { ok: false, reason: 'txn-not-found' };
    // 샌드박스 필터 — 웹훅 `environment:SANDBOX` 필터와 **대칭**(§13.18 D1). 없으면 confirm 폴백이 샌드박스 결제를 prod 원장에
    // 유령 다이아로 발행(두 지급경로 비대칭 버그). RC REST v1 스키마상 non_subscriptions 항목은 `is_sandbox`(boolean)를 **표준
    // 필드로** 싣고, 실 샌드박스 거래는 `is_sandbox:true`를 확실히 담아 온다(RC API v1 문서 확인 2026-07-16). 따라서 엄격히
    // `===true`일 때만 필터한다. **부재/비불리언(스키마 이상, 실거래엔 사실상 없음)은 prod로 간주(grant)** — 이유: 샌드박스 1차
    // 필터는 권위 있는 최상위 `environment`를 읽는 웹훅이고 confirm은 그 폴백이므로, 모호할 때 지급 편향이 정상 결제의
    // "돈 내고 0개"를 막는다(실 샌드박스는 확정적으로 true라 위협 자체는 확실히 잡힘).
    // 스위치 on이면 샌드박스 항목도 지급 통과(웹훅 environment 필터와 대칭 §13.18 D1 정정 2026-07-17). sandbox 플래그를 실어
    //   confirm 라우트가 매출 집계 스킵 + 원장 ref :sandbox 마커를 붙이게 한다. off면 현행대로 거절.
    if (match.is_sandbox === true && !sandboxGrantEnabled()) return { ok: false, reason: 'sandbox' };
    return { ok: true, diamonds: diamonds ?? 0, sandbox: match.is_sandbox === true, kind: pass ? 'pass' : 'pack' };
  } catch { return { ok: false, reason: 'rc-network' }; }
}

/** 멱등키 — 스토어 거래 id 공유 자연키(웹훅·confirm 폴백 두 경로 수렴). productId 키 금지(소모성 재구매 차단됨). */
export const purchaseKey = (userId: string, storeTxnId: string) => `purchase:${userId}:${storeTxnId}`;
export const refundKey = (userId: string, storeTxnId: string) => `refund:${userId}:${storeTxnId}`;

/** KRW 매출을 이 txn에 대해 **딱 한 번만** stats_daily에 적재(멱등). confirm이 먼저 지급하면 KRW를 몰라 null로 지나가고
 *  (§13.18 "confirm은 다이아만"), 뒤늦게 웹훅(KRW 보유)이 dedup으로 도착하면 이 함수가 KRW만 **보충**한다(§13.18 A1 —
 *  다이아·건수 재적재 없음, 없으면 관리자 ⑤ 매출이 영구 ₩0). applied 경로·보충 경로 **모두 이 함수를 거쳐 KRW 단일
 *  진실점** → 웹훅 재시도·경로 경쟁에도 KRW 이중집계 0. 멱등 판별 = purchase_event에 이 storeTxnId의 `revenue.krw`
 *  마커 존재 여부(**새 테이블 금지** — 기존 진단 테이블·pe_txn_idx를 앵커로). 마커+집계를 한 트랜잭션으로 원자화(중간
 *  실패 시 둘 다 롤백 → 재시도 안전). 반환: 실제 적재/기적재 스킵/무가격.
 *  ⚠ 완전 원자성은 순차 처리 전제(RC 웹훅 재시도는 순차·confirm은 KRW null이라 KRW를 쓰는 경로는 웹훅 단일) —
 *    동일 이벤트의 **동시 병렬 배송**(희귀)은 unique 제약이 없어 이론상 이중 가능. txn+마커 체크로 실무상 봉인. */
export async function recordRevenueKrwOnce(storeTxnId: string, priceKrw: number | null): Promise<'recorded' | 'skipped' | 'no-price'> {
  if (priceKrw == null || priceKrw <= 0) return 'no-price';
  await ensureProj();
  const day = new Date().toISOString().slice(0, 10); // UTC 달력일
  return await db.transaction(async (tx) => {
    const dup = await tx
      .select({ id: purchaseEvent.id })
      .from(purchaseEvent)
      .where(and(eq(purchaseEvent.projCode, PROJ_CODE), eq(purchaseEvent.storeTxnId, storeTxnId), eq(purchaseEvent.stage, 'revenue.krw')))
      .limit(1);
    if (dup.length) return 'skipped' as const;
    await tx
      .insert(statsDaily)
      .values({ projCode: PROJ_CODE, day, revenueKrw: priceKrw, purchaseCount: 0, diamondsPurchased: 0 })
      .onConflictDoUpdate({ target: [statsDaily.projCode, statsDaily.day], set: { revenueKrw: sql`${statsDaily.revenueKrw} + ${priceKrw}`, updatedAt: sql`now()` } });
    // KRW 적재 멱등 마커(이 stage는 이 함수만 기록). 관리자 payment-events?txn=…에서 KRW 적재 시점 추적 겸용.
    await tx.insert(purchaseEvent).values({ projCode: PROJ_CODE, source: 'webhook', stage: 'revenue.krw', ok: true, outcome: 'applied', storeTxnId, price: priceKrw });
    return 'recorded' as const;
  });
}

/** 매출 **건수·다이아** 롤업 — 지급이 **실제 적용된(applied)** 경우만 1회(멱등: 원장 지급이 1회라 자연 1회). KRW는
 *  recordRevenueKrwOnce로 분리(confirm 선착 시 null→나중 웹훅이 txn 단위 멱등 보충). 관리자 대시보드 매출/전환율 원천. */
export async function recordPurchaseRevenue(priceKrw: number | null, diamonds: number, storeTxnId: string): Promise<void> {
  const day = new Date().toISOString().slice(0, 10); // UTC 달력일
  await ensureProj();
  await db.insert(statsDaily)
    .values({ projCode: PROJ_CODE, day, revenueKrw: 0, purchaseCount: 1, diamondsPurchased: diamonds })
    .onConflictDoUpdate({
      target: [statsDaily.projCode, statsDaily.day],
      set: {
        purchaseCount: sql`${statsDaily.purchaseCount} + 1`,
        diamondsPurchased: sql`${statsDaily.diamondsPurchased} + ${diamonds}`,
        updatedAt: sql`now()`,
      },
    });
  await recordRevenueKrwOnce(storeTxnId, priceKrw); // KRW는 멱등 분리(txn 마커) — confirm 선착 null이면 no-price 스킵, 웹훅이 보충
}
