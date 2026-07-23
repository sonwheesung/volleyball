// 출석 패스 + 월 1+1 라이브 검증 가드 (ATTENDANCE_PASS_SYSTEM §10 _dv_pass_live) — 실 HTTP 라우트 + dev DB.
// B4 day-0 grant / confirm dedup / 일일수령 멱등·유예(B3) / no-pass / B1 환불선착 tombstone / B2 클로백·claim↔환불 레이스 Σ정합
//   / 1+1 첫구매 2배·2번째 0·다음달 부활·환불 보너스 회수·월키 미복구 / R2 패스구매 건수 편입 / diamond_pass 1+1 비대상.
// 다일(dayIndex) 진행은 claimPassDaily(uid, now)에 제어 날짜 주입(서버 clock 이동 불가) — 라우트는 그 얇은 래퍼라 로직 동일.
// Usage: cd server && npx tsx tools/_dv_pass_live.ts   (dev DB 필요 — .env.development.local 우선, 없으면 DATABASE_URL 오버라이드)
import './_env';
process.env.RC_WEBHOOK_SECRET = 'test-secret-abcdef0123456789'; // ≥16자(fail-closed 통과) — import 전 주입
process.env.RC_REST_API_KEY = 'test-rc-key-abcdef0123456789'; // confirm rcVerifyPurchase 활성(모듈 const라 import 전 주입) — 실 네트워크는 fetch stub

