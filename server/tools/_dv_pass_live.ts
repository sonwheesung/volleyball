// 다이아 패스 라이브 검증 가드 (DIAMOND_PASS_SYSTEM §10 _dv_pass_live) — 실 HTTP 라우트 + 스케줄러 코어 + dev DB.
// ★ 재개정(2026-07-23, 스케줄러 우편): B4 day-0=우편 도착(즉시 원장 아님) / 우편 claim=+100 reason'pass_daily' / 스케줄러 캐치업 멱등·이중발송 0
//   / 환불 recall(미수령 우편 봉인)+클로백 Σ(passId 앵커) 정합 / B1 환불선착 tombstone / claim↔환불 레이스 / 1+1(2배/부활/회수/미복구) / Q1 큐잉(활성화=우편) / R2 건수.
// 날짜: 실 today(KST) 기준 오프셋(mail expiresAt=발송now+30일이 미래여야 claim 가능 — 과거 고정일이면 우편이 즉시 만료). 정오(KST 12:00) 앵커로 리셋 경계 회피.
// Usage: cd server && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx tsx tools/_dv_pass_live.ts
import './_env';
process.env.RC_WEBHOOK_SECRET = 'test-secret-abcdef0123456789'; // ≥16자(fail-closed 통과) — import 전 주입
process.env.RC_REST_API_KEY = 'test-rc-key-abcdef0123456789'; // confirm rcVerifyPurchase 활성(모듈 const라 import 전 주입) — 실 네트워크는 fetch stub

