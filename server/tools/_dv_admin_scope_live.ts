// 관리자 write 라우트 proj 스코프 라이브 가드 (BACKEND_SYSTEM §13.17 R1/R2/R3 · §13.2 멀티게임 격리)
//   — 라우트 핸들러 직접 import·호출, 라이브 dev DB. 티켓 T1/T2(_dv_ticket_live)와 **같은 결함 클래스의 형제 라우트** 봉인.
// 검증:
//   R1 admin/refund + ticketId: 타 proj 티켓 → 404 + **트랜잭션 전체 롤백**(지갑 무변화·원장 0건 — "돈만 나가고 티켓은 남 게임에 찍히는" 부분 성공 차단)
//   R2 lib/wallet applyWalletTx: 타 proj 유저 지갑 차감(refund)·지급(grant) 불가 + balance==Σledger 불변식 유지
//   R3 admin/coupon(POST·PATCH)·admin/mail(POST): 타 proj 유저 대상 발급/발송 → 기존 실패 어휘 400 no-such-user
// A/B 자가검증: 각 스코프 검사마다 대조군을 상주 — ①같은 호출이 **우리 proj** 대상엔 실제로 200(항상 실패하는 무딘 검사 아님)
//              ②차단된 대상 행이 **DB에 실재**(부재가 아니라 스코프가 막은 실패임을 증명)
// 정리: **자기가 만든 id만** 삭제(프리픽스 일괄 삭제 금지 — 병렬 세션 데이터 유실 사고 방지).
// Usage: cd server && npx tsx tools/_dv_admin_scope_live.ts (dev는 .env.development.local 우선, 없으면 .env.local)
import './_env'; // db 모듈 import 전에 env 주입(호이스팅 순서 — 첫 import)
process.env.ADMIN_TOKEN = 'test-admin-token-abcdef0123456789'; // ≥16자(fail-closed 통과용) — import 전 주입
process.env.SESSION_JWT_SECRET = 'test-session-secret-abcdef0123456789';

