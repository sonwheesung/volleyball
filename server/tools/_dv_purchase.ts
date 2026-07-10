// 결제 검증 가드 (BACKEND_SYSTEM §13.18) — RC 웹훅 머니패스. 순수 판정 + 웹훅 라우트 통합(테스트 유저·정리).
// 검증: fail-closed 인증·샌드박스 무시·상품 매핑(서버 권위)·grant/refund·멱등 dedup·엔타이틀먼트 무시.
// Usage: cd server && npx tsx tools/_dv_purchase.ts (dev는 .env.development.local 우선, 없으면 .env.local — 운영 겨냥 시 DATABASE_URL 오버라이드)
import './_env'; // db 모듈 import 전에 env 주입(호이스팅 순서 — 첫 import)
process.env.RC_WEBHOOK_SECRET = 'test-secret-abcdef0123456789'; // ≥16자(fail-closed 통과용) — import 전 주입

(async () => {
  const { decidePurchaseEvent, verifyWebhookAuth, priceKrwOf, purchaseKey, refundKey } = await import('../lib/revenuecat');
  const { productDiamonds, DIAMOND_PRODUCTS } = await import('../lib/products');
  const { db } = await import('../db');
  const { walletLedger, users } = await import('../db/schema');
  const { eq, and } = await import('drizzle-orm');
  const { PROJ_CODE } = await import('../lib/proj');
  const { ensureProj } = await import('../lib/wallet');

  let fail = 0; const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
  const SEC = 'test-secret-abcdef0123456789';

  console.log('── 웹훅 인증(fail-closed) ──');
  ok(verifyWebhookAuth(SEC) === true, '정확한 시크릿 → 통과');
  ok(verifyWebhookAuth(`Bearer ${SEC}`) === true, 'Bearer 접두 형식도 통과');
  ok(verifyWebhookAuth('wrong') === false, '틀린 값 → 거부');
  ok(verifyWebhookAuth(null) === false, '헤더 없음 → 거부');

  console.log('── 이벤트 판정(순수·서버 권위) ──');
  const base = { app_user_id: '11111111-1111-1111-1111-111111111111', transaction_id: 'GPA.001', environment: 'PRODUCTION' };
  const grant = decidePurchaseEvent({ ...base, type: 'NON_RENEWING_PURCHASE', product_id: 'dia_1000', currency: 'KRW', price_in_purchased_currency: 3300 });
  ok(grant.action === 'grant' && grant.action === 'grant' && grant.diamonds === 1000 && grant.priceKrw === 3300, 'dia_1000 구매 → grant 1000·KRW 3300');
  const refund = decidePurchaseEvent({ ...base, type: 'CANCELLATION', product_id: 'dia_1000' });
  ok(refund.action === 'refund' && refund.diamonds === 1000, 'CANCELLATION → refund 1000');
  ok(decidePurchaseEvent({ ...base, type: 'NON_RENEWING_PURCHASE', product_id: 'dia_1000', environment: 'SANDBOX' }).action === 'ignore', 'SANDBOX → 무시(유령 다이아 방지)');
  ok(decidePurchaseEvent({ ...base, type: 'NON_RENEWING_PURCHASE', product_id: 'remove_ads' }).action === 'ignore', '엔타이틀먼트(remove_ads) → 무시(RC customerInfo 소유)');
  ok(decidePurchaseEvent({ ...base, type: 'NON_RENEWING_PURCHASE', product_id: 'dia_99999' }).action === 'ignore', '미등록 상품 → 무시(fail-closed)');
  ok(decidePurchaseEvent({ ...base, type: 'TEST', product_id: 'dia_1000' }).action === 'ignore', '미지원 타입 → 무시');
  ok(decidePurchaseEvent({ type: 'NON_RENEWING_PURCHASE', product_id: 'dia_1000' }).action === 'ignore', '필수 필드 누락 → 무시');
  // 엣지: 구독 이벤트(소모성엔 안 옴) 무시 — UNCANCELLATION이 지급이면 원구매 키와 dedup되어 환불 되돌림 어긋남
  for (const t of ['RENEWAL', 'UNCANCELLATION', 'EXPIRATION']) ok(decidePurchaseEvent({ ...base, type: t, product_id: 'dia_1000' }).action === 'ignore', `구독 이벤트 ${t} → 무시(소모성 전용)`);
  // 엣지: 익명 app_user_id($RCAnonymousID)·비-UUID → 무시(재시도 폭풍 방지, confirm 폴백이 메꿈)
  ok(decidePurchaseEvent({ ...base, app_user_id: '$RCAnonymousID:abc', type: 'NON_RENEWING_PURCHASE', product_id: 'dia_1000' }).action === 'ignore', '익명 id($RCAnonymousID) → 무시(logIn 누락 방어)');
  ok(decidePurchaseEvent({ ...base, app_user_id: 'not-a-uuid', type: 'NON_RENEWING_PURCHASE', product_id: 'dia_1000' }).action === 'ignore', '비-UUID app_user_id → 무시');
  ok(decidePurchaseEvent({ ...base, app_user_id: '12e03390-f90d-40d0-b3f4-2a1a6ac3698d', type: 'NON_RENEWING_PURCHASE', product_id: 'dia_1000' }).action === 'grant', 'UUID app_user_id → 정상 grant');
  ok(productDiamonds('dia_2500') === 2500 && productDiamonds('nope') === null, '상품 매핑(서버 권위·클라값 무시)');
  ok(priceKrwOf({ currency: 'USD', price_in_purchased_currency: 2.99 }) === null, '비-KRW 통화 → null(역산 금지)');
  ok(purchaseKey('u1', 'T9') === 'purchase:u1:T9' && refundKey('u1', 'T9') === 'refund:u1:T9', '멱등키=스토어거래id 자연키');

  console.log('── 웹훅 라우트 통합(테스트 유저·정리) ──');
  await ensureProj();
  const [tu] = await db.insert(users).values({ projCode: PROJ_CODE, provider: 'dev', providerId: `_test_purchase_${SEC}`, displayName: '_test_purchase' }).onConflictDoNothing().returning({ id: users.id });
  let uid = tu?.id;
  if (!uid) { const ex = await db.select({ id: users.id }).from(users).where(and(eq(users.projCode, PROJ_CODE), eq(users.provider, 'dev'), eq(users.providerId, `_test_purchase_${SEC}`))); uid = ex[0]?.id; }
  const { POST } = await import('../app/api/purchase/webhook/revenuecat/route');
  const post = (event: unknown, auth: string | null) => POST(new Request('http://x/api/purchase/webhook/revenuecat', { method: 'POST', headers: auth ? { authorization: auth, 'content-type': 'application/json' } : { 'content-type': 'application/json' }, body: JSON.stringify({ event }) }));
  const bal = async () => { const rows = await db.select({ d: walletLedger.delta }).from(walletLedger).where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.userId, uid!))); return rows.reduce((a, r) => a + r.d, 0); };

  const ev = { app_user_id: uid, transaction_id: '_TEST_TXN_1', environment: 'PRODUCTION', type: 'NON_RENEWING_PURCHASE', product_id: 'dia_1000' };
  const r401 = await post(ev, 'bad'); ok(r401.status === 401, '틀린 Authorization → 401(위조 차단)');
  ok(await bal() === 0, '  (401은 원장 무변화)');
  const r1 = await (await post(ev, SEC)).json(); ok(r1.ok && r1.applied === true, '정상 웹훅 → applied true');
  ok(await bal() === 1000, '  원장 +1000 반영');
  const r2 = await (await post(ev, SEC)).json(); ok(r2.ok && r2.applied === false, '같은 거래 재전송 → applied false(멱등 dedup)');
  ok(await bal() === 1000, '  이중지급 없음(잔액 그대로)');
  const rRef = await (await post({ ...ev, transaction_id: '_TEST_TXN_1', type: 'CANCELLATION' }, SEC)).json();
  ok(rRef.ok && await bal() === 0, '환불 웹훅(refund 키) → −1000(잔액 0)');
  const rRef2 = await (await post({ ...ev, transaction_id: '_TEST_TXN_1', type: 'REFUND' }, SEC)).json();
  ok(rRef2.ok && rRef2.applied === false && await bal() === 0, '엣지: 이중 환불(같은 txn) → dedup(잔액 0 유지·이중차감 없음)');
  // 엣지: 순서 역전 — 환불 웹훅이 지급보다 먼저 도착(새 txn). 가법 원장이라 순서 무관하게 순 0으로 수렴.
  const ev2 = { ...ev, transaction_id: '_TEST_TXN_2' };
  await post({ ...ev2, type: 'CANCELLATION' }, SEC); ok(await bal() === -1000, '  순서역전: 환불 먼저 → −1000(음수 허용)');
  await post({ ...ev2, type: 'NON_RENEWING_PURCHASE' }, SEC); ok(await bal() === 0, '  순서역전: 지급 나중 → 순 0(가법 수렴)');

  // 정리 — 테스트 원장·유저 삭제(공유 DB 오염 방지). statsDaily는 priceKrw 미포함(KRW 0)이라 매출 무변, count만 +1 — 복구.
  await db.delete(walletLedger).where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.userId, uid!)));
  await db.delete(users).where(eq(users.id, uid!));
  console.log('  ✓ 정리 완료(테스트 유저·원장 삭제)');

  console.log(fail === 0 ? '\n✅ 결제 검증 머니패스 — 인증·샌드박스·매핑·멱등·환불 전부 통과' : `\n❌ ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