(async () => {
  const { db } = await import('../db');
  const { users, walletLedger, attendancePasses, mails, statsDaily, purchaseEvent } = await import('../db/schema');
  const { eq, and, sql, inArray, like, isNull } = await import('drizzle-orm');
  const { PROJ_CODE } = await import('../lib/proj');
  const { ensureProj } = await import('../lib/wallet');
  const { grantPass, clawbackPass, dispatchDailyPassMails, passDailyKey, passMailKey, passMailPrefix } = await import('../lib/pass');
  const { PASS_DAILY_REWARD, PASS_RESET_HOUR_KST } = await import('../lib/econ');
  const { todayKstResetAdjusted, addDays } = await import('../lib/dates');
  const { signToken } = await import('../lib/auth');
  const { POST: webhookPOST } = await import('../app/api/purchase/webhook/revenuecat/route');
  const { POST: confirmPOST } = await import('../app/api/purchase/confirm/route');
  const { POST: claimMailPOST } = await import('../app/api/mail/claim/route');

  let fail = 0;
  const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
  const SEC = 'test-secret-abcdef0123456789';
  const TAG = `_pass_live_${Date.now()}`;

  await ensureProj();
  // 실 today(KST) 앵커 — 정오(UTC 03:00 = KST 12:00)로 리셋(00:00) 경계 회피 + mail expiresAt 미래 보장.
  const TODAY_KST = todayKstResetAdjusted(PASS_RESET_HOUR_KST, new Date());
  const dayStr = (k: number) => addDays(TODAY_KST, k);
  const at = (dateStr: string) => new Date(`${dateStr}T03:00:00Z`); // KST 12:00 정오
  const D0 = at(TODAY_KST);                     // 오늘 정오(구매 기본)
  const START0 = TODAY_KST;

  const makeUser = async (sub: string): Promise<{ id: string; token: string }> => {
    const [u] = await db.insert(users).values({ projCode: PROJ_CODE, provider: 'dev', providerId: `${TAG}_${sub}`, displayName: '_pass_test' }).returning({ id: users.id });
    return { id: u.id, token: signToken(`dev:${TAG}_${sub}`) };
  };
  const bal = async (uid: string) => { const r = await db.select({ d: walletLedger.delta }).from(walletLedger).where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.userId, uid))); return r.reduce((a, x) => a + x.d, 0); };
  const passRow = async (txn: string) => { const r = await db.select().from(attendancePasses).where(and(eq(attendancePasses.projCode, PROJ_CODE), eq(attendancePasses.storeTxnId, txn))).limit(1); return r[0]; };
  const mailRow = async (passId: string, dayIndex: number) => { const r = await db.select().from(mails).where(and(eq(mails.projCode, PROJ_CODE), eq(mails.idemKey, passMailKey(passId, dayIndex)))).limit(1); return r[0]; };
  const passMailCount = async (passId: string) => { const r = await db.select({ n: sql<number>`count(*)::int` }).from(mails).where(and(eq(mails.projCode, PROJ_CODE), like(mails.idemKey, passMailPrefix(passId) + '%'))); return r[0].n; };
  const webhook = (event: unknown, auth: string | null = SEC) => webhookPOST(new Request('http://x/api/purchase/webhook/revenuecat', { method: 'POST', headers: auth ? { authorization: auth, 'content-type': 'application/json' } : { 'content-type': 'application/json' }, body: JSON.stringify({ event }) }));
  const passEvent = (uid: string, txn: string, type: string, purchasedAt: Date, env = 'PRODUCTION') => ({ app_user_id: uid, transaction_id: txn, environment: env, type, product_id: 'diamond_pass', currency: 'KRW', price_in_purchased_currency: 9900, purchased_at_ms: purchasedAt.getTime() });
  const claimMail = (token: string, id: string) => claimMailPOST(new Request('http://x/api/mail/claim', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ id, kind: 'mail' }) }));
  // 그 유저의 미수령 system:pass 우편 전부 수령 → 지급 슬롯 수 반환
  const claimAllPassMails = async (token: string, uid: string): Promise<number> => {
    const rows = await db.select({ id: mails.id }).from(mails).where(and(eq(mails.projCode, PROJ_CODE), eq(mails.userId, uid), eq(mails.sender, 'system:pass'), isNull(mails.claimedAt), isNull(mails.recalledAt)));
    let n = 0;
    for (const r of rows) { const res = await (await claimMail(token, r.id)).json(); if (res.ok && res.applied) n++; }
    return n;
  };
  const realFetch = globalThis.fetch;
  const stubRc = (txn: string, productId: string) => { globalThis.fetch = (async () => new Response(JSON.stringify({ subscriber: { non_subscriptions: { [productId]: [{ store_transaction_id: txn, id: txn, is_sandbox: false }] } } }), { status: 200 })) as typeof fetch; };
  const restoreFetch = () => { globalThis.fetch = realFetch; };
  const TODAY_UTC = new Date().toISOString().slice(0, 10);
  const readStats = async () => { const r = await db.select({ cnt: statsDaily.purchaseCount, rev: statsDaily.revenueKrw, dia: statsDaily.diamondsPurchased, nu: statsDaily.newUsers }).from(statsDaily).where(and(eq(statsDaily.projCode, PROJ_CODE), eq(statsDaily.day, TODAY_UTC))); return r.length ? r[0] : { cnt: 0, rev: 0, dia: 0, nu: 0 }; };
  const statsSnap = await readStats();

  console.log('── A. 패스 grant(웹훅) → 행 생성 + day-0 우편 발송(B4, 즉시 원장 아님) ──');
  const uA = await makeUser('A');
  const rA = await (await webhook(passEvent(uA.id, `${TAG}_A1`, 'NON_RENEWING_PURCHASE', D0))).json();
  ok(rA.ok === true && rA.applied === true && rA.outcome === 'activated', `패스 구매 웹훅 → applied·activated (실측 ${rA.outcome})`);
  const rowA = await passRow(`${TAG}_A1`);
  ok(!!rowA && rowA.status === 'active', 'attendance_passes 행 생성(status=active)');
  ok(rowA.startDate === START0, `start = 리셋보정 구매일 ${START0} (실측 ${rowA?.startDate})`);
  ok(await bal(uA.id) === 0, `day-0 즉시 지급 아님 — 잔액 0(우편 미수령), 실측 ${await bal(uA.id)}`);
  const m0 = await mailRow(rowA.id, 0);
  ok(!!m0 && m0.sender === 'system:pass' && m0.attachType === 'diamonds' && m0.attachAmount === PASS_DAILY_REWARD, `day-0 우편 발송(idem pass_daily:<pass>:0·sender system:pass·💎100) — 실측 ${m0?.sender}·${m0?.attachAmount}`);

  console.log('── B. day-0 우편 수령 → +100 reason=pass_daily·ref=mail:<id> ──');
  const cB = await (await claimMail(uA.token, m0.id)).json();
  ok(cB.ok === true && cB.applied === true && await bal(uA.id) === 100, `우편 수령 → applied·+100 잔액 100 — 실측 ${await bal(uA.id)}`);
  const led0 = await db.select({ reason: walletLedger.reason, ref: walletLedger.ref }).from(walletLedger).where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.idempotencyKey, passDailyKey(uA.id, rowA.id, 0)))).limit(1);
  ok(led0.length === 1 && led0[0].reason === 'pass_daily' && led0[0].ref === `mail:${m0.id}`, `원장 키=pass_daily:<u>:<pass>:0·reason=pass_daily·ref=mail:<mailId> — 실측 reason ${led0[0]?.reason}·ref ${led0[0]?.ref}`);
  const cBb = await (await claimMail(uA.token, m0.id)).json();
  ok(cBb.ok === true && cBb.applied === false && await bal(uA.id) === 100, `재수령(연타/멀티기기 UI.4) → applied:false·잔액 불변 100(이중수령 0) — 실측 ${await bal(uA.id)}`);

  console.log('── C. confirm dedup(웹훅 선착 day-0 우편 → confirm 후착) — 이중 우편/이중 패스 0 ──');
  stubRc(`${TAG}_A1`, 'diamond_pass');
  const cC = await (await confirmPOST(new Request('http://x/api/purchase/confirm', { method: 'POST', headers: { authorization: `Bearer ${uA.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ storeTxnId: `${TAG}_A1`, productId: 'diamond_pass' }) }))).json();
  restoreFetch();
  ok(cC.ok === true && cC.applied === false && cC.outcome === 'dup', `confirm 후착 → dup(applied false) — 실측 ${cC.outcome}`);
  ok(await passMailCount(rowA.id) === 1, `  패스 우편 여전히 1통(day-0 이중발송 0) — 실측 ${await passMailCount(rowA.id)}`);
  const rowsA1 = await db.select({ id: attendancePasses.id }).from(attendancePasses).where(and(eq(attendancePasses.projCode, PROJ_CODE), eq(attendancePasses.storeTxnId, `${TAG}_A1`)));
  ok(rowsA1.length === 1, '  패스 행 1개(중복 생성 없음 — UNIQUE(proj,txn))');

  console.log('── D. 스케줄러 캐치업 멱등(미실행일 몰아 발송)·이중발송 0 ──');
  const uD = await makeUser('D');
  // 3일 전 구매(off=3): grant가 day-0 우편만 발송. 스케줄러가 오늘(off3) 처음 돌면 dayIndex 1,2,3 몰아 발송(day-0 dedup).
  const dTxn = `${TAG}_D1`;
  await webhook(passEvent(uD.id, dTxn, 'NON_RENEWING_PURCHASE', at(dayStr(-3))));
  const rowD = await passRow(dTxn);
  ok(await passMailCount(rowD.id) === 1, `구매 직후 우편 1통(day-0만) — 실측 ${await passMailCount(rowD.id)}`);
  await dispatchDailyPassMails(D0); // 오늘(off3) 스케줄러 실행
  ok(await passMailCount(rowD.id) === 4, `스케줄러 1회 → 캐치업 dayIndex 1·2·3 발송(총 4통, day-0 dedup) — 실측 ${await passMailCount(rowD.id)}`);
  await dispatchDailyPassMails(D0); // 같은 날 재실행(크론 중복)
  ok(await passMailCount(rowD.id) === 4, `  스케줄러 재실행(같은 날) → 0 신규(멱등, 이중발송 0) — 실측 ${await passMailCount(rowD.id)}`);
  const gotD = await claimAllPassMails(uD.token, uD.id);
  ok(gotD === 4 && await bal(uD.id) === 400, `우편 4통 모두 수령 → +400(4슬롯) 잔액 400 — 실측 슬롯 ${gotD}·잔액 ${await bal(uD.id)}`);

  console.log('── E. 활성 패스 없음 → 스케줄러 발송 없음 / 수령 없음 ──');
  const uE = await makeUser('E');
  await dispatchDailyPassMails(D0);
  const eMails = await db.select({ n: sql<number>`count(*)::int` }).from(mails).where(and(eq(mails.projCode, PROJ_CODE), eq(mails.userId, uE.id)));
  ok(eMails[0].n === 0, `패스 미보유 유저 → 우편 0통 — 실측 ${eMails[0].n}`);

  console.log('── F. B1 환불 선착(순서역전) → tombstone → 구매 후착 활성화 금지(우편·지급 0) ──');
  const uF = await makeUser('F');
  const rF_ref = await (await webhook(passEvent(uF.id, `${TAG}_F1`, 'CANCELLATION', D0))).json(); // 환불 먼저(행 없음)
  ok(rF_ref.ok === true, '환불 웹훅 선착(패스 행 없음) → ok');
  const rowF_tomb = await passRow(`${TAG}_F1`);
  ok(!!rowF_tomb && rowF_tomb.status === 'refunded', 'tombstone 선삽입(status=refunded)');
  const rF_grant = await (await webhook(passEvent(uF.id, `${TAG}_F1`, 'NON_RENEWING_PURCHASE', D0))).json(); // 구매 후착
  ok(rF_grant.ok === true && rF_grant.applied === false && rF_grant.outcome === 'tombstoned-skip', `구매 후착 → tombstoned-skip(활성화 금지) — 실측 ${rF_grant.outcome}`);
  ok(await passMailCount(rowF_tomb.id) === 0 && await bal(uF.id) === 0, '  day-0 우편·지급 0(유령 활성 0)');

  console.log('── G. B2 클로백 + 미수령 우편 recall(§4.3.2) ──');
  const uG = await makeUser('G');
  const gTxn = `${TAG}_G1`;
  await webhook(passEvent(uG.id, gTxn, 'NON_RENEWING_PURCHASE', at(dayStr(-3)))); // off3 구매(day-0 우편)
  const rowG = await passRow(gTxn);
  await dispatchDailyPassMails(D0); // dayIndex 1,2,3 우편 발송(총 4통)
  // day-0·day-1만 수령(2슬롯 +200), day-2·day-3은 미수령(2통)으로 남김
  const gMails = await db.select({ id: mails.id, k: mails.idemKey }).from(mails).where(and(eq(mails.projCode, PROJ_CODE), eq(mails.userId, uG.id), eq(mails.sender, 'system:pass'))).orderBy(mails.idemKey);
  await (await claimMail(uG.token, (await mailRow(rowG.id, 0)).id)).json();
  await (await claimMail(uG.token, (await mailRow(rowG.id, 1)).id)).json();
  ok(await bal(uG.id) === 200 && gMails.length === 4, `day-0·1 수령 +200·미수령 2통 잔존 — 잔액 ${await bal(uG.id)}·우편 ${gMails.length}통`);
  const rG_ref = await (await webhook(passEvent(uG.id, gTxn, 'REFUND', D0))).json();
  ok(rG_ref.ok === true && rG_ref.applied === true && rG_ref.clawback === 200 && await bal(uG.id) === 0, `환불 → 클로백 −Σ(200 수령분)·잔액 0(A 전액회수) — 실측 clawback ${rG_ref.clawback}·잔액 ${await bal(uG.id)}`);
  const recalled = await db.select({ n: sql<number>`count(*)::int` }).from(mails).where(and(eq(mails.projCode, PROJ_CODE), eq(mails.userId, uG.id), eq(mails.sender, 'system:pass'), sql`${mails.recalledAt} is not null`));
  ok(recalled[0].n === 2, `  미수령 2통 recall(recalled_at set — 환불 후 우편함 수령 봉인) — 실측 ${recalled[0].n}통`);
  // recall된 우편 수령 시도 → not-found(봉인 확인)
  const cGrecalled = await (await claimMail(uG.token, (await mailRow(rowG.id, 2)).id)).json();
  ok(cGrecalled.ok === false && cGrecalled.reason === 'not-found' && await bal(uG.id) === 0, `  recall 우편 수령 시도 → not-found·미지급(잔액 0 유지) — 실측 ${cGrecalled.reason}`);
  ok((await passRow(gTxn)).status === 'refunded', '  패스 종료(status=refunded)');
  const rG_ref2 = await (await webhook(passEvent(uG.id, gTxn, 'CANCELLATION', D0))).json();
  ok(rG_ref2.ok === true && await bal(uG.id) === 0, '  이중 환불 → 멱등(refund_pass 키 dedup·이중차감 0)');

  console.log('── G2. claim↔환불 동시 레이스 → Σ 정합(직렬화, 최종 0) ──');
  const uGr = await makeUser('Gr');
  const grTxn = `${TAG}_Gr1`;
  await webhook(passEvent(uGr.id, grTxn, 'NON_RENEWING_PURCHASE', at(dayStr(-2)))); // off2
  const rowGr = await passRow(grTxn);
  await dispatchDailyPassMails(D0); // day-0,1,2 우편(3통)
  const grDay0 = await mailRow(rowGr.id, 0);
  // 동시: 한 우편 수령 + 환불. user 행 FOR UPDATE 직렬화 → 순서 무관 최종 잔액 0(claim 이기면 Σ에 포함되어 회수, 환불 이기면 recall되어 claim not-found).
  const [claimRes] = await Promise.all([
    (await claimMail(uGr.token, grDay0.id)).json(),
    clawbackPass(uGr.id, grTxn, 'diamond_pass', D0),
  ]);
  ok(await bal(uGr.id) === 0, `claim↔환불 동시(Promise.all) → 최종 잔액 0(Σ 정합·직렬화) — 실측 ${await bal(uGr.id)}, claim=${claimRes.ok ? (claimRes.applied ? 'applied' : 'noop') : claimRes.reason}`);
  ok((await passRow(grTxn)).status === 'refunded', '  레이스 후 패스 refunded');

  console.log('── H. 월 1+1(팩) — 첫구매 2배·2번째 0·다음달 부활·환불 회수·월키 미복구 ──');
  process.env.PROMO_1P1_ENABLED = '1';
  const uH = await makeUser('H');
  const D_JUL = new Date('2026-07-10T05:00:00Z'), D_AUG = new Date('2026-08-10T05:00:00Z');
  const packEvent = (uid: string, txn: string, type: string, ts: Date) => ({ app_user_id: uid, transaction_id: txn, environment: 'PRODUCTION', type, product_id: 'dia_1000', currency: 'KRW', price_in_purchased_currency: 3300, purchased_at_ms: ts.getTime() });
  const h1 = await (await webhook(packEvent(uH.id, `${TAG}_H1`, 'NON_RENEWING_PURCHASE', D_JUL))).json();
  ok(h1.ok && await bal(uH.id) === 2000, `7월 첫 dia_1000 → base 1000 + 1+1 1000 = 2000 — 실측 ${await bal(uH.id)}`);
  const h2 = await (await webhook(packEvent(uH.id, `${TAG}_H2`, 'NON_RENEWING_PURCHASE', D_JUL))).json();
  ok(h2.ok && await bal(uH.id) === 3000, `7월 2번째(다른 txn) → base 1000만(보너스 dedup) = 3000 — 실측 ${await bal(uH.id)}`);
  const h3 = await (await webhook(packEvent(uH.id, `${TAG}_H3`, 'NON_RENEWING_PURCHASE', D_AUG))).json();
  ok(h3.ok && await bal(uH.id) === 5000, `8월 → 월키 부활 base 1000 + 보너스 1000 = 5000 — 실측 ${await bal(uH.id)}`);
  const h1ref = await (await webhook(packEvent(uH.id, `${TAG}_H1`, 'CANCELLATION', D_JUL))).json();
  ok(h1ref.ok && await bal(uH.id) === 3000, `_H1 환불 → base+보너스 −2000 = 3000 — 실측 ${await bal(uH.id)}`);
  const bonusRev = await db.select({ id: walletLedger.id }).from(walletLedger).where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.userId, uH.id), eq(walletLedger.idempotencyKey, `refund_bonus:${uH.id}:${TAG}_H1`))).limit(1);
  ok(bonusRev.length === 1, '  1+1 보너스 회수 원장(refund_bonus 키) 1건');
  const h4 = await (await webhook(packEvent(uH.id, `${TAG}_H4`, 'NON_RENEWING_PURCHASE', D_JUL))).json();
  ok(h4.ok && await bal(uH.id) === 4000, `환불 후 7월 재구매 → base 1000만(월키 미복구·보너스 0) = 4000 — 실측 ${await bal(uH.id)}(파밍 차단)`);
  process.env.PROMO_1P1_ENABLED = '';
  const uHoff = await makeUser('Hoff');
  const hoff = await (await webhook(packEvent(uHoff.id, `${TAG}_HOFF1`, 'NON_RENEWING_PURCHASE', D_JUL))).json();
  ok(hoff.ok && await bal(uHoff.id) === 1000, `[A/B] 프로모 off → 첫 구매도 base 1000만(보너스 0) — 실측 ${await bal(uHoff.id)}`);
  process.env.PROMO_1P1_ENABLED = '1';

  console.log('── I. diamond_pass는 1+1 비대상(구조적) ──');
  const uI = await makeUser('I');
  await webhook(passEvent(uI.id, `${TAG}_I1`, 'NON_RENEWING_PURCHASE', D0));
  const iBonus = await db.select({ id: walletLedger.id }).from(walletLedger).where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.userId, uI.id), eq(walletLedger.reason, 'iap_bonus_1p1')));
  ok(iBonus.length === 0 && await bal(uI.id) === 0, `패스 구매 → iap_bonus_1p1 0건·즉시지급 0(day-0 우편만) — 실측 보너스 ${iBonus.length}·잔액 ${await bal(uI.id)}`);
  process.env.PROMO_1P1_ENABLED = '';

  console.log('── J. Q1 중첩 큐잉(깊이 1) + 활성화=스케줄러 day-0 우편 ──');
  const uJ = await makeUser('J');
  await webhook(passEvent(uJ.id, `${TAG}_J1`, 'NON_RENEWING_PURCHASE', D0)); // 활성
  const rowJ1 = await passRow(`${TAG}_J1`);
  const rJ2 = await grantPass(uJ.id, `${TAG}_J2`, D0, 'diamond_pass', false); // 중첩 → 큐
  ok(rJ2.ok && rJ2.outcome === 'queued', `2번째 구매(활성 중) → queued(예약) — 실측 ${rJ2.ok ? rJ2.outcome : rJ2.reason}`);
  const rowJ2 = await passRow(`${TAG}_J2`);
  ok(rowJ2.status === 'queued' && rowJ2.queuedAfter === rowJ1.id, '  예약 행 status=queued·queued_after=활성 passId(체인 앵커)');
  ok(await passMailCount(rowJ2.id) === 0, '  예약은 day-0 우편 미발송(활성화 때 발송)');
  const rJ3 = await grantPass(uJ.id, `${TAG}_J3`, D0, 'diamond_pass', false); // 3번째 → 큐 상한 초과
  ok(rJ3.ok && rJ3.outcome === 'queued-overflow', `3번째 구매 → queued-overflow(깊이 상한 1) — 실측 ${rJ3.ok ? rJ3.outcome : rJ3.reason}`);
  // 활성화 — J1 만료 후(J2 프로비저널 start = J1.end+1). 스케줄러를 그날에 실행 → J2 활성화 + day-0 우편.
  const activateNow = at(addDays(rowJ1.endDate, 1));
  await dispatchDailyPassMails(activateNow);
  const rowJ2after = await passRow(`${TAG}_J2`);
  ok(rowJ2after.status === 'active', `J1 만료 후 스케줄러 → J2 큐 활성화(status=active) — 실측 ${rowJ2after.status}`);
  ok(await passMailCount(rowJ2.id) >= 1, `  J2 활성화 시 day-0 우편 발송(우편 ${await passMailCount(rowJ2.id)}통)`);

  console.log('── K. R2 패스 구매 매출·건수 편입(payer 누락 방지) ──');
  const statsNow = await readStats();
  ok(statsNow.cnt >= statsSnap.cnt + 1, `패스/팩 구매가 purchaseCount에 편입(스냅 ${statsSnap.cnt} → 현재 ${statsNow.cnt}) — R2 payer 누락 방지`);
  ok(statsNow.rev >= statsSnap.rev + 9900, `패스 실매출 KRW 적재(₩9,900 이상 증가 — 스냅 ${statsSnap.rev} → ${statsNow.rev})`);

  // ── 정리 ──
  const testUserIds = (await db.select({ id: users.id }).from(users).where(and(eq(users.projCode, PROJ_CODE), sql`${users.providerId} like ${TAG + '%'}`))).map((r) => r.id);
  if (testUserIds.length) {
    await db.delete(walletLedger).where(and(eq(walletLedger.projCode, PROJ_CODE), inArray(walletLedger.userId, testUserIds)));
    await db.delete(mails).where(and(eq(mails.projCode, PROJ_CODE), inArray(mails.userId, testUserIds)));
    await db.delete(attendancePasses).where(and(eq(attendancePasses.projCode, PROJ_CODE), inArray(attendancePasses.userId, testUserIds)));
  }
  await db.delete(purchaseEvent).where(and(eq(purchaseEvent.projCode, PROJ_CODE), sql`${purchaseEvent.storeTxnId} like ${TAG + '%'}`));
  await db.update(statsDaily).set({ purchaseCount: statsSnap.cnt, revenueKrw: statsSnap.rev, diamondsPurchased: statsSnap.dia, newUsers: statsSnap.nu }).where(and(eq(statsDaily.projCode, PROJ_CODE), eq(statsDaily.day, TODAY_UTC)));
  if (testUserIds.length) await db.delete(users).where(inArray(users.id, testUserIds));
  restoreFetch();
  delete process.env.PROMO_1P1_ENABLED;
  console.log('  ✓ 정리 완료(테스트 유저·우편·패스·원장·감사행 삭제 + stats_daily 원복)');

  console.log(fail === 0 ? '\n✅ _dv_pass_live 통과 — day-0 우편(B4)·우편수령 pass_daily·스케줄러 캐치업 멱등·이중발송0·환불 recall+클로백Σ·B1 tombstone·레이스Σ·1+1(2배/부활/회수/미복구)·큐잉활성화·R2 전부' : `\n❌ ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