(async () => {
  const ADMIN = process.env.ADMIN_TOKEN!;
  const refundRoute = await import('../app/api/admin/refund/route');
  const grantRoute = await import('../app/api/admin/grant/route');
  const couponRoute = await import('../app/api/admin/coupon/route');
  const mailRoute = await import('../app/api/admin/mail/route');
  const { ensureUser, ensureProj, applyWallet } = await import('../lib/wallet');
  const { db } = await import('../db');
  const { tickets, users, projInfo, walletLedger, coupons, purchaseEvent } = await import('../db/schema');
  const { and, eq, inArray, sql } = await import('drizzle-orm');

  let fail = 0;
  const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

  const PFX = '_DV_ASCOPE_';
  const OTHER_PROJ = '_dv_ascope_otherproj'; // 타 게임(멀티게임 격리 대조군) — 가드가 만들고 가드가 지운다
  const MISSING = '00000000-0000-0000-0000-000000000000'; // 유효 UUID 형식·미존재(404 유도)

  const hdr = (auth: string | null): Record<string, string> => { const h: Record<string, string> = { 'content-type': 'application/json' }; if (auth) h.authorization = `Bearer ${auth}`; return h; };
  const aRefund = (body: unknown, auth: string | null = ADMIN) => refundRoute.POST(new Request('http://x/api/admin/refund', { method: 'POST', headers: hdr(auth), body: JSON.stringify(body) }));
  const aGrant = (body: unknown, auth: string | null = ADMIN) => grantRoute.POST(new Request('http://x/api/admin/grant', { method: 'POST', headers: hdr(auth), body: JSON.stringify(body) }));
  const aCoupon = (body: unknown, auth: string | null = ADMIN) => couponRoute.POST(new Request('http://x/api/admin/coupon', { method: 'POST', headers: hdr(auth), body: JSON.stringify(body) }));
  const aCouponPatch = (body: unknown, auth: string | null = ADMIN) => couponRoute.PATCH(new Request('http://x/api/admin/coupon', { method: 'PATCH', headers: hdr(auth), body: JSON.stringify(body) }));
  const aMail = (body: unknown, auth: string | null = ADMIN) => mailRoute.POST(new Request('http://x/api/admin/mail', { method: 'POST', headers: hdr(auth), body: JSON.stringify(body) }));

  const rj = async (p: Promise<Response>): Promise<{ status: number; body: Record<string, unknown> }> => {
    const r = await p; let body: Record<string, unknown> = {};
    try { body = (await r.json()) as Record<string, unknown>; } catch { /* 본문 없음 */ }
    return { status: r.status, body };
  };
  const ticketRow = async (id: string) => (await db.select({ status: tickets.status, reply: tickets.reply, repliedAt: tickets.repliedAt }).from(tickets).where(eq(tickets.id, id)).limit(1))[0];
  const balOf = async (id: string) => (await db.select({ b: users.balance }).from(users).where(eq(users.id, id)).limit(1))[0]?.b ?? null;
  const ledgerSum = async (id: string) => (await db.select({ s: sql<number>`coalesce(sum(${walletLedger.delta}),0)::int` }).from(walletLedger).where(eq(walletLedger.userId, id)))[0]?.s ?? 0;
  const ledgerCount = async (id: string) => (await db.select({ n: sql<number>`count(*)::int` }).from(walletLedger).where(eq(walletLedger.userId, id)))[0]?.n ?? 0;
  const keyExists = async (k: string) => ((await db.select({ n: sql<number>`count(*)::int` }).from(walletLedger).where(eq(walletLedger.idempotencyKey, k)))[0]?.n ?? 0) > 0;
  const couponByCode = async (code: string) => (await db.select({ id: coupons.id, targetUserId: coupons.targetUserId }).from(coupons).where(eq(coupons.code, code)).limit(1))[0];

  const madeTickets: string[] = [];
  const madeUsers: string[] = [];
  const madeCoupons: string[] = [];
  let madeProj = false;

  try {
    await ensureProj();
    const pidA = PFX + 'userA';
    const uidA = await ensureUser(pidA, 'dev'); madeUsers.push(uidA);

    // 타 proj 대조군 — 별도 게임(projInfo) + 그 게임 유저(잔액 보유) + 그 게임 티켓 1건
    await db.insert(projInfo).values({ projCode: OTHER_PROJ, name: OTHER_PROJ }).onConflictDoNothing({ target: projInfo.projCode });
    madeProj = true;
    const otherUid = (await db.insert(users).values({ projCode: OTHER_PROJ, provider: 'dev', providerId: PFX + 'otherUser', balance: 500 })
      .returning({ id: users.id }))[0].id;
    madeUsers.push(otherUid);
    const otherTid = (await db.insert(tickets).values({ projCode: OTHER_PROJ, userId: otherUid, category: 'refund', content: PFX + '타 게임 환불 문의' })
      .returning({ id: tickets.id }))[0].id;
    madeTickets.push(otherTid);
    const myTid = (await db.insert(tickets).values({ projCode: (await import('../lib/proj')).PROJ_CODE, userId: uidA, category: 'refund', content: PFX + '우리 게임 환불 문의' })
      .returning({ id: tickets.id }))[0].id;
    madeTickets.push(myTid);

    // 우리 유저 시드 잔액(정상 환불이 실제로 깎이는지 볼 기준선)
    await applyWallet(uidA, 1000, 'adjust', PFX + 'seed');

    console.log('── ① R1: 타 proj 티켓 환불 → 404 + 트랜잭션 전체 롤백(부분 성공 차단) ──');
    const tBefore = await ticketRow(otherTid);
    const balBefore = await balOf(uidA);
    const K_CROSS = PFX + 'k_crossticket';
    const rCross = await rj(aRefund({ userId: uidA, amount: 100, note: 'HACK', ticketId: otherTid, key: K_CROSS }));
    ok(rCross.status === 404 && rCross.body.ok === false, `① 타 proj 티켓 환불 → 404·ok:false [status=${rCross.status} reason=${rCross.body.reason}]`);
    const tAfter = await ticketRow(otherTid);
    ok(tAfter?.status === tBefore?.status && tAfter?.reply === tBefore?.reply && (tAfter?.repliedAt ?? null) === (tBefore?.repliedAt ?? null),
      `① 타 proj 티켓 DB 무변화 [status=${tAfter?.status} reply=${tAfter?.reply}]`);
    ok((await balOf(uidA)) === balBefore, `① 지갑 롤백 — 잔액 무변화 [${balBefore} → ${await balOf(uidA)}]`);
    ok(!(await keyExists(K_CROSS)), '① 지갑 롤백 — 원장에 그 멱등키 행 0건(돈만 나가는 부분 성공 없음)');

    console.log('── ①-AB 민감도: 같은 호출이 우리 proj 티켓엔 200 + 대상 행 DB 실재 ──');
    const K_OKT = PFX + 'k_ourticket';
    const rMine = await rj(aRefund({ userId: uidA, amount: 100, note: PFX + '정상 환불', ticketId: myTid, key: K_OKT }));
    ok(rMine.status === 200 && rMine.body.ok === true && rMine.body.applied === true, `①-AB 우리 proj 티켓 환불 → 200 applied [status=${rMine.status}]`);
    ok((await ticketRow(myTid))?.status === 'refunded', '①-AB 우리 proj 티켓 status=refunded 반영(대조군)');
    ok((await balOf(uidA)) === (balBefore ?? 0) - 100, `①-AB 잔액 −100 실제 차감 [${balBefore} → ${await balOf(uidA)}]`);
    const otherTicketStill = (await db.select({ n: sql<number>`count(*)::int` }).from(tickets).where(eq(tickets.id, otherTid)))[0]?.n ?? 0;
    ok(otherTicketStill === 1, `①-AB 차단된 타 proj 티켓은 DB에 실재(n=${otherTicketStill}) — 부재가 아니라 스코프가 막은 404`);

    console.log('── ② R1: 미존재 uuid 티켓 환불 → 404 + 롤백(허위 ok 금지) ──');
    const K_MISS = PFX + 'k_missticket';
    const rMiss = await rj(aRefund({ userId: uidA, amount: 100, note: 'x', ticketId: MISSING, key: K_MISS }));
    ok(rMiss.status === 404 && rMiss.body.ok !== true, `② 미존재 티켓 환불 → 404·ok!==true [status=${rMiss.status}]`);
    ok(!(await keyExists(K_MISS)), '② 미존재 티켓 환불 — 원장 0건(지갑 롤백)');

    console.log('── ③ 정상 경로 불변: ticketId 없는 환불 = 200 + 원장 기록 ──');
    const K_NOTKT = PFX + 'k_noticket';
    const balPre = await balOf(uidA);
    const rNoT = await rj(aRefund({ userId: uidA, amount: 50, note: PFX + '티켓없는 회수', key: K_NOTKT }));
    ok(rNoT.status === 200 && rNoT.body.ok === true && rNoT.body.applied === true, `③ ticketId 없는 환불 → 200 applied [status=${rNoT.status}]`);
    ok(await keyExists(K_NOTKT), '③ 원장 기록됨');
    ok((await balOf(uidA)) === (balPre ?? 0) - 50, '③ 잔액 −50 반영');
    const rDedup = await rj(aRefund({ userId: uidA, amount: 50, note: PFX + '티켓없는 회수', key: K_NOTKT }));
    ok(rDedup.status === 200 && rDedup.body.applied === false, `③ 같은 멱등키 재시도 → 200 applied:false(멱등 불변) [applied=${rDedup.body.applied}]`);
    // §13.17 P0-3 수렴: 멱등(applied:false)이어도 티켓 status는 refunded로 수렴 — R1의 rowcount 404가 이 경로를 깨지 않았나
    await db.update(tickets).set({ status: 'open' }).where(eq(tickets.id, myTid)); // 티켓만 되돌리고 같은 키 재시도
    const rConv = await rj(aRefund({ userId: uidA, amount: 100, note: PFX + '정상 환불', ticketId: myTid, key: K_OKT }));
    ok(rConv.status === 200 && rConv.body.applied === false, `③ 티켓 있는 멱등 재시도 → 200 applied:false [applied=${rConv.body.applied}]`);
    ok((await ticketRow(myTid))?.status === 'refunded', '③ 멱등이어도 티켓 status=refunded로 수렴(P0-3 불변)');

    console.log('── ④ R2: 타 proj 유저 지갑 차감(refund) 불가 ──');
    const K_XUSER = PFX + 'k_crossuser_refund';
    const oBalBefore = await balOf(otherUid);
    const rXUser = await rj(aRefund({ userId: otherUid, amount: 300, note: 'HACK', key: K_XUSER }));
    ok(rXUser.body.ok !== true, `④ 타 proj 유저 환불 → 실패 [status=${rXUser.status} reason=${rXUser.body.reason}]`);
    ok((await balOf(otherUid)) === oBalBefore, `④ 타 proj 유저 잔액 무변화 [${oBalBefore} → ${await balOf(otherUid)}]`);
    ok(!(await keyExists(K_XUSER)), '④ 타 proj 유저 원장 행 0건(우리 proj 원장에 남 유저 거래 미기록)');

    console.log('── ⑤ R2: 타 proj 유저 지갑 지급(grant) 불가 + AB 민감도 ──');
    const K_XGRANT = PFX + 'k_crossuser_grant';
    const rXGrant = await rj(aGrant({ userId: otherUid, amount: 300, note: 'HACK', key: K_XGRANT }));
    ok(rXGrant.body.ok !== true, `⑤ 타 proj 유저 지급 → 실패 [status=${rXGrant.status} reason=${rXGrant.body.reason}]`);
    ok((await balOf(otherUid)) === oBalBefore, '⑤ 타 proj 유저 잔액 무변화(지급도 안 먹힘)');
    ok((await ledgerCount(otherUid)) === 0, `⑤ 타 proj 유저 원장 총 0건 [n=${await ledgerCount(otherUid)}]`);
    const K_OKGRANT = PFX + 'k_ourgrant';
    const balPreG = await balOf(uidA);
    const rGrantOk = await rj(aGrant({ userId: uidA, amount: 300, note: PFX + '정상 지급', key: K_OKGRANT }));
    ok(rGrantOk.status === 200 && rGrantOk.body.applied === true, `⑤-AB 우리 proj 유저 지급 → 200 applied [status=${rGrantOk.status}]`);
    ok((await balOf(uidA)) === (balPreG ?? 0) + 300, '⑤-AB 잔액 +300 반영(검사 민감도 — 항상 실패 아님)');
    ok(oBalBefore === 500, `⑤-AB 차단된 타 proj 유저는 DB에 실재·잔액 보유(balance=${oBalBefore}) — 부재가 아니라 스코프가 막은 실패`);
    const rMissUser = await rj(aGrant({ userId: MISSING, amount: 10, note: 'x', key: PFX + 'k_missuser' }));
    ok(rMissUser.body.ok !== true, `⑤ 미존재 유저 지급 → 실패(기존 어휘 유지) [status=${rMissUser.status} reason=${rMissUser.body.reason}]`);

    console.log('── ⑥ R2 불변식: balance == Σledger (양 proj 유저) ──');
    const bA = await balOf(uidA), sA = await ledgerSum(uidA);
    ok(bA === sA, `⑥ 우리 proj 유저 balance==Σledger [balance=${bA} Σ=${sA}]`);
    const bO = await balOf(otherUid), sO = await ledgerSum(otherUid);
    ok(bO === 500 && sO === 0, `⑥ 타 proj 유저 = 손대지 않음(balance=${bO} Σ=${sO}, 원장 미생성이라 불변식 대상 밖)`);

    console.log('── ⑦ R3: 쿠폰 개인 대상 proj 스코프(POST·PATCH) ──');
    const CODE_X = PFX + 'CROSS';
    const rCX = await rj(aCoupon({ code: CODE_X, rewardDiamonds: 10, targetUserId: otherUid }));
    ok(rCX.status === 400 && rCX.body.reason === 'no-such-user', `⑦ 타 proj 유저 대상 쿠폰 발급 → 400 no-such-user [status=${rCX.status} reason=${rCX.body.reason}]`);
    const cX = await couponByCode(CODE_X.toUpperCase());
    if (cX) madeCoupons.push(cX.id); // FAIL 시(=뮤턴트) 생성돼버린 행도 이 실행이 만든 것 → 정리 대상에 편입
    ok(!cX, '⑦ 쿠폰 행 미생성(외래 참조 행 안 남음)');
    const CODE_OK = PFX + 'MINE';
    const rCOk = await rj(aCoupon({ code: CODE_OK, rewardDiamonds: 10, targetUserId: uidA }));
    ok(rCOk.status === 200 && rCOk.body.ok === true, `⑦-AB 우리 proj 유저 대상 쿠폰 발급 → 200 [status=${rCOk.status} reason=${rCOk.body.reason}]`);
    const cRow = await couponByCode(CODE_OK.toUpperCase());
    if (cRow) madeCoupons.push(cRow.id);
    ok(!!cRow && cRow.targetUserId === uidA, '⑦-AB 쿠폰 행 생성 + target=우리 유저(검사 민감도)');
    if (cRow) {
      const rPX = await rj(aCouponPatch({ id: cRow.id, targetUserId: otherUid }));
      ok(rPX.status === 400 && rPX.body.reason === 'no-such-user', `⑦ 쿠폰 PATCH로 타 proj 유저 지정 → 400 no-such-user [status=${rPX.status} reason=${rPX.body.reason}]`);
      ok((await couponByCode(CODE_OK.toUpperCase()))?.targetUserId === uidA, '⑦ PATCH 차단 후 target 원본 유지(DB 무변화)');
      const rPOk = await rj(aCouponPatch({ id: cRow.id, targetUserId: null }));
      ok(rPOk.status === 200 && rPOk.body.ok === true, `⑦-AB 동일 PATCH가 정상 대상(전체=null)엔 200 [status=${rPOk.status}]`);
      ok((await couponByCode(CODE_OK.toUpperCase()))?.targetUserId === null, '⑦-AB PATCH 실제 반영(항상 400 아님)');
    }

    console.log('── ⑧ R3: 우편 개별 발송 대상 proj 스코프 ──');
    const hasMails = ((await db.execute(sql`select 1 from information_schema.tables where table_schema='public' and table_name='mails'`)) as unknown as { rows?: unknown[] }).rows?.length ?? 0;
    const rMX = await rj(aMail({ target: 'user', userId: otherUid, title: 'T', body: 'B', attachType: 'diamonds', attachAmount: 10, idemKey: PFX + 'mailx' }));
    ok(rMX.status === 400 && rMX.body.reason === 'no-such-user', `⑧ 타 proj 유저 우편 발송 → 400 no-such-user [status=${rMX.status} reason=${rMX.body.reason}]`);
    const rMOk = await rj(aMail({ target: 'user', userId: uidA, title: 'T', body: 'B', attachType: 'diamonds', attachAmount: 10, idemKey: PFX + 'mailok' }));
    ok(!(rMOk.status === 400 && rMOk.body.reason === 'no-such-user'),
      `⑧-AB 우리 proj 유저는 대상 게이트 통과(no-such-user 아님) [status=${rMOk.status} reason=${rMOk.body.reason}]${hasMails ? '' : ' ※mails 테이블 부재(마이그레이션 0003 미적용) → 이후 단계는 500 error가 정상'}`);
    if (!hasMails) console.log('  ℹ mails 테이블 없음 — 우편 발송 성공 경로는 이 DB에서 라이브 검증 불가(게이트만 검증)');
  } finally {
    // 정리 — **이 실행이 만든 id만** 삭제(FK 순서: 쿠폰 → 원장/감사 → 티켓 → 유저 → proj). 프리픽스 일괄 삭제 금지.
    await new Promise((r) => setTimeout(r, 400)); // fire-and-forget 감사행(purchase_event) 착지 대기
    if (madeCoupons.length) await db.delete(coupons).where(inArray(coupons.id, madeCoupons));
    if (madeUsers.length) {
      await db.delete(walletLedger).where(inArray(walletLedger.userId, madeUsers));
      await db.delete(purchaseEvent).where(inArray(purchaseEvent.userId, madeUsers));
    }
    if (madeTickets.length) await db.delete(tickets).where(inArray(tickets.id, madeTickets));
    if (madeUsers.length) await db.delete(users).where(inArray(users.id, madeUsers));
    if (madeProj) await db.delete(projInfo).where(and(eq(projInfo.projCode, OTHER_PROJ), sql`not exists (select 1 from users u where u.proj_code = ${OTHER_PROJ})`));
    console.log('  ✓ 정리 완료(이번 실행이 만든 쿠폰·원장·감사행·티켓·유저·테스트 proj만 삭제)');
  }

  console.log(fail === 0 ? '\n✅ 관리자 write proj 스코프 가드 — 환불 티켓 스코프·롤백·지갑 유저 스코프·불변식·쿠폰/우편 대상 스코프 전부 통과' : `\n❌ ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