(async () => {
  const { db } = await import('../db');
  const { users, walletLedger, attendancePasses, statsDaily, purchaseEvent } = await import('../db/schema');
  const { eq, and, sql, inArray } = await import('drizzle-orm');
  const { PROJ_CODE } = await import('../lib/proj');
  const { ensureProj } = await import('../lib/wallet');
  const { grantPass, claimPassDaily, clawbackPass, passDailyKey } = await import('../lib/pass');
  const { PASS_DAILY_REWARD, PASS_RESET_HOUR_KST } = await import('../lib/econ');
  const { todayKstResetAdjusted } = await import('../lib/dates');
  const { signToken } = await import('../lib/auth');
  const { POST: webhookPOST } = await import('../app/api/purchase/webhook/revenuecat/route');
  const { POST: confirmPOST } = await import('../app/api/purchase/confirm/route');
  const { POST: claimPOST } = await import('../app/api/pass/claim/route');

  let fail = 0;
  const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
  const SEC = 'test-secret-abcdef0123456789';
  const TAG = `_pass_live_${Date.now()}`;

  await ensureProj();
  // 테스트 유저 팩토리(시나리오별 격리 — 활성/큐 상호간섭 방지)
  const makeUser = async (sub: string): Promise<string> => {
    const [u] = await db.insert(users).values({ projCode: PROJ_CODE, provider: 'dev', providerId: `${TAG}_${sub}`, displayName: '_pass_test' }).returning({ id: users.id });
    return u.id;
  };
  const bal = async (uid: string) => { const r = await db.select({ d: walletLedger.delta }).from(walletLedger).where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.userId, uid))); return r.reduce((a, x) => a + x.d, 0); };
  const passRow = async (txn: string) => { const r = await db.select().from(attendancePasses).where(and(eq(attendancePasses.projCode, PROJ_CODE), eq(attendancePasses.storeTxnId, txn))).limit(1); return r[0]; };
  const D = (iso: string) => new Date(iso);
  const plusDays = (base: Date, k: number) => new Date(base.getTime() + k * 86_400_000);
  const webhook = (event: unknown, auth: string | null = SEC) => webhookPOST(new Request('http://x/api/purchase/webhook/revenuecat', { method: 'POST', headers: auth ? { authorization: auth, 'content-type': 'application/json' } : { 'content-type': 'application/json' }, body: JSON.stringify({ event }) }));
  const passEvent = (uid: string, txn: string, type: string, purchasedAt: Date, env = 'PRODUCTION') => ({ app_user_id: uid, transaction_id: txn, environment: env, type, product_id: 'diamond_pass', currency: 'KRW', price_in_purchased_currency: 9900, purchased_at_ms: purchasedAt.getTime() });
  // RC REST stub(confirm 폴백용) — non_subscriptions[productId]에 txn 실재.
  const realFetch = globalThis.fetch;
  const stubRc = (txn: string, productId: string) => { globalThis.fetch = (async () => new Response(JSON.stringify({ subscriber: { non_subscriptions: { [productId]: [{ store_transaction_id: txn, id: txn, is_sandbox: false }] } } }), { status: 200 })) as typeof fetch; };
  const restoreFetch = () => { globalThis.fetch = realFetch; };
  const TODAY_UTC = new Date().toISOString().slice(0, 10);
  const readStats = async () => { const r = await db.select({ cnt: statsDaily.purchaseCount, rev: statsDaily.revenueKrw, dia: statsDaily.diamondsPurchased, nu: statsDaily.newUsers }).from(statsDaily).where(and(eq(statsDaily.projCode, PROJ_CODE), eq(statsDaily.day, TODAY_UTC))); return r.length ? r[0] : { cnt: 0, rev: 0, dia: 0, nu: 0 }; };
  const statsSnap = await readStats();

  const D0 = D('2026-06-10T05:00:00Z'); // KST 06-10 14:00 → 리셋보정 2026-06-10
  const START0 = todayKstResetAdjusted(PASS_RESET_HOUR_KST, D0);

  console.log('── A. 패스 grant(웹훅) → 행 생성 + day-0 +100(B4) ──');
  const uA = await makeUser('A');
  const rA = await (await webhook(passEvent(uA, `${TAG}_A1`, 'NON_RENEWING_PURCHASE', D0))).json();
  ok(rA.ok === true && rA.applied === true && rA.outcome === 'activated', `패스 구매 웹훅 → applied·activated (실측 ${rA.outcome})`);
  const rowA = await passRow(`${TAG}_A1`);
  ok(!!rowA && rowA.status === 'active', 'attendance_passes 행 생성(status=active)');
  ok(rowA.startDate === START0, `start = 리셋보정 구매일 ${START0} (실측 ${rowA?.startDate})`);
  ok(await bal(uA) === PASS_DAILY_REWARD, `day-0 즉시 +100(B4 · claim 경유 아님) — 실측 ${await bal(uA)}`);
  const day0Row = await db.select({ id: walletLedger.id, ref: walletLedger.ref }).from(walletLedger).where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.idempotencyKey, passDailyKey(uA, rowA.id, 0)))).limit(1);
  ok(day0Row.length === 1 && day0Row[0].ref === `${TAG}_A1`, 'day-0 원장 키=pass_daily:<u>:<pass>:0, ref=storeTxnId(클로백 앵커)');

  console.log('── B. confirm dedup(웹훅 선착 → confirm 후착) ──');
  stubRc(`${TAG}_A1`, 'diamond_pass');
  const tokenA = signToken(`dev:${TAG}_A`);
  const cA = await (await confirmPOST(new Request('http://x/api/purchase/confirm', { method: 'POST', headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' }, body: JSON.stringify({ storeTxnId: `${TAG}_A1`, productId: 'diamond_pass' }) }))).json();
  restoreFetch();
  ok(cA.ok === true && cA.applied === false && cA.outcome === 'dup', `confirm 후착 → dup(applied false) — 실측 ${cA.outcome}`);
  ok(await bal(uA) === PASS_DAILY_REWARD, '  이중 day-0 없음(잔액 여전히 100)');
  const rowsA1 = await db.select({ id: attendancePasses.id }).from(attendancePasses).where(and(eq(attendancePasses.projCode, PROJ_CODE), eq(attendancePasses.storeTxnId, `${TAG}_A1`)));
  ok(rowsA1.length === 1, '  패스 행 1개(중복 생성 없음 — UNIQUE(proj,txn))');

  console.log('── C. 일일 수령 멱등·멀티데이(claim) ──');
  const cA_d0 = await claimPassDaily(uA, D0); // 당일 = day0 이미 수령
  ok(cA_d0.ok && cA_d0.reason === 'already' && cA_d0.slots === 0, `구매 당일 재claim → already·0슬롯(day0 이미 지급) — 실측 ${cA_d0.ok ? cA_d0.reason : cA_d0.reason}`);
  const cA_d1 = await claimPassDaily(uA, plusDays(D0, 1));
  ok(cA_d1.ok && cA_d1.reason === 'claimed' && cA_d1.slots === 1 && await bal(uA) === 200, `1일차 → +100(slot 1) 잔액 200 — 실측 잔액 ${await bal(uA)}·slots ${cA_d1.ok ? cA_d1.slots : 0}`);
  const cA_d1b = await claimPassDaily(uA, plusDays(D0, 1)); // 멀티기기 동시 = 같은 dayIndex 재시도
  ok(cA_d1b.ok && cA_d1b.slots === 0 && await bal(uA) === 200, '  같은 날 2회째 claim(멀티기기) → 0슬롯 dedup(이중수령 0, UI.4)');
  const cA_d2 = await claimPassDaily(uA, plusDays(D0, 2));
  ok(cA_d2.ok && cA_d2.slots === 1 && await bal(uA) === 300, `2일차 → +100 잔액 300(off2 후보 [0,1,2] 중 미수령 2만) — 실측 ${await bal(uA)}`);
  // HTTP 라우트 배선 확인(오늘 날짜 — 미래 패스라 no-pass지만 200 typed)
  const httpClaim = await (await claimPOST(new Request('http://x/api/pass/claim', { method: 'POST', headers: { authorization: `Bearer ${tokenA}` } }))).json();
  ok(httpClaim.ok === true && typeof httpClaim.reason === 'string', `POST /api/pass/claim 배선 → ok·typed reason(${httpClaim.reason})`);

  console.log('── D. no-pass(활성 패스 없음) ──');
  const uD = await makeUser('D');
  const cD = await claimPassDaily(uD, D0);
  ok(cD.ok && cD.reason === 'no-pass' && cD.granted === 0, `패스 미보유 → no-pass·0 — 실측 ${cD.ok ? cD.reason : cD.reason}`);

  console.log('── E. B3 유예 경계(만료+1일 지급 / 만료+4일 미지급) ──');
  const uE = await makeUser('E');
  await webhook(passEvent(uE, `${TAG}_E1`, 'NON_RENEWING_PURCHASE', D0)); // day-0 at D0
  const balE0 = await bal(uE);
  const cE28 = await claimPassDaily(uE, plusDays(D0, 28)); // off28 = 만료+1 → 후보 [26,27] 미수령 → +200
  ok(cE28.ok && cE28.slots === 2 && await bal(uE) === balE0 + 200, `만료+1일(off28) → 놓친 26·27 유예 수령 +200 — 실측 슬롯 ${cE28.ok ? cE28.slots : 0}·Δ${await bal(uE) - balE0}`);
  const cE31 = await claimPassDaily(uE, plusDays(D0, 31)); // off31 = 만료+4 → gate 밖
  ok(cE31.ok && cE31.reason === 'no-pass' && cE31.slots === 0, `만료+4일(off31 > end+G) → no-pass·미지급(gate 밖) — 실측 ${cE31.ok ? cE31.reason : cE31.reason}`);

  console.log('── F. B1 환불 선착(순서역전) → tombstone → 구매 후착 활성화 금지 ──');
  const uF = await makeUser('F');
  const rF_ref = await (await webhook(passEvent(uF, `${TAG}_F1`, 'CANCELLATION', D0))).json(); // 환불 먼저(행 없음)
  ok(rF_ref.ok === true, '환불 웹훅 선착(패스 행 없음) → ok');
  const rowF_tomb = await passRow(`${TAG}_F1`);
  ok(!!rowF_tomb && rowF_tomb.status === 'refunded', 'tombstone 선삽입(status=refunded) — 유령 활성 차단 준비');
  const rF_grant = await (await webhook(passEvent(uF, `${TAG}_F1`, 'NON_RENEWING_PURCHASE', D0))).json(); // 구매 후착
  ok(rF_grant.ok === true && rF_grant.applied === false && rF_grant.outcome === 'tombstoned-skip', `구매 후착 → tombstoned-skip(활성화 금지) — 실측 ${rF_grant.outcome}`);
  ok(await bal(uF) === 0, '  day-0 지급 0(유령 활성 0)');
  const rowsF = await db.select({ status: attendancePasses.status }).from(attendancePasses).where(and(eq(attendancePasses.projCode, PROJ_CODE), eq(attendancePasses.storeTxnId, `${TAG}_F1`)));
  ok(rowsF.length === 1 && rowsF[0].status === 'refunded', '  패스 행 여전히 refunded 1개(활성 안 됨)');
  const cF = await claimPassDaily(uF, plusDays(D0, 1));
  ok(cF.ok && cF.reason === 'no-pass', '  이후 claim 전부 no-pass');
  // A/B: tombstone 없는 구로직이면 후착 grant가 활성 패스+day0 생성(유령 활성) — 신로직은 refunded 봉인으로 차단(위 검증이 곧 A/B).

  console.log('── G. B2 클로백(패스 잠금→Σ→−Σ) + claim↔환불 레이스 Σ정합 ──');
  const uG = await makeUser('G');
  await webhook(passEvent(uG, `${TAG}_G1`, 'NON_RENEWING_PURCHASE', D0)); // day0 +100
  await claimPassDaily(uG, plusDays(D0, 3)); // off3 후보 [1,2,3] +300 → 총 400
  const balG_before = await bal(uG);
  ok(balG_before === 400, `클로백 전 4슬롯 수령 잔액 400 — 실측 ${balG_before}`);
  const rG_ref = await (await webhook(passEvent(uG, `${TAG}_G1`, 'REFUND', D0))).json();
  ok(rG_ref.ok === true && rG_ref.clawback === 400 && await bal(uG) === 0, `환불 → 클로백 −Σ(400)·잔액 0(수령분 전액 회수 A) — 실측 clawback ${rG_ref.clawback}·잔액 ${await bal(uG)}`);
  const rowG = await passRow(`${TAG}_G1`);
  ok(rowG.status === 'refunded', '  패스 종료(status=refunded)');
  const rG_ref2 = await (await webhook(passEvent(uG, `${TAG}_G1`, 'CANCELLATION', D0))).json();
  ok(rG_ref2.ok === true && await bal(uG) === 0, '  이중 환불 → 멱등(refund_pass 키 dedup·이중차감 0)');
  // claim↔환불 동시 레이스 — 새 패스, Promise.all로 동시 실행. user 행 잠금 직렬화 → 순서 무관 최종 잔액 0(clawback이 그 시점 Σ 회수).
  const uGr = await makeUser('Gr');
  await webhook(passEvent(uGr, `${TAG}_Gr1`, 'NON_RENEWING_PURCHASE', D0)); // day0 +100
  const raceNow = plusDays(D0, 5);
  const [claimRes] = await Promise.all([
    claimPassDaily(uGr, raceNow),
    clawbackPass(uGr, `${TAG}_Gr1`, 'diamond_pass', raceNow),
  ]);
  ok(await bal(uGr) === 0, `claim↔환불 동시(Promise.all) → 최종 잔액 0(Σ 정합·직렬화) — 실측 ${await bal(uGr)}, claim=${claimRes.ok ? claimRes.reason : claimRes.reason}`);
  const rowGr = await passRow(`${TAG}_Gr1`);
  ok(rowGr.status === 'refunded', '  레이스 후 패스 refunded(환불 승리 or claim후 클로백 — 어느 순서든 Σ 0)');

  console.log('── H. 월 1+1(팩) — 첫구매 2배·2번째 0·다음달 부활·환불 회수·월키 미복구 ──');
  process.env.PROMO_1P1_ENABLED = '1'; // 프로모 게이트 on(요청시점 read)
  const uH = await makeUser('H');
  const D_JUL = D('2026-07-10T05:00:00Z'), D_AUG = D('2026-08-10T05:00:00Z');
  const packEvent = (uid: string, txn: string, type: string, at: Date) => ({ app_user_id: uid, transaction_id: txn, environment: 'PRODUCTION', type, product_id: 'dia_1000', currency: 'KRW', price_in_purchased_currency: 3300, purchased_at_ms: at.getTime() });
  const h1 = await (await webhook(packEvent(uH, `${TAG}_H1`, 'NON_RENEWING_PURCHASE', D_JUL))).json();
  ok(h1.ok && await bal(uH) === 2000, `7월 첫 dia_1000 구매 → base 1000 + 1+1 보너스 1000 = 2000 — 실측 ${await bal(uH)}`);
  const h2 = await (await webhook(packEvent(uH, `${TAG}_H2`, 'NON_RENEWING_PURCHASE', D_JUL))).json();
  ok(h2.ok && await bal(uH) === 3000, `7월 2번째 구매(다른 txn) → base 1000만(보너스 dedup) = 3000 — 실측 ${await bal(uH)}`);
  const h3 = await (await webhook(packEvent(uH, `${TAG}_H3`, 'NON_RENEWING_PURCHASE', D_AUG))).json();
  ok(h3.ok && await bal(uH) === 5000, `8월 구매 → 월키 부활 base 1000 + 보너스 1000 = 5000 — 실측 ${await bal(uH)}`);
  // 환불 첫 txn(_H1) → base −1000 + 보너스 −1000 = −2000. 월키(7월) 미복구.
  const h1ref = await (await webhook(packEvent(uH, `${TAG}_H1`, 'CANCELLATION', D_JUL))).json();
  ok(h1ref.ok && await bal(uH) === 3000, `_H1 환불 → base+보너스 −2000 = 3000 — 실측 ${await bal(uH)}`);
  const bonusRev = await db.select({ id: walletLedger.id }).from(walletLedger).where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.userId, uH), eq(walletLedger.idempotencyKey, `refund_bonus:${uH}:${TAG}_H1`))).limit(1);
  ok(bonusRev.length === 1, '  1+1 보너스 회수 원장(refund_bonus 키) 1건');
  // 월키 미복구 → 7월 재구매(_H4) 보너스 0(파밍 차단)
  const h4 = await (await webhook(packEvent(uH, `${TAG}_H4`, 'NON_RENEWING_PURCHASE', D_JUL))).json();
  ok(h4.ok && await bal(uH) === 4000, `환불 후 7월 재구매 → base 1000만(월키 미복구·보너스 0) = 4000 — 실측 ${await bal(uH)}(파밍 차단)`);
  // A/B: 프로모 off면 보너스 없음 — 첫 구매도 base만
  process.env.PROMO_1P1_ENABLED = '';
  const uHoff = await makeUser('Hoff');
  const hoff = await (await webhook(packEvent(uHoff, `${TAG}_HOFF1`, 'NON_RENEWING_PURCHASE', D_JUL))).json();
  ok(hoff.ok && await bal(uHoff) === 1000, `[A/B] 프로모 off → 첫 구매도 base 1000만(보너스 0) — 실측 ${await bal(uHoff)}`);
  process.env.PROMO_1P1_ENABLED = '1';

  console.log('── I. diamond_pass는 1+1 비대상(구조적) ──');
  const uI = await makeUser('I');
  await webhook(passEvent(uI, `${TAG}_I1`, 'NON_RENEWING_PURCHASE', D_JUL));
  ok(await bal(uI) === PASS_DAILY_REWARD, `패스 구매 → day0 100만(1+1 보너스 없음 — pack 분기 미진입) — 실측 ${await bal(uI)}`);
  const iBonus = await db.select({ id: walletLedger.id }).from(walletLedger).where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.userId, uI), eq(walletLedger.reason, 'iap_bonus_1p1')));
  ok(iBonus.length === 0, '  패스엔 iap_bonus_1p1 원장 0건');
  process.env.PROMO_1P1_ENABLED = '';

  console.log('── J. Q1 중첩 큐잉(깊이 1) + 활성화 ──');
  const uJ = await makeUser('J');
  await webhook(passEvent(uJ, `${TAG}_J1`, 'NON_RENEWING_PURCHASE', D0)); // 활성
  const rowJ1 = await passRow(`${TAG}_J1`);
  const rJ2 = await grantPass(uJ, `${TAG}_J2`, D0, 'diamond_pass', false); // 중첩 → 큐
  ok(rJ2.ok && rJ2.outcome === 'queued', `2번째 구매(활성 중) → queued(예약) — 실측 ${rJ2.ok ? rJ2.outcome : rJ2.reason}`);
  const rowJ2 = await passRow(`${TAG}_J2`);
  ok(rowJ2.status === 'queued' && rowJ2.queuedAfter === rowJ1.id, '  예약 행 status=queued·queued_after=활성 passId(체인 앵커)');
  ok(await bal(uJ) === PASS_DAILY_REWARD, '  예약은 day-0 미지급(활성화 때 지급) — 잔액 100(J1 day0만)');
  const rJ3 = await grantPass(uJ, `${TAG}_J3`, D0, 'diamond_pass', false); // 3번째 → 큐 상한 초과
  ok(rJ3.ok && rJ3.outcome === 'queued-overflow', `3번째 구매 → queued-overflow(깊이 상한 1·ops 수동) — 실측 ${rJ3.ok ? rJ3.outcome : rJ3.reason}`);
  // 활성화 — J1 만료 후(J2 프로비저널 start = J1.end+1 = D0+28). claim at D0+28 → J2 활성화 + day0.
  const balJ_before = await bal(uJ);
  await claimPassDaily(uJ, plusDays(D0, 28));
  const rowJ2after = await passRow(`${TAG}_J2`);
  ok(rowJ2after.status === 'active', `J1 만료 후 claim → J2 큐 활성화(status=active) — 실측 ${rowJ2after.status}`);
  ok(await bal(uJ) > balJ_before, `  J2 활성화 시 day-0 지급(잔액 증가 ${balJ_before}→${await bal(uJ)})`);

  console.log('── K. R2 패스 구매 매출·건수 편입(payer 누락 방지) ──');
  const statsNow = await readStats();
  ok(statsNow.cnt >= statsSnap.cnt + 1, `패스/팩 구매가 purchaseCount에 편입(스냅 ${statsSnap.cnt} → 현재 ${statsNow.cnt}) — R2 payer 누락 방지`);
  ok(statsNow.rev >= statsSnap.rev + 9900, `패스 실매출 KRW 적재(₩9,900 이상 증가 — 스냅 ${statsSnap.rev} → ${statsNow.rev})`);

  // ── 정리 — 테스트 유저·패스·원장·감사행 삭제 + stats_daily 스냅 원복(공유 DB 오염 방지) ──
  const testUserIds = (await db.select({ id: users.id }).from(users).where(and(eq(users.projCode, PROJ_CODE), sql`${users.providerId} like ${TAG + '%'}`))).map((r) => r.id);
  if (testUserIds.length) {
    await db.delete(walletLedger).where(and(eq(walletLedger.projCode, PROJ_CODE), inArray(walletLedger.userId, testUserIds)));
    await db.delete(attendancePasses).where(and(eq(attendancePasses.projCode, PROJ_CODE), inArray(attendancePasses.userId, testUserIds)));
  }
  await db.delete(purchaseEvent).where(and(eq(purchaseEvent.projCode, PROJ_CODE), sql`${purchaseEvent.storeTxnId} like ${TAG + '%'}`));
  await db.update(statsDaily).set({ purchaseCount: statsSnap.cnt, revenueKrw: statsSnap.rev, diamondsPurchased: statsSnap.dia, newUsers: statsSnap.nu }).where(and(eq(statsDaily.projCode, PROJ_CODE), eq(statsDaily.day, TODAY_UTC)));
  if (testUserIds.length) await db.delete(users).where(inArray(users.id, testUserIds));
  restoreFetch();
  delete process.env.PROMO_1P1_ENABLED;
  console.log('  ✓ 정리 완료(테스트 유저·패스·원장·감사행 삭제 + stats_daily 원복)');

  console.log(fail === 0 ? '\n✅ _dv_pass_live 통과 — B4·confirm dedup·일일수령 멱등·B3 유예·no-pass·B1 tombstone·B2 클로백·레이스Σ·1+1(2배/부활/회수/미복구)·큐잉·R2 전부' : `\n❌ ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
