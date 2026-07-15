// 계정 삭제(탈퇴)·연령 게이트 라이브 가드 (AUTH_SYSTEM §7·§8, #119·#110) — 라우트 핸들러 직접 import·호출, 라이브 dev DB.
// 검증: ① 탈퇴 → 그 토큰 후속 호출(지갑) 401  ② sub 비복원 파기(재로그인=새 userId)  ③ wallet_ledger 행 보존(가명화, 삭제 아님)
//       ④ 멱등(이중 탈퇴 200)  ⑤ 무토큰 DELETE 401  ⑥ ageConfirmed 없는 신규 로그인 400·있으면 생성+ageConfirmedAt 기록
//       + A/B 이빨(탈퇴 전 지갑 200=토큰 정상 → 401은 탈퇴가 원인 · 연령 무확인이면 행 0개 생성 대조).
// Usage: cd server && DATABASE_URL=... npx tsx tools/_dv_account_live.ts  (dev는 .env.development.local 우선, 없으면 .env.local)
import './_env'; // db 모듈 import 전에 env 주입(호이스팅 순서 — 첫 import)

(async () => {
  const loginRoute = await import('../app/api/auth/login/route');
  const walletRoute = await import('../app/api/wallet/route');
  const accountRoute = await import('../app/api/account/route');
  const { db } = await import('../db');
  const { users, walletLedger } = await import('../db/schema');
  const { eq, and, like, inArray } = await import('drizzle-orm');
  const { PROJ_CODE } = await import('../lib/proj');
  const { ensureProj, applyWallet, findUserRow } = await import('../lib/wallet');

  let fail = 0;
  const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

  const PFX = '_DVACC_';
  const createdIds: string[] = []; // 정리용(가명화되면 providerId 프리픽스가 사라지므로 id로 추적)
  const hdr = (auth: string | null): Record<string, string> => { const h: Record<string, string> = { 'content-type': 'application/json' }; if (auth) h.authorization = `Bearer ${auth}`; return h; };
  const login = (body: unknown) => loginRoute.POST(new Request('http://x/api/auth/login', { method: 'POST', headers: hdr(null), body: JSON.stringify(body) }));
  const walletGet = (auth: string | null) => walletRoute.GET(new Request('http://x/api/wallet', { method: 'GET', headers: hdr(auth) }));
  const del = (auth: string | null) => accountRoute.DELETE(new Request('http://x/api/account', { method: 'DELETE', headers: hdr(auth) }));

  try {
    await ensureProj();

    console.log('── ⑥ 연령 게이트: ageConfirmed 없는 신규 로그인 400 · 있으면 생성 + ageConfirmedAt 기록 ──');
    const pidAge = PFX + 'age_' + Date.now();
    const rNoAge = await login({ provider: 'dev', providerId: pidAge }); // ageConfirmed 없음
    ok(rNoAge.status === 400, '⑥ ageConfirmed 없는 신규 로그인 → 400');
    // A/B 이빨: 무확인이면 행이 생성되지 않아야 한다(400이 진짜 생성 차단인지 대조)
    const noAgeRows = await db.select({ id: users.id }).from(users).where(and(eq(users.projCode, PROJ_CODE), eq(users.provider, 'dev'), eq(users.providerId, pidAge)));
    ok(noAgeRows.length === 0, '⑥-AB 무확인 신규는 users 행 0개(생성 자체가 차단됨 — 허위통과 아님)');
    const rAge = await login({ provider: 'dev', providerId: pidAge, ageConfirmed: true });
    const bAge = await rAge.json();
    ok(rAge.status === 200 && typeof bAge.token === 'string' && typeof bAge.userId === 'string', '⑥ ageConfirmed=true 신규 로그인 → 200+token');
    if (bAge.userId) createdIds.push(bAge.userId);
    const ageRow = (await db.select({ ac: users.ageConfirmedAt }).from(users).where(eq(users.id, bAge.userId)))[0];
    ok(!!ageRow?.ac, '⑥ 생성 계정에 ageConfirmedAt 기록됨(non-null)');
    // 기존 계정 재로그인은 ageConfirmed 없이도 통과(소급 강제 안 함, AUTH §8.1)
    ok((await login({ provider: 'dev', providerId: pidAge })).status === 200, '⑥ 기존 계정 재로그인은 ageConfirmed 없이도 200(신규만 게이트)');

    console.log('── 셋업: 탈퇴 대상 계정 생성 + 원장 1건 + 지갑 GET 200(A/B 기준선) ──');
    const pidA = PFX + 'del_' + Date.now();
    const rA = await login({ provider: 'dev', providerId: pidA, ageConfirmed: true });
    const bA = await rA.json();
    const token = bA.token as string;
    const oldUserId = bA.userId as string;
    createdIds.push(oldUserId);
    ok(!!token && !!oldUserId, '셋업: 계정 생성 → token+userId');
    const w = await applyWallet(oldUserId, 100, 'ad', PFX + 'led_' + Date.now()); // 보존 대상 원장 1건
    ok(w.ok === true, '셋업: wallet_ledger +100 기록');
    ok((await walletGet(token)).status === 200, '① 기준선: 탈퇴 전 지갑 GET 200(토큰 정상 — 이후 401이 탈퇴 원인임을 증명)');

    console.log('── ① 탈퇴 → 그 토큰 후속 호출(지갑) 401 ──');
    const d1 = await del(token);
    const bD1 = await d1.json();
    ok(d1.status === 200 && bD1.ok === true && bD1.alreadyDeleted === false, '① DELETE /api/account → 200(첫 탈퇴, alreadyDeleted=false)');
    ok((await walletGet(token)).status === 401, '① 탈퇴 후 같은 토큰으로 지갑 GET → 401(세션 무효화)');

    console.log('── ④ 멱등(이중 탈퇴 200) — 재로그인 전(같은 sub 재활성 전) 검증 ──');
    // ※재로그인(②)하면 같은 providerId가 새 라이브 계정으로 부활해 옛 토큰이 그 새 계정을 가리키므로, 멱등은 재가입 전에 확인한다.
    const d2 = await del(token);
    const bD2 = await d2.json();
    ok(d2.status === 200 && bD2.ok === true && bD2.alreadyDeleted === true, '④ 같은(이미 죽은) 토큰 재탈퇴 → 200(alreadyDeleted=true, 멱등)');

    console.log('── ② sub 비복원 파기(재로그인 = 새 userId) ──');
    const liveOld = await findUserRow(pidA, 'dev');
    ok(liveOld === null, '② 원본 providerId로는 라이브 행 매칭 안 됨(providerId 토움스톤화)');
    const tomb = (await db.select({ pid: users.providerId, dn: users.displayName, ac: users.ageConfirmedAt }).from(users).where(eq(users.id, oldUserId)))[0];
    ok(tomb?.pid === `deleted:${oldUserId}`, '② providerId가 deleted:<uuid> 토움스톤으로 덮임(원본 sub 파기)');
    ok(tomb?.dn === null, '② displayName 등 비필수 PII null 파기');
    const rRe = await login({ provider: 'dev', providerId: pidA, ageConfirmed: true }); // 같은 소셜로 재가입
    const bRe = await rRe.json();
    ok(rRe.status === 200 && bRe.userId && bRe.userId !== oldUserId, '② 같은 소셜 재로그인 → 새 userId(옛 계정과 단절)');
    if (bRe.userId) createdIds.push(bRe.userId);

    console.log('── ③ wallet_ledger 행 보존(가명화 — 삭제 아님) ──');
    const led = await db.select({ id: walletLedger.id }).from(walletLedger).where(eq(walletLedger.userId, oldUserId));
    ok(led.length >= 1, '③ 탈퇴 후에도 옛 userId의 wallet_ledger 행 보존(법정 5년·수입 무결)');

    console.log('── ⑤ 무토큰 DELETE 401 ──');
    ok((await del(null)).status === 401, '⑤ 무토큰 DELETE → 401(본인만·익명 폴백 없음)');
    ok((await del('not-a-real-token')).status === 401, '⑤ 위조 토큰 DELETE → 401');
  } finally {
    // 정리 — 생성한 유저의 원장 먼저(FK) → 유저 삭제. 프리픽스 잔여분도 방어적 정리.
    if (createdIds.length) {
      await db.delete(walletLedger).where(inArray(walletLedger.userId, createdIds));
      await db.delete(users).where(inArray(users.id, createdIds));
    }
    await db.delete(users).where(and(eq(users.projCode, PROJ_CODE), like(users.providerId, `${PFX}%`)));
    console.log('  ✓ 정리 완료(_DVACC_ 테스트 계정·원장 삭제)');
  }

  console.log(fail === 0 ? '\n✅ 계정삭제·연령 가드 — 토큰거부·sub파기·원장보존·멱등·무토큰401·연령400/200 전부 통과' : `\n❌ ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
