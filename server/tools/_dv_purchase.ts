// 결제 검증 가드 (BACKEND_SYSTEM §13.18) — RC 웹훅 머니패스. 순수 판정 + 웹훅 라우트 통합(테스트 유저·정리).
// 검증: fail-closed 인증·샌드박스 무시·상품 매핑(서버 권위)·grant/refund·멱등 dedup·엔타이틀먼트 무시.
// Usage: cd server && npx tsx tools/_dv_purchase.ts (dev는 .env.development.local 우선, 없으면 .env.local — 운영 겨냥 시 DATABASE_URL 오버라이드)
import './_env'; // db 모듈 import 전에 env 주입(호이스팅 순서 — 첫 import)
process.env.RC_WEBHOOK_SECRET = 'test-secret-abcdef0123456789'; // ≥16자(fail-closed 통과용) — import 전 주입
process.env.RC_REST_API_KEY = 'test-rc-key-abcdef0123456789'; // confirm 폴백 rcVerifyPurchase가 활성화되게(모듈 const라 import 전 주입) — 실 네트워크는 fetch stub로 대체

(async () => {
  const { decidePurchaseEvent, verifyWebhookAuth, priceKrwOf, purchaseKey, refundKey, rcVerifyPurchase } = await import('../lib/revenuecat');
  const { productDiamonds, DIAMOND_PRODUCTS } = await import('../lib/products');
  const { db } = await import('../db');
  const { walletLedger, users, statsDaily, purchaseEvent } = await import('../db/schema');
  const { eq, and, sql } = await import('drizzle-orm');
  const { PROJ_CODE } = await import('../lib/proj');
  const { ensureProj } = await import('../lib/wallet');
  const { signToken } = await import('../lib/auth');

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
  const anonGrant = decidePurchaseEvent({ ...base, app_user_id: '$RCAnonymousID:abc', type: 'NON_RENEWING_PURCHASE', product_id: 'dia_1000' });
  ok(anonGrant.action === 'ignore' && anonGrant.action === 'ignore' && (anonGrant as any).reason === 'anonymous-user', '익명 지급 → 무시(reason=anonymous-user, confirm 폴백이 메꿈 — 현행 유지)');
  ok(decidePurchaseEvent({ ...base, app_user_id: 'not-a-uuid', type: 'NON_RENEWING_PURCHASE', product_id: 'dia_1000' }).action === 'ignore', '비-UUID app_user_id → 무시');
  // B1(§13.18): 익명 **환불**은 조용한 유실 금지 — 지급 익명과 **다른 사유**(anonymous-refund)로 구분돼야 라우트가 기록+관측
  const anonRefund = decidePurchaseEvent({ ...base, app_user_id: '$RCAnonymousID:abc', type: 'CANCELLATION', product_id: 'dia_1000' });
  ok(anonRefund.action === 'ignore' && (anonRefund as any).reason === 'anonymous-refund', 'B1: 익명 CANCELLATION → reason=anonymous-refund(지급 익명과 구분 — 유실 관측용)');
  const anonRefund2 = decidePurchaseEvent({ ...base, app_user_id: 'not-a-uuid', type: 'REFUND', product_id: 'dia_1000' });
  ok(anonRefund2.action === 'ignore' && (anonRefund2 as any).reason === 'anonymous-refund', 'B1: 익명 REFUND(비-UUID) → reason=anonymous-refund');
  // A/B: 구로직(타입 무시하고 무조건 anonymous-user) 재현 → 환불도 anonymous-user로 뭉개져 라우트가 dropped 마커/알림을 못 냄(결함)
  const abOldAnon = (userId: string, _type: string) => (userId.startsWith('$') || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId) ? 'anonymous-user' : 'ok');
  ok(abOldAnon('$RCAnonymousID:abc', 'CANCELLATION') === 'anonymous-user', '  [A/B] 구로직 → 익명 환불이 anonymous-user로 뭉개짐(dropped 미기록 = 가드가 잡아야 할 유실)');
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
  // 잔액 by txn(A1 이중지급 검사용) — 특정 storeTxnId 관련 원장 합(purchase 키 ref는 productId라 txn은 idempotencyKey로 매칭).
  const TODAY = new Date().toISOString().slice(0, 10);
  const readStats = async () => { const r = await db.select({ rev: statsDaily.revenueKrw, cnt: statsDaily.purchaseCount, dia: statsDaily.diamondsPurchased }).from(statsDaily).where(and(eq(statsDaily.projCode, PROJ_CODE), eq(statsDaily.day, TODAY))); return r.length ? r[0] : { rev: 0, cnt: 0, dia: 0 }; };
  const statsSnap = await readStats(); // 스냅샷 — 이 가드가 stats_daily에 더한 매출/건수/다이아를 정리 때 원복(공유 DB 오염 방지)
  // purchase_event 감사행 존재 폴링 — logPaymentEventAfter는 fire-and-forget(afterSafe→void task)이라 insert 완료를 폴로 기다림.
  const waitEvent = async (txn: string, stage: string): Promise<boolean> => {
    for (let i = 0; i < 40; i++) {
      const r = await db.select({ id: purchaseEvent.id }).from(purchaseEvent).where(and(eq(purchaseEvent.projCode, PROJ_CODE), eq(purchaseEvent.storeTxnId, txn), eq(purchaseEvent.stage, stage))).limit(1);
      if (r.length) return true;
      await new Promise((res) => setTimeout(res, 25));
    }
    return false;
  };
  // RC REST subscriber 응답 stub — 실 네트워크 금지(모킹 계층). is_sandbox: true|false|undefined(부재) 주입.
  const realFetch = globalThis.fetch;
  const stubRc = (txn: string, productId: string, isSandbox: boolean | undefined) => {
    globalThis.fetch = (async () => {
      const entry: Record<string, unknown> = { store_transaction_id: txn, id: txn, purchase_date: '2026-07-16T00:00:00Z', store: 'play_store' };
      if (isSandbox !== undefined) entry.is_sandbox = isSandbox;
      return new Response(JSON.stringify({ subscriber: { non_subscriptions: { [productId]: [entry] } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
  };
  const restoreFetch = () => { globalThis.fetch = realFetch; };
  const token = signToken(`dev:_test_purchase_${SEC}`); // confirm 라우트 requireUserId용 Bearer(테스트 유저 sub)
  const { POST: confirmPOST } = await import('../app/api/purchase/confirm/route');
  const confirm = (storeTxnId: string, productId: string) => confirmPOST(new Request('http://x/api/purchase/confirm', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ storeTxnId, productId }) }));

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

  console.log('── D1: confirm 폴백 × SANDBOX 필터(웹훅 environment 필터와 대칭 §13.18) ──');
  const SBX_TXN = '_TEST_TXN_SBX', PID = 'dia_1000';
  stubRc(SBX_TXN, PID, true);
  const vSbx = await rcVerifyPurchase(uid!, SBX_TXN, PID);
  ok(vSbx.ok === false && (vSbx as { ok: false; reason: string }).reason === 'sandbox', 'is_sandbox:true 항목 → rcVerifyPurchase 실패(reason=sandbox·지급 0)');
  stubRc(SBX_TXN, PID, false);
  ok((await rcVerifyPurchase(uid!, SBX_TXN, PID)).ok === true, 'is_sandbox:false → 검증 통과(지급 대상)');
  stubRc(SBX_TXN, PID, undefined);
  ok((await rcVerifyPurchase(uid!, SBX_TXN, PID)).ok === true, 'is_sandbox 부재(스키마 이상) → prod 간주(grant) — 정상결제 "돈 내고 0개" 방지');
  // A/B: 필터 없는 구로직 재현(is_sandbox 미검사) → 같은 샌드박스 항목이 지급 통과 = 가드가 잡아야 할 결함 실증
  const oldVerify = (list: Array<{ store_transaction_id?: string; id?: string }>, txn: string) => (list.some((t) => String(t.store_transaction_id ?? t.id ?? '') === txn) ? { ok: true } : { ok: false });
  ok(oldVerify([{ store_transaction_id: SBX_TXN }], SBX_TXN).ok === true, '  [A/B] 구로직(is_sandbox 미검사) → 샌드박스가 지급 통과(비대칭 버그 = 검출됨)');
  // confirm 라우트 통합 — 샌드박스 항목 → 지급 0 + confirm.sandbox.filtered 감사행
  stubRc(SBX_TXN, PID, true);
  const balBeforeSbx = await bal();
  const cSbx = await confirm(SBX_TXN, PID); const cSbxJson = await cSbx.json();
  ok(cSbx.status === 200 && cSbxJson.ignored === 'sandbox', 'confirm×샌드박스 → 200 ignored:sandbox(지급 안 함)');
  ok(await bal() === balBeforeSbx, '  confirm 샌드박스는 원장 무변(prod 유령 다이아 0)');
  ok(await waitEvent(SBX_TXN, 'confirm.sandbox.filtered'), '  confirm.sandbox.filtered 감사 1행 기록(웹훅 필터와 대칭 관측)');
  restoreFetch();

  console.log('── B1: 익명 환불 웹훅 조용한 유실 방지(관측 있는 무시 §13.18) ──');
  const ANON_TXN = '_TEST_TXN_ANONREF';
  const balBeforeAnon = await bal();
  const rAnon = await (await post({ app_user_id: '$RCAnonymousID:xyz', transaction_id: ANON_TXN, environment: 'PRODUCTION', type: 'CANCELLATION', product_id: 'dia_1000', currency: 'KRW', price_in_purchased_currency: 9300 }, SEC)).json();
  ok(rAnon.ok === true && rAnon.ignored === 'anonymous-refund', '익명 CANCELLATION → 200 ignored:anonymous-refund(지급/회수 0)');
  ok(await bal() === balBeforeAnon, '  원장 무변(익명이라 귀속 불가 — 회수 0)');
  ok(await waitEvent(ANON_TXN, 'refund.anonymous.dropped'), '  refund.anonymous.dropped 감사행 존재(조용한 유실 아님 — txn·상품·금액 기록)');
  // A/B: 구로직(익명 환불도 webhook.ignored로 뭉갬)이면 dropped 마커가 없어 유실이 무흔적 — 부재로 검출
  ok(!(await waitEvent(ANON_TXN, 'webhook.ignored')), '  [A/B] 구로직 stage(webhook.ignored) 미기록 확인(신로직은 dropped로 분리 기록)');

  console.log('── A1: confirm 선착 → 웹훅 후착 dedup 시 KRW 보충(매출 영구 ₩0 방지 §13.18) ──');
  const A1_TXN = '_TEST_TXN_A1', A1_PRICE = 9300;
  const revBefore = (await readStats()).rev, cntBefore = (await readStats()).cnt;
  // [A] confirm 선착 지급(KRW 미상 → null). 구버그: 여기서 멈추면 KRW 영구 0.
  stubRc(A1_TXN, PID, false);
  const cA1 = await confirm(A1_TXN, PID); const cA1Json = await cA1.json();
  restoreFetch();
  ok(cA1Json.ok === true && cA1Json.applied === true, 'confirm 선착 → applied true(다이아 지급)');
  ok(await bal() === balBeforeAnon + 1000, '  원장 +1000(confirm 지급)');
  ok((await readStats()).rev - revBefore === 0, '  [A] confirm 직후 KRW 델타 0(구버그 = 관리자 매출 영구 ₩0의 지점)');
  // [B] 웹훅 후착(KRW 보유) → dedup(applied false)인데 KRW만 보충
  const wA1 = await (await post({ app_user_id: uid, transaction_id: A1_TXN, environment: 'PRODUCTION', type: 'NON_RENEWING_PURCHASE', product_id: 'dia_1000', currency: 'KRW', price_in_purchased_currency: A1_PRICE }, SEC)).json();
  ok(wA1.ok === true && wA1.applied === false, '웹훅 후착 → dedup(applied false·다이아 재지급 없음)');
  ok(await bal() === balBeforeAnon + 1000, '  [B] 원장 여전히 +1000(이중지급 없음)');
  ok((await readStats()).rev - revBefore === A1_PRICE, `  [B] KRW 보충됨(revenueKrw +${A1_PRICE} — 관리자 매출 조회 가능)`);
  ok((await readStats()).cnt - cntBefore === 1, '  건수는 1회만(confirm applied 1건 — dedup은 건수 증가 없음)');
  // 멱등: 웹훅 재시도(같은 txn) → KRW 이중집계 없음
  await post({ app_user_id: uid, transaction_id: A1_TXN, environment: 'PRODUCTION', type: 'NON_RENEWING_PURCHASE', product_id: 'dia_1000', currency: 'KRW', price_in_purchased_currency: A1_PRICE }, SEC);
  ok((await readStats()).rev - revBefore === A1_PRICE, '  웹훅 재시도 → KRW 그대로(revenue.krw 마커로 멱등, 이중집계 0)');

  // 정리 — 테스트 원장·유저·감사행 삭제 + stats_daily 스냅샷 원복(공유 DB 오염 방지).
  await db.delete(walletLedger).where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.userId, uid!)));
  await db.delete(purchaseEvent).where(and(eq(purchaseEvent.projCode, PROJ_CODE), sql`${purchaseEvent.storeTxnId} like '_TEST\\_%'`));
  await db.update(statsDaily).set({ revenueKrw: statsSnap.rev, purchaseCount: statsSnap.cnt, diamondsPurchased: statsSnap.dia }).where(and(eq(statsDaily.projCode, PROJ_CODE), eq(statsDaily.day, TODAY)));
  await db.delete(users).where(eq(users.id, uid!));
  console.log('  ✓ 정리 완료(테스트 유저·원장·감사행 삭제 + stats_daily 원복)');

  console.log(fail === 0 ? '\n✅ 결제 검증 머니패스 — 인증·샌드박스(웹훅+confirm 대칭)·매핑·멱등·환불·익명환불 관측·KRW 보충 전부 통과' : `\n❌ ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
