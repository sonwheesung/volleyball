// 우편함 라이브 검증 가드 (MAILBOX_SYSTEM §12 _dv_mail_live) — 실 HTTP 라우트 + dev DB.
// 발송(idem dedup)·목록 필터 3종·수령(+amount)·이중수령 0·만료 거부·회수 후 미수령·패스 첨부(원자·store_txn_id UNIQUE·큐 만석 롤백→해소 후 성공)·
// 브로드캐스트 lazy 멱등·음수 잔액 수령·admin fail-closed·관측행·모두받기 부분실패 집계 + A/B(멱등키·rejectOnQueueFull).
// Usage: cd server && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx tsx tools/_dv_mail_live.ts
import './_env';
process.env.ADMIN_TOKEN = 'test-admin-token-abcdef0123456789'; // ≥16자(fail-closed 통과) — import 전 주입

(async () => {
  const { db } = await import('../db');
  const { users, walletLedger, attendancePasses, mails, mailBroadcasts, mailBroadcastReceipts, purchaseEvent } = await import('../db/schema');
  const { eq, and, sql, inArray, isNull } = await import('drizzle-orm');
  const { PROJ_CODE } = await import('../lib/proj');
  const { ensureProj, getWallet } = await import('../lib/wallet');
  const { signToken } = await import('../lib/auth');
  const { grantPassTx, PASS_QUEUE_FULL, grantPass, clawbackPass, dispatchDailyPassMails, passDailyKey, passMailKey } = await import('../lib/pass');
  const { mailLedgerKey, mailBroadcastKey } = await import('../lib/mail');
  const { GET: listGET } = await import('../app/api/mail/route');
  const { POST: claimPOST } = await import('../app/api/mail/claim/route');
  const { POST: readPOST } = await import('../app/api/mail/read/route');
  const { POST: adminPOST, GET: adminGET, DELETE: adminDELETE } = await import('../app/api/admin/mail/route');

  let fail = 0;
  const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
  const ADMIN = 'test-admin-token-abcdef0123456789';
  const TAG = `_mail_live_${Date.now()}`;
  const testStart = new Date();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  await ensureProj();
  let seq = 0;
  const idem = () => `${TAG}_idem_${seq++}`;
  const makeUser = async (sub: string): Promise<{ id: string; token: string }> => {
    const [u] = await db.insert(users).values({ projCode: PROJ_CODE, provider: 'dev', providerId: `${TAG}_${sub}`, displayName: '_mail_test' }).returning({ id: users.id });
    return { id: u.id, token: signToken(`dev:${TAG}_${sub}`) };
  };
  const bal = async (uid: string) => { const r = await db.select({ d: walletLedger.delta }).from(walletLedger).where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.userId, uid))); return r.reduce((a, x) => a + x.d, 0); };

  // ── HTTP 헬퍼 ──
  const adminSend = (body: unknown, auth = ADMIN) => adminPOST(new Request('http://x/api/admin/mail', { method: 'POST', headers: auth ? { authorization: `Bearer ${auth}`, 'content-type': 'application/json' } : { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  const adminRecall = (id: string) => adminDELETE(new Request(`http://x/api/admin/mail?id=${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${ADMIN}` } }));
  const claim = (token: string, id: string, kind: 'mail' | 'bc' = 'mail') => claimPOST(new Request('http://x/api/mail/claim', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ id, kind }) }));
  const list = (token: string, status: string) => listGET(new Request(`http://x/api/mail?status=${status}`, { headers: { authorization: `Bearer ${token}` } }));
  const read = (token: string) => readPOST(new Request('http://x/api/mail/read', { method: 'POST', headers: { authorization: `Bearer ${token}` } }));
  const sendDia = async (userId: string, amount: number, extra: Record<string, unknown> = {}) => (await adminSend({ userId, title: '보상', body: '운영 보상입니다', attachType: 'diamonds', attachAmount: amount, idemKey: idem(), ...extra })).json();
  const sendPass = async (userId: string) => (await adminSend({ userId, title: '패스', body: '출석 패스', attachType: 'pass', idemKey: idem() })).json();

  console.log('── A. 발송 + idem_key 더블클릭 dedup(R1) ──');
  const uA = await makeUser('A');
  const key = idem();
  const s1 = await (await adminSend({ userId: uA.id, title: 'T', body: 'B', attachType: 'diamonds', attachAmount: 500, idemKey: key })).json();
  const s2 = await (await adminSend({ userId: uA.id, title: 'T', body: 'B', attachType: 'diamonds', attachAmount: 500, idemKey: key })).json();
  ok(s1.ok === true && s1.deduped === false && !!s1.mailId, `발송 → ok·mailId (실측 deduped ${s1.deduped})`);
  ok(s2.ok === true && s2.deduped === true && s2.mailId === s1.mailId, `같은 idemKey 재발송 → deduped·동일 mailId(이중발송 봉인) — 실측 deduped ${s2.deduped}`);
  const mailCntA = await db.select({ n: sql<number>`count(*)::int` }).from(mails).where(and(eq(mails.projCode, PROJ_CODE), eq(mails.userId, uA.id)));
  ok(mailCntA[0].n === 1, `  mails 행 1개(UNIQUE(proj,idem_key) 하드가드) — 실측 ${mailCntA[0].n}`);
  const hist = await (await adminGET(new Request(`http://x/api/admin/mail?userId=${uA.id}`, { headers: { authorization: `Bearer ${ADMIN}` } }))).json();
  ok(hist.ok === true && Array.isArray(hist.mails) && hist.mails.length === 1, `발송 이력(admin GET) → 1건 — 실측 ${hist.mails?.length}`);

  console.log('── B. 수령(+amount·balance) + 이중수령 0(applied:false) ──');
  const c1 = await (await claim(uA.token, s1.mailId)).json();
  ok(c1.ok === true && c1.applied === true && await bal(uA.id) === 500, `수령 → applied·+500 잔액 500 — 실측 ${await bal(uA.id)}`);
  const ledA = await db.select({ id: walletLedger.id, ref: walletLedger.ref, reason: walletLedger.reason }).from(walletLedger).where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.idempotencyKey, mailLedgerKey(s1.mailId)))).limit(1);
  ok(ledA.length === 1 && ledA[0].reason === 'mail' && ledA[0].ref === mailLedgerKey(s1.mailId), `원장 reason='mail'·ref=mail:<id> 1건(S2) — 실측 reason ${ledA[0]?.reason}`);
  const c1b = await (await claim(uA.token, s1.mailId)).json();
  ok(c1b.ok === true && c1b.applied === false && await bal(uA.id) === 500, `재수령(연타) → applied:false·잔액 불변 500(이중수령 0) — 실측 ${await bal(uA.id)}`);

  console.log('── C. 목록 필터 3종(all/claimed/unclaimed 서버 재조회) ──');
  const uC = await makeUser('C');
  const cm1 = await sendDia(uC.id, 100); // 미수령
  const cm2 = await sendDia(uC.id, 200); // 수령할 것
  await (await claim(uC.token, cm2.mailId)).json();
  const lAll = (await (await list(uC.token, 'all')).json()).items;
  const lClaimed = (await (await list(uC.token, 'claimed')).json()).items;
  const lUnclaimed = (await (await list(uC.token, 'unclaimed')).json()).items;
  ok(lAll.length === 2, `all → 2건(수령+미수령) — 실측 ${lAll.length}`);
  ok(lClaimed.length === 1 && lClaimed[0].id === cm2.mailId, `claimed → 1건(cm2) — 실측 ${lClaimed.length}`);
  ok(lUnclaimed.length === 1 && lUnclaimed[0].id === cm1.mailId, `unclaimed → 1건(cm1) — 실측 ${lUnclaimed.length}`);

  console.log('── D. getWallet unread/unclaimed 편입(§5.2 R4) + read 소등 ──');
  const uD = await makeUser('D');
  await sendDia(uD.id, 100); await sendDia(uD.id, 100);
  const w0 = await getWallet(uD.id);
  ok(w0!.unreadMailCount === 2 && w0!.unclaimedMailCount === 2, `발송 후 unread 2·unclaimed 2 — 실측 unread ${w0!.unreadMailCount}·unclaimed ${w0!.unclaimedMailCount}`);
  const rd = await (await read(uD.token)).json();
  ok(rd.ok === true && rd.unreadMailCount === 0, `read 진입 → unread 0(배지 소등) — 실측 ${rd.unreadMailCount}`);
  const w1 = await getWallet(uD.id);
  ok(w1!.unreadMailCount === 0 && w1!.unclaimedMailCount === 2, `read 후 unread 0·unclaimed 2 유지(미수령 잔존, 신호 분리 §6.3) — 실측 unclaimed ${w1!.unclaimedMailCount}`);

  console.log('── E. 만료 미수령 거부(E1, DB now) ──');
  const uE = await makeUser('E');
  const em = await sendDia(uE.id, 300);
  await db.update(mails).set({ expiresAt: sql`now() - make_interval(days => 1)` }).where(eq(mails.id, em.mailId)); // 만료 시뮬(테스트측 노후화 — 프로덕션 시임 아님)
  const ce = await (await claim(uE.token, em.mailId)).json();
  ok(ce.ok === false && ce.reason === 'expired' && await bal(uE.id) === 0, `만료 우편 수령 → expired·미지급 — 실측 reason ${ce.reason}·잔액 ${await bal(uE.id)}`);
  const uAll = (await (await list(uE.token, 'unclaimed')).json()).items;
  const aAll = (await (await list(uE.token, 'all')).json()).items;
  ok(uAll.length === 0 && aAll.length === 1, `만료분: unclaimed 탭 제외(0)·all 탭 잔존(1, Q2 투명성) — 실측 unclaimed ${uAll.length}·all ${aAll.length}`);

  console.log('── F. 회수(recalled_at 소프트) 후 미수령 + 수령분 회수 거부(R2) ──');
  const uF = await makeUser('F');
  const fm = await sendDia(uF.id, 400);
  const rec = await (await adminRecall(fm.mailId)).json();
  ok(rec.ok === true, '미수령 우편 회수 → ok(recalled_at 소프트마킹)');
  const cf = await (await claim(uF.token, fm.mailId)).json();
  ok(cf.ok === false && cf.reason === 'not-found', `회수 후 수령 시도 → not-found(목록·수령 제외) — 실측 ${cf.reason}`);
  const fRow = await db.select({ r: mails.recalledAt }).from(mails).where(eq(mails.id, fm.mailId)).limit(1);
  ok(!!fRow[0].r, '  recalled_at set(물리삭제 아님·감사 보존)');
  const fm2 = await sendDia(uF.id, 100); await (await claim(uF.token, fm2.mailId)).json();
  const rec2 = await (await adminRecall(fm2.mailId)).json();
  ok(rec2.ok === false && rec2.reason === 'already-claimed', `수령분 회수 → already-claimed 거부(재화 이동 완료) — 실측 ${rec2.reason}`);

  console.log('── G. 음수 잔액 수령 가능(E10 — 적립 부채 상쇄) ──');
  const uG = await makeUser('G');
  await db.insert(walletLedger).values({ projCode: PROJ_CODE, userId: uG.id, delta: -300, reason: 'refund', ref: 'test', idempotencyKey: `${TAG}_neg_${uG.id}`, balanceAfter: -300 });
  await db.update(users).set({ balance: -300 }).where(eq(users.id, uG.id));
  const gm = await sendDia(uG.id, 200);
  const cg = await (await claim(uG.token, gm.mailId)).json();
  ok(cg.ok === true && cg.applied === true && cg.balance === -100, `음수(-300) 유저 우편 +200 수령 → applied·잔액 -100(부채 상쇄, 게이트 우회) — 실측 ${cg.balance}`);

  console.log('── H. 패스 첨부(attachType=pass) 수령(원자·store_txn_id UNIQUE·day-0 우편) ──');
  // 재개정(2026-07-23): 패스 첨부 우편 수령 → grantPassTx가 패스 생성 + day-0 **슬롯 우편 발송**(즉시 원장 아님). 유저는 그 슬롯 우편을 또 받아야 +100.
  const uH = await makeUser('H');
  const hm = await sendPass(uH.id);
  const ch = await (await claim(uH.token, hm.mailId)).json();
  ok(ch.ok === true && ch.applied === true && ch.pass === 'activated', `패스 우편 수령 → applied·pass activated — 실측 ${ch.pass}`);
  const hPass = await db.select().from(attendancePasses).where(and(eq(attendancePasses.projCode, PROJ_CODE), eq(attendancePasses.storeTxnId, mailLedgerKey(hm.mailId))));
  ok(hPass.length === 1 && hPass[0].status === 'active' && hPass[0].source === 'admin', `attendance_passes 1행·store_txn_id='mail:<id>'·source=admin — 실측 ${hPass.length}행`);
  ok(await bal(uH.id) === 0, `  패스 수령 즉시 지급 0(day-0는 슬롯 우편으로, B4 재개정) — 실측 ${await bal(uH.id)}`);
  const hDay0 = (await db.select().from(mails).where(and(eq(mails.projCode, PROJ_CODE), eq(mails.idemKey, passMailKey(hPass[0].id, 0)))).limit(1))[0];
  ok(!!hDay0 && hDay0.sender === 'system:pass', `  day-0 슬롯 우편(system:pass) 발송됨(idem pass_daily:<pass>:0) — 실측 ${hDay0?.sender}`);
  const chDay0 = await (await claim(uH.token, hDay0.id)).json();
  ok(chDay0.ok === true && chDay0.applied === true && await bal(uH.id) === 100, `  day-0 슬롯 우편 수령 → +100 잔액 100 — 실측 ${await bal(uH.id)}`);
  const chb = await (await claim(uH.token, hm.mailId)).json();
  const hPass2 = await db.select({ n: sql<number>`count(*)::int` }).from(attendancePasses).where(and(eq(attendancePasses.projCode, PROJ_CODE), eq(attendancePasses.storeTxnId, mailLedgerKey(hm.mailId))));
  const hDay0Cnt = await db.select({ n: sql<number>`count(*)::int` }).from(mails).where(and(eq(mails.projCode, PROJ_CODE), eq(mails.idemKey, passMailKey(hPass[0].id, 0))));
  ok(chb.applied === false && hPass2[0].n === 1 && hDay0Cnt[0].n === 1 && await bal(uH.id) === 100, `패스 우편 재수령 → applied:false·패스 행 1(UNIQUE)·day-0 우편 1통(이중발송 0)·잔액 100 — 실측 패스 ${hPass2[0].n}행·우편 ${hDay0Cnt[0].n}통`);

  console.log('── I. 패스 큐 만석 → rejectOnQueueFull 롤백(claimed_at NULL 재수령) → 해소 후 성공(B2·E2b) ──');
  const uI = await makeUser('I');
  const im1 = await sendPass(uI.id); await (await claim(uI.token, im1.mailId)).json(); // 활성
  const im2 = await sendPass(uI.id); const ci2 = await (await claim(uI.token, im2.mailId)).json(); // 예약(depth1, 허용)
  ok(ci2.ok === true && ci2.applied === true && ci2.pass === 'queued', `2번째 패스 우편 → queued(예약, 허용) — 실측 ${ci2.pass}`);
  const im3 = await sendPass(uI.id); const ci3 = await (await claim(uI.token, im3.mailId)).json(); // 만석 → 거부
  ok(ci3.ok === false && ci3.reason === 'pass-queue-full', `3번째(만석) → pass-queue-full 거부 — 실측 ${ci3.reason}`);
  const im3Row = await db.select({ c: mails.claimedAt }).from(mails).where(eq(mails.id, im3.mailId)).limit(1);
  const im3Pass = await db.select({ n: sql<number>`count(*)::int` }).from(attendancePasses).where(and(eq(attendancePasses.projCode, PROJ_CODE), eq(attendancePasses.storeTxnId, mailLedgerKey(im3.mailId))));
  ok(im3Row[0].c === null && im3Pass[0].n === 0, `  롤백 원자성: im3 claimed_at NULL·패스 행 0(B1 — 패스만 잔존 불가) — 실측 claimed ${im3Row[0].c}·패스 ${im3Pass[0].n}`);
  // 만석 해소 — 예약 패스(im2)를 refunded로 표시(큐 1칸 비움) 후 im3 재수령 → 성공(재수령 가능 = claimed_at 미설정 덕)
  await db.update(attendancePasses).set({ status: 'refunded' }).where(and(eq(attendancePasses.projCode, PROJ_CODE), eq(attendancePasses.storeTxnId, mailLedgerKey(im2.mailId))));
  const ci3b = await (await claim(uI.token, im3.mailId)).json();
  ok(ci3b.ok === true && ci3b.applied === true && ci3b.pass === 'queued', `  만석 해소 후 im3 재수령 → 성공(queued) — 실측 ${ci3b.ok ? ci3b.pass : ci3b.reason}`);

  console.log('── I-AB. [A/B] rejectOnQueueFull false(구매 동작) → 만석서 throw 대신 queued-overflow 삽입 ──');
  const uIab = await makeUser('Iab');
  // 활성 + 예약 채우기(직접 grantPassTx, 만석 상태 구성)
  await db.transaction((tx) => grantPassTx(tx, uIab.id, `${TAG}_iab_active`, new Date(), 'admin', { rejectOnQueueFull: false }));
  await db.transaction((tx) => grantPassTx(tx, uIab.id, `${TAG}_iab_q1`, new Date(), 'admin', { rejectOnQueueFull: false }));
  // 만석 상태 — rejectOnQueueFull:true면 throw, false면 queued-overflow
  let threw = false;
  try { await db.transaction((tx) => grantPassTx(tx, uIab.id, `${TAG}_iab_reject`, new Date(), 'admin', { rejectOnQueueFull: true })); } catch (e) { threw = (e as Error).message === PASS_QUEUE_FULL; }
  ok(threw === true, '  [A/B] 우편(rejectOnQueueFull:true) → 만석서 PASS_QUEUE_FULL throw(롤백)');
  const gOv = await db.transaction((tx) => grantPassTx(tx, uIab.id, `${TAG}_iab_ovf`, new Date(), 'admin', { rejectOnQueueFull: false }));
  ok(gOv.ok === true && gOv.outcome === 'queued-overflow', `  [A/B] 구매(rejectOnQueueFull:false) → 만석서 queued-overflow 삽입(throw 안 함·돈 이미 받음) — 실측 ${gOv.ok ? gOv.outcome : gOv.reason}`);

  console.log('── J. 브로드캐스트 lazy 멱등 + cutoff(신규 가입 미대상) ──');
  const uJ = await makeUser('J'); // 브로드캐스트 이전 가입
  const bc = await (await adminSend({ target: 'broadcast', title: '전체', body: '전체 보상', attachType: 'diamonds', attachAmount: 300, idemKey: `${TAG}_bc1` })).json();
  ok(bc.ok === true && !!bc.broadcastId, `브로드캐스트 발송 → ok·broadcastId (실측 ${bc.ok})`);
  const cj = await (await claim(uJ.token, bc.broadcastId, 'bc')).json();
  ok(cj.ok === true && cj.applied === true && await bal(uJ.id) === 300, `대상 유저 수령 → +300 — 실측 ${await bal(uJ.id)}`);
  const cjb = await (await claim(uJ.token, bc.broadcastId, 'bc')).json();
  ok(cjb.applied === false && await bal(uJ.id) === 300, `재수령 → applied:false(receipt lazy·UNIQUE dedup·이중수령 0) — 실측 ${await bal(uJ.id)}`);
  const bcLedger = await db.select({ n: sql<number>`count(*)::int` }).from(walletLedger).where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.idempotencyKey, mailBroadcastKey(bc.broadcastId, uJ.id))));
  ok(bcLedger[0].n === 1, `  원장 멱등키 mail_bc:<bc>:<user> 1건 — 실측 ${bcLedger[0].n}`);
  const uLate = await makeUser('Late'); // 브로드캐스트 이후 가입(cutoff 밖)
  const cLate = await (await claim(uLate.token, bc.broadcastId, 'bc')).json();
  ok(cLate.ok === false && cLate.reason === 'not-found', `신규 가입자(cutoff 밖) 수령 → not-found(소급 차단 §9) — 실측 ${cLate.reason}`);
  const jList = (await (await list(uJ.token, 'all')).json()).items;
  ok(jList.some((x: any) => x.kind === 'bc' && x.id === bc.broadcastId), '  목록 합성: 브로드캐스트 항목(kind=bc) 노출');

  console.log('── K. admin fail-closed(토큰 없이 401) ──');
  const noAuth = await adminSend({ userId: uA.id, title: 'x', body: 'y', attachType: 'diamonds', attachAmount: 100, idemKey: idem() }, '');
  ok(noAuth.status === 401, `발송 토큰 없음 → 401(fail-closed §13.15) — 실측 status ${noAuth.status}`);
  const noAuthClaim = await claimPOST(new Request('http://x/api/mail/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: s1.mailId, kind: 'mail' }) }));
  ok(noAuthClaim.status === 401, `수령 Bearer 없음 → 401(익명 폴백 금지) — 실측 status ${noAuthClaim.status}`);
  // over-cap 발송 거부(서버 캡)
  const overCap = await adminSend({ userId: uA.id, title: 'x', body: 'y', attachType: 'diamonds', attachAmount: 99999, idemKey: idem() });
  ok(overCap.status === 400, `MAIL_MAX_GRANT 초과 발송 → 400 거부 — 실측 status ${overCap.status}`);

  console.log('── L. 모두받기 부분실패 집계(S7 — 다이아 성공·패스 만석 보류) ──');
  const uL2 = await makeUser('L2');
  // 활성+예약으로 패스 큐 만석 만든 뒤: 다이아 우편 3 + 패스 우편 1(만석 보류) 을 "모두 받기" 순회
  await db.transaction((tx) => grantPassTx(tx, uL2.id, `${TAG}_l2_active`, new Date(), 'admin', { rejectOnQueueFull: false }));
  await db.transaction((tx) => grantPassTx(tx, uL2.id, `${TAG}_l2_q1`, new Date(), 'admin', { rejectOnQueueFull: false }));
  const lm1 = await sendDia(uL2.id, 100); const lm2 = await sendDia(uL2.id, 100); const lm3 = await sendDia(uL2.id, 100); const lp = await sendPass(uL2.id);
  const batch = [{ id: lm1.mailId, k: 'mail' }, { id: lm2.mailId, k: 'mail' }, { id: lm3.mailId, k: 'mail' }, { id: lp.mailId, k: 'mail' }];
  let claimed = 0; const holds: Record<string, number> = {};
  for (const b of batch) {
    const r = await (await claim(uL2.token, b.id, b.k as 'mail')).json();
    if (r.ok && r.applied) claimed++;
    else if (!r.ok) holds[r.reason] = (holds[r.reason] ?? 0) + 1;
  }
  ok(claimed === 3 && holds['pass-queue-full'] === 1, `모두받기 순회 → 3건 성공·1건 pass-queue-full 보류(집계 = "3건 수령·1건 보류") — 실측 성공 ${claimed}·보류 ${JSON.stringify(holds)}`);

  console.log('── M. 관측행(R2 — admin.mail.sent·mail.claim.applied·admin.mail.recalled) ──');
  await sleep(400); // logPaymentEventAfter fire-and-forget insert 완료 대기
  const evStages = (await db.select({ s: purchaseEvent.stage }).from(purchaseEvent).where(and(eq(purchaseEvent.projCode, PROJ_CODE), sql`${purchaseEvent.createdAt} >= ${testStart.toISOString()}`, sql`${purchaseEvent.stage} like '%mail%'`))).map((x) => x.s);
  ok(evStages.includes('admin.mail.sent'), `관측행 admin.mail.sent 존재 — 실측 ${evStages.filter((s) => s === 'admin.mail.sent').length}건`);
  ok(evStages.includes('mail.claim.applied'), `관측행 mail.claim.applied 존재 — 실측 ${evStages.filter((s) => s === 'mail.claim.applied').length}건`);
  ok(evStages.includes('admin.mail.recalled'), `관측행 admin.mail.recalled 존재 — 실측 ${evStages.filter((s) => s === 'admin.mail.recalled').length}건`);

  console.log('── N. [A/B] 멱등키(mail:<id>) 고정이 이중수령 봉인 — nonce 뮤턴트면 이중지급 ──');
  const { applyWallet } = await import('../lib/wallet');
  const uN = await makeUser('N');
  const k1 = `${TAG}_nonce_fixed`;
  const n1 = await applyWallet(uN.id, 50, 'mail', k1, k1);
  const n2 = await applyWallet(uN.id, 50, 'mail', k1, k1); // 같은 키 재시도
  ok(n1.ok && n1.applied === true && n2.ok && n2.applied === false, '  [A/B] 고정 키(mail:<id>) 재시도 → 2번째 applied:false(멱등 dedup·이중지급 0)');
  const balN1 = await bal(uN.id);
  const m1 = await applyWallet(uN.id, 50, 'mail', `${TAG}_nonce_a`, 'x');
  const m2 = await applyWallet(uN.id, 50, 'mail', `${TAG}_nonce_b`, 'x'); // nonce 뮤턴트(키가 매번 다름)
  ok(m1.ok && m1.applied && m2.ok && m2.applied && await bal(uN.id) === balN1 + 100, '  [A/B] nonce 뮤턴트 키(매번 다름) → 둘 다 지급(이중지급 재현 = 멱등키 load-bearing 증명)');

  console.log('── O. 다이아 패스 일일 우편(sender system:pass) — 수령 reason=pass_daily·admin 이력 제외·환불 recall ──');
  const uO = await makeUser('O');
  const oTxn = `${TAG}_o_txn`;
  // 어제 구매 → grantPass가 day-0 우편(system:pass) 발송. 스케줄러가 오늘 dayIndex 1 추가.
  await grantPass(uO.id, oTxn, new Date(Date.now() - 86_400_000), 'diamond_pass', false);
  const oPass = (await db.select().from(attendancePasses).where(and(eq(attendancePasses.projCode, PROJ_CODE), eq(attendancePasses.storeTxnId, oTxn))).limit(1))[0];
  const oDay0 = (await db.select().from(mails).where(and(eq(mails.projCode, PROJ_CODE), eq(mails.userId, uO.id), eq(mails.sender, 'system:pass'))).limit(1))[0];
  ok(!!oDay0 && oDay0.attachType === 'diamonds' && oDay0.attachAmount === 100, `day-0 우편(system:pass·💎100) 발송 — 실측 ${oDay0?.attachType}·${oDay0?.attachAmount}`);
  const co = await (await claim(uO.token, oDay0.id)).json();
  ok(co.ok === true && co.applied === true && await bal(uO.id) === 100, `system:pass 우편 수령 → +100 — 실측 ${await bal(uO.id)}`);
  const oLed = await db.select({ reason: walletLedger.reason, ref: walletLedger.ref }).from(walletLedger).where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.idempotencyKey, passDailyKey(uO.id, oPass.id, 0)))).limit(1);
  ok(oLed.length === 1 && oLed[0].reason === 'pass_daily' && oLed[0].ref === `mail:${oDay0.id}`, `원장 reason='pass_daily'·키=pass_daily:<u>:<p>:0·ref=mail:<id>(일반 우편 reason='mail'과 구분) — 실측 reason ${oLed[0]?.reason}`);
  // admin 발송 이력 GET → system:pass 우편 제외(관리자 발송분 아님, MAILBOX §7)
  const oHist = await (await adminGET(new Request(`http://x/api/admin/mail?userId=${uO.id}`, { headers: { authorization: `Bearer ${ADMIN}` } }))).json();
  ok(oHist.ok === true && (oHist.mails as any[]).every((m) => m.sender !== 'system:pass'), `admin 이력에서 system:pass 우편 제외 — 실측 ${(oHist.mails as any[]).length}건(모두 비 system:pass)`);
  // 스케줄러로 dayIndex 1 우편 추가(미수령) → 환불 clawback이 recall
  await dispatchDailyPassMails(new Date());
  const oUnclaimedBefore = await db.select({ n: sql<number>`count(*)::int` }).from(mails).where(and(eq(mails.projCode, PROJ_CODE), eq(mails.userId, uO.id), eq(mails.sender, 'system:pass'), isNull(mails.claimedAt), isNull(mails.recalledAt)));
  ok(oUnclaimedBefore[0].n >= 1, `  스케줄러 → 미수령 일일 우편 ≥1통 — 실측 ${oUnclaimedBefore[0].n}통`);
  const cbO = await clawbackPass(uO.id, oTxn, 'diamond_pass', new Date());
  ok(cbO.ok === true && cbO.clawback === 100 && cbO.recalled >= 1 && await bal(uO.id) === 0, `환불 → 수령분 −100 클로백·미수령 ${cbO.ok ? cbO.recalled : 0}통 recall·잔액 0 — 실측 clawback ${cbO.ok ? cbO.clawback : 0}`);
  const oRecalled = await db.select({ n: sql<number>`count(*)::int` }).from(mails).where(and(eq(mails.projCode, PROJ_CODE), eq(mails.userId, uO.id), eq(mails.sender, 'system:pass'), sql`${mails.recalledAt} is not null`));
  ok(oRecalled[0].n >= 1, `  미수령 우편 recalled_at set(환불 후 수령 봉인) — 실측 ${oRecalled[0].n}통`);

  // ── 정리 — 테스트 유저·우편·패스·원장·관측·브로드캐스트 삭제(FK 순서: receipts→broadcasts) ──
  const testUserIds = (await db.select({ id: users.id }).from(users).where(and(eq(users.projCode, PROJ_CODE), sql`${users.providerId} like ${TAG + '%'}`))).map((r) => r.id);
  if (testUserIds.length) {
    await db.delete(walletLedger).where(and(eq(walletLedger.projCode, PROJ_CODE), inArray(walletLedger.userId, testUserIds)));
    await db.delete(attendancePasses).where(and(eq(attendancePasses.projCode, PROJ_CODE), inArray(attendancePasses.userId, testUserIds)));
    await db.delete(mailBroadcastReceipts).where(and(eq(mailBroadcastReceipts.projCode, PROJ_CODE), inArray(mailBroadcastReceipts.userId, testUserIds)));
    await db.delete(mails).where(and(eq(mails.projCode, PROJ_CODE), inArray(mails.userId, testUserIds)));
  }
  await db.delete(mailBroadcasts).where(and(eq(mailBroadcasts.projCode, PROJ_CODE), sql`${mailBroadcasts.idemKey} like ${TAG + '%'}`));
  await db.delete(purchaseEvent).where(and(eq(purchaseEvent.projCode, PROJ_CODE), sql`${purchaseEvent.createdAt} >= ${testStart.toISOString()}`, sql`${purchaseEvent.stage} like '%mail%'`));
  if (testUserIds.length) await db.delete(users).where(inArray(users.id, testUserIds));
  delete process.env.ADMIN_TOKEN;
  console.log('  ✓ 정리 완료(테스트 유저·우편·패스·원장·관측·브로드캐스트 삭제)');

  console.log(fail === 0 ? '\n✅ _dv_mail_live 통과 — 발송dedup·필터3·수령·이중0·만료·회수·패스원자·큐만석롤백·브로드캐스트lazy·음수·fail-closed·관측·모두받기집계·A/B 전부' : `\n❌ ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
