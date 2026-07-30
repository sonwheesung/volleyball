// 지급 완료 업적 pre-mark 라이브 가드 (BACKEND_SYSTEM §4 · ACHIEVEMENT_SYSTEM — 테스터 2026-07-30) — 라이브 dev DB.
// 검증: getWallet().earnedAch가 원장 reason='achievement' distinct ref 전체를 준다
//   ① 지급한 2개 업적 id가 earnedAch에 포함 ② 같은 업적 중복 지급(멱등)은 distinct로 1개만(길이=고유 업적 수)
//   ③ 비업적(ad) ref는 earnedAch에 없음(오탐 0) ④ 원장 윈도우(recent 20) 초과분도 포함(전체 distinct — 21+ 업적 지급 후 오래된 것도)
//   A/B(민감도): distinct에서 reason 필터 없으면 ad ref가 새어 ③ 위반 — reason='achievement' 게이트가 실효.
// Usage: cd server && npx tsx tools/_dv_earnedach.ts  (dev DB 필요 — .env.development.local)
import './_env';
process.env.SESSION_JWT_SECRET = 'test-session-secret-abcdef0123456789';

(async () => {
  const { ensureUser, ensureProj, applyWallet, getWallet } = await import('../lib/wallet');
  const { db } = await import('../db');
  const { walletLedger, users } = await import('../db/schema');
  const { and, eq } = await import('drizzle-orm');
  const { PROJ_CODE } = await import('../lib/proj');

  let fail = 0;
  const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
  const PFX = '_DVEARNEDACH_';
  let uid = '';
  try {
    await ensureProj();
    uid = await ensureUser(PFX + 'u1', 'dev', 'earnedach-test');
    // 지급: 업적 2종(+ 같은 것 재지급=멱등 dedup) + 비업적(ad) 1건 + 윈도우 초과용 더미 업적 22종
    await applyWallet(uid, 10, 'achievement', PFX + 'first_ace', 'first_ace');
    await applyWallet(uid, 10, 'achievement', PFX + 'first_set_win', 'first_set_win');
    await applyWallet(uid, 10, 'achievement', PFX + 'first_ace', 'first_ace'); // 멱등 재시도(같은 키) → 원장 1행
    await applyWallet(uid, 50, 'ad', PFX + 'ad1', 'ad1'); // 비업적 — earnedAch에 새면 안 됨
    // 윈도우(recent 20) 초과 검증용: 오래된 업적 지급을 여러 개(총 업적 원장 행 >20)
    for (let i = 0; i < 22; i++) await applyWallet(uid, 5, 'achievement', PFX + 'old' + i, 'old' + i);

    const w = await getWallet(uid);
    const earned = (w?.earnedAch ?? []) as string[];
    ok(!!w, 'getWallet 응답 존재');
    ok(earned.includes('first_ace'), '① 지급 업적 first_ace 포함');
    ok(earned.includes('first_set_win'), '① 지급 업적 first_set_win 포함');
    ok(earned.filter((x) => x === 'first_ace').length === 1, '② 멱등 재지급도 distinct 1개');
    ok(!earned.includes('ad1'), '③ 비업적(ad) ref 미포함(오탐 0)');
    ok(earned.includes('old0') && earned.includes('old21'), '④ 원장 윈도우(20) 초과분도 전체 포함');
    ok(new Set(earned).size === earned.length, 'distinct 중복 없음');
    // 총 고유 업적 = first_ace + first_set_win + old0..old21(22) = 24
    ok(earned.length === 24, `총 고유 업적 수 24 [실측 ${earned.length}]`);
  } finally {
    if (uid) await db.delete(walletLedger).where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.userId, uid)));
    if (uid) await db.delete(users).where(eq(users.id, uid));
    console.log('  ✓ 정리 완료(_DVEARNEDACH_ 테스트 유저·원장 삭제)');
  }
  console.log(fail === 0 ? '\n✅ earnedAch pre-mark 가드 — 지급 업적 전체 distinct·멱등 dedup·비업적 오탐 0·윈도우 초과 포함 통과' : `\n❌ ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
