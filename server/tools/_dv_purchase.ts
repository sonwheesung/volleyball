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
  const { ensureProj, applyWallet } = await import('../lib/wallet');
  const { allowsNegativeBalance } = await import('../lib/econ');
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
  const readStats = async () => { const r = await db.select({ rev: statsDaily.revenueKrw, cnt: statsDaily.purchaseCount, dia: statsDaily.diamondsPurchased, nu: statsDaily.newUsers }).from(statsDaily).where(and(eq(statsDaily.projCode, PROJ_CODE), eq(statsDaily.day, TODAY))); return r.length ? r[0] : { rev: 0, cnt: 0, dia: 0, nu: 0 }; };
  const statsSnap = await readStats(); // 스냅샷 — 이 가드가 stats_daily에 더한 매출/건수/다이아/신규가입(S1-e rollupRecent가 덮음)을 정리 때 원복(공유 DB 오염 방지)
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

  console.log('── S1: RC_SANDBOX_GRANT 스위치 — 샌드박스 지급 모드(라이선스 테스터 내부테스트 §13.18 D1 정정 2026-07-17) ──');
  const { sandboxGrantEnabled } = await import('../lib/revenuecat');
  const SG_TXN = '_TEST_TXN_SBXGRANT', SG_PID = 'dia_1000';
  const sgEv = { app_user_id: uid, transaction_id: SG_TXN, environment: 'SANDBOX', type: 'NON_RENEWING_PURCHASE', product_id: SG_PID, currency: 'KRW', price_in_purchased_currency: 3300 };
  // off(미설정) — 스위치 없으면 SANDBOX는 현행대로 필터(fail-closed 기본). read는 요청시점이라 여기서 delete가 즉시 반영.
  delete process.env.RC_SANDBOX_GRANT;
  ok(sandboxGrantEnabled() === false, 'off: RC_SANDBOX_GRANT 미설정 → sandboxGrantEnabled false(fail-closed 기본)');
  ok(decidePurchaseEvent(sgEv).action === 'ignore', 'off: SANDBOX decide → ignore(현행 필터 유지 — 기존 D1 케이스 불변)');
  const balBeforeSG = await bal();
  const sgOff = await (await post(sgEv, SEC)).json();
  ok(sgOff.ok === true && sgOff.ignored === 'sandbox', '  off: 웹훅 SANDBOX → 200 ignored:sandbox(지급 안 함)');
  ok(await bal() === balBeforeSG, '  off: 원장 무변(prod 유령 다이아 0)');
  // on — 스위치 켜면 SANDBOX 지급 통과. 모듈 캐시 아닌 요청시점 read라 여기서 켠 게 즉시 반영(멱등키·잔액 A/B 가능).
  process.env.RC_SANDBOX_GRANT = 'all';
  ok(sandboxGrantEnabled() === true, 'on: RC_SANDBOX_GRANT=all → sandboxGrantEnabled true(요청시점 read — 모듈캐시 아님)');
  const dOn = decidePurchaseEvent(sgEv);
  ok(dOn.action === 'grant' && (dOn as any).sandbox === true, '(a) on: SANDBOX decide → grant(sandbox:true 표시)');
  const revBeforeSG = (await readStats()).rev, cntBeforeSG = (await readStats()).cnt, diaBeforeSG = (await readStats()).dia;
  const sgOn = await (await post(sgEv, SEC)).json();
  ok(sgOn.ok === true && sgOn.applied === true, '(a) on: 웹훅 SANDBOX grant → applied true(테스터 결제 지급)');
  ok(await bal() === balBeforeSG + 1000, `  (a) 원장 +1000 지급됨 — 실측 ${await bal() - balBeforeSG}`);
  // (a) 원장 ref = productId:sandbox 마커(감사 구분) · 멱등키는 store txn 기반(마커 없음 — 환불 dedup 동일키).
  const sgRow = await db.select({ ref: walletLedger.ref, key: walletLedger.idempotencyKey }).from(walletLedger).where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.idempotencyKey, purchaseKey(uid!, SG_TXN)))).limit(1);
  ok(sgRow.length === 1 && sgRow[0].ref === `${SG_PID}:sandbox`, `  (a) 원장 ref=dia_1000:sandbox 마커(감사 구분) — 실측 ${sgRow[0]?.ref}`);
  ok(sgRow[0]?.key === `purchase:${uid}:${SG_TXN}`, '  (a) 멱등키는 store txn 기반(마커 없음 — 환불이 같은 키 봐야 함)');
  // (c) 매출 오염 방지 — statsDaily 매출 KRW·건수·다이아 무증가(샌드박스는 실매출 아님, 집계 전면 제외).
  ok((await readStats()).rev - revBeforeSG === 0, `(c) statsDaily 매출 KRW 무증가(샌드박스 매출 집계 제외) — 실측 Δ${(await readStats()).rev - revBeforeSG}`);
  ok((await readStats()).cnt - cntBeforeSG === 0, '  (c) 구매 건수 무증가(집계 제외)');
  ok((await readStats()).dia - diaBeforeSG === 0, '  (c) 다이아 집계 무증가(실매출 전용)');
  // (b) 같은 모드 SANDBOX 환불 → 클로백 적용(원장 −1000, 순 0 — 샌드박스 환불도 검증돼야 함).
  const sgRef = await (await post({ ...sgEv, type: 'CANCELLATION' }, SEC)).json();
  ok(sgRef.ok === true && await bal() === balBeforeSG, `(b) on: SANDBOX 환불 → 클로백 −1000(순 0) — 실측 잔액 ${await bal() - balBeforeSG}`);
  const sgRefRow = await db.select({ ref: walletLedger.ref }).from(walletLedger).where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.idempotencyKey, refundKey(uid!, SG_TXN)))).limit(1);
  ok(sgRefRow.length === 1 && sgRefRow[0].ref === `${SG_PID}:sandbox`, '  (b) 환불 원장도 :sandbox 마커(감사 구분)');
  ok((await readStats()).rev - revBeforeSG === 0, '  (b) 환불 후에도 매출 KRW 무증가(샌드박스 격리 유지)');
  // (d) A/B — 스위치 되돌림(delete) → 다시 필터(fail-closed 복귀). 웹훅·confirm 폴백 대칭 확인.
  delete process.env.RC_SANDBOX_GRANT;
  ok(sandboxGrantEnabled() === false && decidePurchaseEvent(sgEv).action === 'ignore', '(d) A/B: 스위치 delete → SANDBOX decide 다시 ignore(fail-closed 복귀)');
  const balBeforeSGd = await bal();
  const sgOffAgain = await (await post({ ...sgEv, transaction_id: '_TEST_TXN_SBXGRANT_D' }, SEC)).json();
  ok(sgOffAgain.ignored === 'sandbox' && await bal() === balBeforeSGd, '  (d) 되돌린 뒤 웹훅 SANDBOX → 다시 ignored:sandbox·원장 무변(스위치 없으면 필터)');
  // confirm 폴백 대칭 — on: is_sandbox 통과(sandbox:true) / off: 다시 sandbox 거절.
  const SG_CONF = '_TEST_TXN_SBXCONF';
  process.env.RC_SANDBOX_GRANT = 'all';
  stubRc(SG_CONF, SG_PID, true);
  const vSgOn = await rcVerifyPurchase(uid!, SG_CONF, SG_PID);
  ok(vSgOn.ok === true && (vSgOn as any).sandbox === true, '(a) confirm 폴백: on → is_sandbox 통과(sandbox:true — 웹훅과 대칭)');
  delete process.env.RC_SANDBOX_GRANT;
  const vSgOff = await rcVerifyPurchase(uid!, SG_CONF, SG_PID);
  ok(vSgOff.ok === false && (vSgOff as { ok: false; reason: string }).reason === 'sandbox', '(d) confirm 폴백: off → 다시 sandbox 거절(대칭 복귀)');
  restoreFetch();
  delete process.env.RC_SANDBOX_GRANT; // 이후 섹션(B1·A1·부채)은 스위치 off로 — 최종 상태 보장

  console.log('── S1-e: 크론 롤업 경로 샌드박스 제외(다중 라이터 대칭 §13.18 D1 정정 2026-07-18) ──');
  // statsDaily는 두 라이터가 같은 행을 쓴다: (1)이벤트 시 증분 recordPurchaseRevenue, (2)매일 크론 rollupRecent 재집계.
  // D1(2026-07-17)은 (1)만 샌드박스 제외했고 (2)가 :sandbox ref 무관하게 재집계해 **덮어써** 필터를 무효화했음(prod 실측 count=6·dia=19100).
  // 검증: 실 원장행 + 샌드박스 원장행을 넣고 rollupRecent가 **실 건만** 집계하는지(크론 경로 대칭 제외).
  const { rollupRecent } = await import('../lib/retention');
  const ROLLUP_REAL_KEY = `purchase:${uid}:_ROLLUP_REAL`, ROLLUP_SBX_KEY = `purchase:${uid}:_ROLLUP_SBX`;
  const insLedger = (key: string, ref: string) => db.insert(walletLedger).values({ projCode: PROJ_CODE, userId: uid!, delta: 1000, reason: 'purchase', ref, idempotencyKey: key, balanceAfter: 0 });
  // 베이스라인 롤업(기존 원장 반영) — 앞 섹션이 남긴 실 purchase 행이 있어 절대값 아닌 **델타**로 검증.
  await rollupRecent();
  const rlBase = await readStats();
  // (1) 샌드박스 행만 삽입 → rollup → 건수·다이아 무증가여야(크론 재집계도 :sandbox 대칭 제외).
  await insLedger(ROLLUP_SBX_KEY, 'dia_1000:sandbox');
  await rollupRecent();
  const rlSbx = await readStats();
  ok(rlSbx.cnt - rlBase.cnt === 0 && rlSbx.dia - rlBase.dia === 0, `S1-e(1) 샌드박스 원장행 후 rollup → Δ건수 0·Δ다이아 0(크론 재집계도 :sandbox 제외) — 실측 Δcnt ${rlSbx.cnt - rlBase.cnt}·Δdia ${rlSbx.dia - rlBase.dia}`);
  // (2) 실 결제 행 추가 → rollup → 정확히 +1건·+1000(실 건만 반영).
  await insLedger(ROLLUP_REAL_KEY, 'dia_1000');
  await rollupRecent();
  const rlReal = await readStats();
  ok(rlReal.cnt - rlBase.cnt === 1 && rlReal.dia - rlBase.dia === 1000, `S1-e(2) 실 원장행 추가 후 rollup → Δ건수 1·Δ다이아 1000(샌드박스 격리, 실 건만) — 실측 Δcnt ${rlReal.cnt - rlBase.cnt}·Δdia ${rlReal.dia - rlBase.dia}`);
  // A/B: 같은 2행을 구 롤업 쿼리(제외 없음) vs 신 롤업 쿼리(:sandbox 제외)로 집계 — 프로덕션 코드 무변, 가드 안에서 별도 실행(뮤턴트 박제 금지).
  const abOldRows = (await db.execute(sql`
    SELECT count(*)::int AS cnt, coalesce(sum(delta), 0)::int AS dia
    FROM wallet_ledger
    WHERE proj_code = ${PROJ_CODE} AND reason = 'purchase'
      AND idempotency_key IN (${ROLLUP_REAL_KEY}, ${ROLLUP_SBX_KEY})`)) as unknown as Array<{ cnt: number; dia: number }>;
  const abNewRows = (await db.execute(sql`
    SELECT count(*)::int AS cnt, coalesce(sum(delta), 0)::int AS dia
    FROM wallet_ledger
    WHERE proj_code = ${PROJ_CODE} AND reason = 'purchase'
      AND (ref IS NULL OR ref NOT LIKE '%:sandbox')
      AND idempotency_key IN (${ROLLUP_REAL_KEY}, ${ROLLUP_SBX_KEY})`)) as unknown as Array<{ cnt: number; dia: number }>;
  const abOld = abOldRows[0], abNew = abNewRows[0];
  ok(abOld.cnt === 2 && abOld.dia === 2000, `  [A/B] 구 롤업 쿼리(제외 없음) → 같은 2행 count=2·dia=2000(샌드박스 오염 = 덮어쓰기로 D1 필터 무효화 재현) — 실측 ${abOld.cnt}·${abOld.dia}`);
  ok(abNew.cnt === 1 && abNew.dia === 1000, `  [A/B] 신 롤업 쿼리(:sandbox 제외) → 같은 2행 count=1·dia=1000(민감도 증명) — 실측 ${abNew.cnt}·${abNew.dia}`);
  // 정리: 삽입 2행 선삭제(최종 cleanup의 uid 전체 삭제 전, statsDaily 스냅 원복 정확성 확보 — newUsers 포함 원복은 최종 cleanup).
  await db.delete(walletLedger).where(and(eq(walletLedger.projCode, PROJ_CODE), sql`${walletLedger.idempotencyKey} in (${ROLLUP_REAL_KEY}, ${ROLLUP_SBX_KEY})`));

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

  console.log('── 부채 상환: 음수 잔액 탈출(게이트 차감 전용 §13.17 P0-1, 결제표면 감사 P1) ──');
  // 머니크리티컬: 게이트가 delta 부호를 미구분해 적립까지 거부하던 음수 탈출 불가 트랩을 A/B로 봉인.
  // 시나리오: 환불로 −700 → 광고/업적 적립은 통과(부채 감소) · 전지훈련(차감)은 여전히 거부 · 충전 후 spend 재개.
  const b0 = await bal();
  const rNeg = await applyWallet(uid!, -700 - b0, 'refund', '_DEBT_REFUND', 'force-negative'); // refund=음수 허용
  ok(rNeg.ok && await bal() === -700, `환불로 잔액 −700 진입(refund 음수 허용) — 실측 ${await bal()}`);
  // ① 음수에서 적립(+50) 통과 → 부채 감소(−700 → −650). **이게 P1 핵심**(구게이트는 여기서 거부했음).
  const rEarn1 = await applyWallet(uid!, 50, 'ad', '_DEBT_AD1', 'debt-repay');
  ok(rEarn1.ok && rEarn1.applied === true && rEarn1.balance === -650, `① 음수서 광고 +50 통과 → −650(부채 감소) — 실측 ${rEarn1.ok ? rEarn1.balance : rEarn1.reason}`);
  const rEarn2 = await applyWallet(uid!, 50, 'achievement', '_DEBT_ACH1', 'debt-repay'); // 다른 적립 reason도 동일(업적)
  ok(rEarn2.ok && rEarn2.balance === -600, `  업적 +50도 통과 → −600(적립 reason 공통) — 실측 ${rEarn2.ok ? rEarn2.balance : rEarn2.reason}`);
  // ② 같은 음수 상태에서 차감(camp −300)은 여전히 거부(spend 게이트 불변 — 절대 약화 안 됨).
  const rSpendNeg = await applyWallet(uid!, -300, 'camp', '_DEBT_CAMP1', 'still-blocked');
  ok(rSpendNeg.ok === false && (rSpendNeg as { reason: string }).reason === 'insufficient' && await bal() === -600, '② 음수서 전지훈련(−300) 차감은 여전히 insufficient(잔액 불변 −600)');
  // ③ 적립 반복(쿠폰 등)으로 상환·충전 → 잔액 ≥300 되면 차감(spend) 재개.
  const rAdj = await applyWallet(uid!, 900, 'coupon', '_DEBT_COUP1', 'top-up'); // 쿠폰 적립도 음수서 통과 → −600+900=300
  ok(rAdj.ok && rAdj.balance === 300, `③ 쿠폰 +900 통과 → 300(0 넘어 충전) — 실측 ${rAdj.ok ? rAdj.balance : rAdj.reason}`);
  const rSpendOk = await applyWallet(uid!, -300, 'camp', '_DEBT_CAMP2', 'resumed');
  ok(rSpendOk.ok && rSpendOk.balance === 0, `③ 충전 후 전지훈련(−300) 차감 재개 → 0(spend 정상 복귀) — 실측 ${rSpendOk.ok ? rSpendOk.balance : rSpendOk.reason}`);
  // 재확인: 잔액 0에서 차감은 다시 거부(spend 게이트 방향 불변).
  const rSpendZero = await applyWallet(uid!, -300, 'camp', '_DEBT_CAMP3', 'blocked-at-0');
  ok(rSpendZero.ok === false && (rSpendZero as { reason: string }).reason === 'insufficient', '  잔액 0서 −300 차감 재거부(차감 게이트 방향 불변)');
  // ④ A/B — 구게이트(`!allowsNegativeBalance(reason) && next<0`, delta 부호 미검사)를 재현: ①의 적립(+50 at −700)을 거부했음을 증명.
  const oldGateRejects = (reason: string, cur: number, delta: number) => !allowsNegativeBalance(reason) && (cur + delta) < 0; // 구로직(방향 미구분)
  const newGateRejects = (reason: string, cur: number, delta: number) => delta < 0 && (cur + delta) < 0 && !allowsNegativeBalance(reason); // 신로직(차감 전용)
  ok(oldGateRejects('ad', -700, 50) === true, '  [A/B] 구게이트 → 음수서 광고 적립(+50)을 거부(=음수 탈출 불가 트랩 재현)');
  ok(newGateRejects('ad', -700, 50) === false, '  [A/B] 신게이트 → 같은 적립 통과(부채 상환 경로 — 트랩 해소)');
  ok(oldGateRejects('camp', -600, -300) === true && newGateRejects('camp', -600, -300) === true, '  [A/B] 차감(camp)은 구·신 게이트 모두 거부(spend 방어 동일 유지 — 약화 0)');

  // 정리 — 테스트 원장·유저·감사행 삭제 + stats_daily 스냅샷 원복(공유 DB 오염 방지).
  await db.delete(walletLedger).where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.userId, uid!)));
  await db.delete(purchaseEvent).where(and(eq(purchaseEvent.projCode, PROJ_CODE), sql`${purchaseEvent.storeTxnId} like '_TEST\\_%'`));
  await db.update(statsDaily).set({ revenueKrw: statsSnap.rev, purchaseCount: statsSnap.cnt, diamondsPurchased: statsSnap.dia, newUsers: statsSnap.nu }).where(and(eq(statsDaily.projCode, PROJ_CODE), eq(statsDaily.day, TODAY)));
  await db.delete(users).where(eq(users.id, uid!));
  console.log('  ✓ 정리 완료(테스트 유저·원장·감사행 삭제 + stats_daily 원복)');

  console.log(fail === 0 ? '\n✅ 결제 검증 머니패스 — 인증·샌드박스(웹훅+confirm+크론롤업 3경로 대칭)·매핑·멱등·환불·익명환불 관측·KRW 보충 전부 통과' : `\n❌ ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
