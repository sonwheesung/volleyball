// 쿠폰 발급·사용 라이브 가드 (BACKEND_SYSTEM §13.14·§13.15·§13.17 P0-5) — 라우트 핸들러 직접 import·호출, 라이브 dev DB.
// 검증: 발급→사용(잔액+reward)·이중사용('used')·기간(만료/시작전)·개인타겟 은폐('invalid')·disabled·
//       **무토큰 redeem 401 + 익명 dev-user-1 지갑 무변화(C1)**·date-only endsAt KST 정규화(C2)·
//       존재X targetUserId 400 no-such-user(C3)·중복코드 409·사용기록 DELETE 409·무토큰 admin 401.
//       A/B 자가검증 1개(이중사용 UNIQUE 게이트 민감도 — 허위 오라클 방지).
// Usage: cd server && npx tsx --env-file=.env.local tools/_dv_coupon_live.ts
process.env.ADMIN_TOKEN = 'test-admin-token-abcdef0123456789'; // ≥16자(fail-closed 통과) — import 전 주입
process.env.SESSION_JWT_SECRET = 'test-session-secret-abcdef0123456789'; // signToken↔verifyToken 일관 — import 전 주입

(async () => {
  const ADMIN = process.env.ADMIN_TOKEN!;
  const couponRoute = await import('../app/api/admin/coupon/route');
  const redeemRoute = await import('../app/api/coupon/redeem/route');
  const { signToken } = await import('../lib/auth');
  const { ensureUser, ensureProj } = await import('../lib/wallet');
  const { db } = await import('../db');
  const { coupons, couponRedemptions, walletLedger, users } = await import('../db/schema');
  const { and, eq, like, sql } = await import('drizzle-orm');
  const { PROJ_CODE } = await import('../lib/proj');

  let fail = 0;
  const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

  const PFX = '_DVCPN_';
  const MISSING = '00000000-0000-0000-0000-000000000000'; // 유효 UUID 형식·미존재
  const hdr = (auth: string | null): Record<string, string> => { const h: Record<string, string> = { 'content-type': 'application/json' }; if (auth) h.authorization = `Bearer ${auth}`; return h; };
  const aPost = (body: unknown, auth: string | null = ADMIN) => couponRoute.POST(new Request('http://x/api/admin/coupon', { method: 'POST', headers: hdr(auth), body: JSON.stringify(body) }));
  const aPatch = (body: unknown, auth: string | null = ADMIN) => couponRoute.PATCH(new Request('http://x/api/admin/coupon', { method: 'PATCH', headers: hdr(auth), body: JSON.stringify(body) }));
  const aDel = (id: string, auth: string | null = ADMIN) => couponRoute.DELETE(new Request(`http://x/api/admin/coupon?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: hdr(auth) }));
  const redeem = (code: string, token: string | null) => redeemRoute.POST(new Request('http://x/api/coupon/redeem', { method: 'POST', headers: hdr(token), body: JSON.stringify({ code }) }));
  const bal = async (uid: string): Promise<number> => { const r = await db.select({ b: users.balance }).from(users).where(eq(users.id, uid)).limit(1); return r.length ? r[0].b : NaN; };
  const redCount = async (uid: string, couponId: string): Promise<number> => { const r = await db.select({ n: sql<number>`count(*)::int` }).from(couponRedemptions).where(and(eq(couponRedemptions.userId, uid), eq(couponRedemptions.couponId, couponId))); return r[0]?.n ?? 0; };

  let uid1 = '', uid2 = '', uidDev = '';
  try {
    await ensureProj();
    const pid1 = PFX + 'user1', pid2 = PFX + 'user2';
    uid1 = await ensureUser(pid1, 'dev');
    uid2 = await ensureUser(pid2, 'dev');
    uidDev = await ensureUser('dev-user-1', 'dev'); // 익명 폴백 유저(C1 대조)
    const token1 = signToken(`dev:${pid1}`);

    console.log('── ① 발급(POST) → 유저 redeem 성공 → 잔액 +reward(DB 대조) ──');
    const bal1Before = await bal(uid1);
    const rGood = await (await aPost({ code: PFX + 'GOOD', rewardDiamonds: 100 })).json();
    ok(rGood.ok === true && typeof rGood.id === 'string', '① 발급 → ok+id');
    const goodId = rGood.id as string;
    const rRed = await redeem(PFX + 'GOOD', token1);
    const rRedBody = await rRed.json();
    ok(rRed.status === 200 && rRedBody.ok === true && rRedBody.reward === 100, '① redeem 성공(200·reward 100)');
    ok((await bal(uid1)) === bal1Before + 100, `① 잔액 +100(DB 대조) [${bal1Before}→${await bal(uid1)}]`);

    console.log('── ② 같은 유저 재사용 → used(잔액 불변) + A/B 자가검증 ──');
    const balUsed = await bal(uid1);
    const rUsed = await (await redeem(PFX + 'GOOD', token1)).json();
    ok(rUsed.ok === false && rUsed.reason === 'used', '② 재사용 → used');
    ok((await bal(uid1)) === balUsed, '② 재사용 잔액 불변');
    // A/B 자가검증: ②의 'used' 판정은 UNIQUE(proj,coupon,user) 게이트에 의존. 게이트가 실제로 살아있는지(허위 오라클 아님) 대조.
    const aBlocked = await db.insert(couponRedemptions).values({ projCode: PROJ_CODE, couponId: goodId, userId: uid1 })
      .onConflictDoNothing({ target: [couponRedemptions.projCode, couponRedemptions.couponId, couponRedemptions.userId] }).returning({ id: couponRedemptions.id });
    ok(aBlocked.length === 0, '②-AB[A] 같은 (coupon,uid1) 수동 insert → UNIQUE로 차단(게이트 실재)');
    const bAllowed = await db.insert(couponRedemptions).values({ projCode: PROJ_CODE, couponId: goodId, userId: uid2 })
      .onConflictDoNothing({ target: [couponRedemptions.projCode, couponRedemptions.couponId, couponRedemptions.userId] }).returning({ id: couponRedemptions.id });
    ok(bAllowed.length === 1, '②-AB[B] 다른 (coupon,uid2) insert → 통과(게이트가 유저별·"항상 차단" 아님=민감)');
    if (bAllowed.length) await db.delete(couponRedemptions).where(eq(couponRedemptions.id, bAllowed[0].id)); // B 대조행 즉시 정리

    console.log('── ③ 만료(endsAt 과거) → expired ──');
    const past = new Date(Date.now() - 86_400_000).toISOString();
    await aPost({ code: PFX + 'EXP', rewardDiamonds: 50, endsAt: past });
    const rExp = await (await redeem(PFX + 'EXP', token1)).json();
    ok(rExp.ok === false && rExp.reason === 'expired', '③ 만료 쿠폰 → expired');

    console.log('── ④ 시작 전(startsAt 미래) → expired ──');
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await aPost({ code: PFX + 'FUT', rewardDiamonds: 50, startsAt: future });
    const rFut = await (await redeem(PFX + 'FUT', token1)).json();
    ok(rFut.ok === false && rFut.reason === 'expired', '④ 시작 전 쿠폰 → expired');

    console.log('── ⑤ 개인 쿠폰 타겟 불일치 → invalid(존재 은폐) ──');
    await aPost({ code: PFX + 'TGT', rewardDiamonds: 50, targetUserId: uid2 });
    const rTgt = await (await redeem(PFX + 'TGT', token1)).json(); // uid1이 uid2 타겟 쿠폰 시도
    ok(rTgt.ok === false && rTgt.reason === 'invalid', '⑤ 타겟 불일치 → invalid(not-eligible 아님·은폐)');

    console.log('── ⑥ disabled → invalid ──');
    const rDis = await (await aPost({ code: PFX + 'DIS', rewardDiamonds: 50 })).json();
    await aPatch({ id: rDis.id, disabled: true });
    const rDisR = await (await redeem(PFX + 'DIS', token1)).json();
    ok(rDisR.ok === false && rDisR.reason === 'invalid', '⑥ disabled 쿠폰 → invalid');

    console.log('── ⑦ 무토큰 redeem → 401 unauthorized + dev-user-1 지갑·redemption 무변화(C1) ──');
    const rNoAuthC = await (await aPost({ code: PFX + 'NOAUTH', rewardDiamonds: 100 })).json();
    const devBalBefore = await bal(uidDev);
    const devRedBefore = await redCount(uidDev, rNoAuthC.id);
    const rNoAuth = await redeem(PFX + 'NOAUTH', null);
    const rNoAuthBody = await rNoAuth.json();
    ok(rNoAuth.status === 401 && rNoAuthBody.reason === 'unauthorized', '⑦ 무토큰 redeem → 401 unauthorized');
    ok((await bal(uidDev)) === devBalBefore, '⑦ dev-user-1 지갑 무변화(익명 버킷 오적립 없음)');
    ok((await redCount(uidDev, rNoAuthC.id)) === devRedBefore, '⑦ dev-user-1 redemption 무변화');

    console.log('── ⑧ date-only endsAt → DB값 T14:59:59.999Z(C2) ──');
    const rDate = await (await aPost({ code: PFX + 'DATE', rewardDiamonds: 50, endsAt: '2099-12-31' })).json();
    const drow = await db.select({ endsAt: coupons.endsAt }).from(coupons).where(eq(coupons.id, rDate.id));
    const got = drow[0]?.endsAt?.toISOString();
    ok(got === '2099-12-31T14:59:59.999Z', `⑧ 'YYYY-MM-DD' endsAt → 14:59:59.999Z(KST 23:59:59) [got=${got}]`);

    console.log('── ⑨ 존재하지 않는 targetUserId 발급 → 400 no-such-user(C3) ──');
    const rNoUser = await aPost({ code: PFX + 'NOUSER', rewardDiamonds: 50, targetUserId: MISSING });
    const rNoUserBody = await rNoUser.json();
    ok(rNoUser.status === 400 && rNoUserBody.reason === 'no-such-user', '⑨ 미존재 UUID targetUserId → 400 no-such-user');
    const rBadUuid = await aPost({ code: PFX + 'BADUUID', rewardDiamonds: 50, targetUserId: 'not-a-uuid' });
    const rBadUuidBody = await rBadUuid.json();
    ok(rBadUuid.status === 400 && rBadUuidBody.reason === 'no-such-user', '⑨ 잘못된 uuid 형식(select throw) → 400 no-such-user(FK위반 위장 아님)');

    console.log('── ⑩ 중복 코드 발급 → 409 duplicate ──');
    const rDup = await aPost({ code: PFX + 'GOOD', rewardDiamonds: 100 }); // ①과 동일 코드
    const rDupBody = await rDup.json();
    ok(rDup.status === 409 && rDupBody.reason === 'duplicate', '⑩ 중복 코드 → 409 duplicate');

    console.log('── ⑪ 사용기록 있는 쿠폰 DELETE → 409 has-redemptions ──');
    const rDelUsed = await aDel(goodId); // GOOD은 uid1이 ①에서 사용
    const rDelUsedBody = await rDelUsed.json();
    ok(rDelUsed.status === 409 && rDelUsedBody.reason === 'has-redemptions', '⑪ 사용기록 있음 → 409 has-redemptions');

    console.log('── ⑫ 무토큰 admin POST → 401 ──');
    ok((await aPost({ code: PFX + 'NOADMIN', rewardDiamonds: 50 }, null)).status === 401, '⑫ 무토큰 admin POST → 401(fail-closed)');
  } finally {
    // 정리 — 테스트 유저 redemption·원장, 프리픽스 쿠폰, 테스트 유저 삭제(FK 순서: redemption→ledger→coupon→user)
    if (uid1) await db.delete(couponRedemptions).where(eq(couponRedemptions.userId, uid1));
    if (uid2) await db.delete(couponRedemptions).where(eq(couponRedemptions.userId, uid2));
    await db.delete(couponRedemptions).where(sql`coupon_id in (select id from coupons where proj_code = ${PROJ_CODE} and code like ${PFX + '%'})`);
    if (uid1) await db.delete(walletLedger).where(eq(walletLedger.userId, uid1));
    if (uid2) await db.delete(walletLedger).where(eq(walletLedger.userId, uid2));
    await db.delete(coupons).where(and(eq(coupons.projCode, PROJ_CODE), like(coupons.code, `${PFX}%`)));
    if (uid1) await db.delete(users).where(eq(users.id, uid1));
    if (uid2) await db.delete(users).where(eq(users.id, uid2));
    console.log('  ✓ 정리 완료(_DVCPN_ 테스트 쿠폰·유저·원장 삭제)');
  }

  console.log(fail === 0 ? '\n✅ 쿠폰 라이브 가드 — 발급·사용·기간·타겟·인증폴백(C1)·타임존(C2)·타겟검증(C3) 전부 통과' : `\n❌ ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
