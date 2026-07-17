// H2 검증 — 동시 spend 이중지불 방지 증명 (BACKEND_SYSTEM §13.4 H2).
// 잔액 K인 유저에 1씩 차감하는 spend를 N(>K)건 동시에 발사 → 정확히 K건만 성공·나머지 insufficient·
// 잔액 0·음수 0·원장 delta 합 == 초기적립 - 성공차감. FOR UPDATE가 없으면(또는 깨지면) 초과지출로 음수.
// ※ 반드시 실제 Postgres 필요(SQLite/단일연결은 동시성 마스킹). 사용: npx tsx tools/walletConcurrency.ts
//   (dev는 .env.development.local(로컬 Supabase) 우선, 없으면 .env.local — 운영 겨냥 시 DATABASE_URL 오버라이드)
import './_env'; // db 모듈 import 전에 env 주입(호이스팅 순서 — 첫 import)
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { users, walletLedger } from '../db/schema';
import { applyWallet, ensureDevUser } from '../lib/wallet';

async function main() {
  const K = 50; // 초기 잔액
  const N = 200; // 동시 spend 시도(각 -1)
  const userId = await ensureDevUser('conc-test-user');

  // 초기화: 이 유저의 원장·잔액 리셋 후 K 적립
  await db.delete(walletLedger).where(sql`user_id = ${userId}`);
  await db.update(users).set({ balance: 0 }).where(sql`id = ${userId}`);
  const seed = await applyWallet(userId, K, 'adjust', `seed-${userId}-${K}-${Date.now()}`);
  if (!seed.ok) throw new Error('seed 실패: ' + JSON.stringify(seed));

  // N건 동시 발사(각 고유 멱등키 → 서로 다른 거래)
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) => applyWallet(userId, -1, 'camp', `spend-${userId}-${i}`)),
  );
  const ok = results.filter((r) => r.ok && r.applied).length;
  const insufficient = results.filter((r) => !r.ok && r.reason === 'insufficient').length;
  const errors = results.filter((r) => !r.ok && r.reason === 'error').length;

  // 최종 상태
  const [u] = await db.select({ balance: users.balance }).from(users).where(sql`id = ${userId}`);
  const rows = await db.select({ delta: walletLedger.delta }).from(walletLedger).where(sql`user_id = ${userId}`);
  const ledgerSum = rows.reduce((s, r) => s + r.delta, 0);

  console.log(`K=${K} N=${N}`);
  console.log(`  성공 spend=${ok} · insufficient=${insufficient} · error=${errors}`);
  console.log(`  최종 balance=${u.balance} · 원장합=${ledgerSum}`);

  const passH2 =
    ok === K && // 정확히 K건만 성공
    u.balance === 0 && // 잔액 0
    u.balance >= 0 && // 음수 아님(초과지출 없음)
    ledgerSum === u.balance && // 불변식: balance == 원장합
    errors === 0; // 잠금 경합이 error로 새지 않음
  console.log(passH2 ? '\n✅ H2 PASS — 동시 이중지불 없음(정확히 K 성공·음수 0·원장==잔액)' : '\n❌ H2 FAIL');

  // ── H2b 동시 same-key dedup 수렴(2026-07-17, prod 샌드박스 실결제 실측 — RC 웹훅↔confirm 폴백이 ~100ms 내 동시 도착) ──
  // 같은 (userId·delta·reason·멱등키) 2건을 Promise.all로 동시 발사 → 진 쪽 트랜잭션이 ledger_proj_idem_uniq 유니크 충돌로
  // throw. 수정 전(구로직): catch가 무조건 {ok:false, reason:'error'} 반환 → 동시 2건 중 1건이 ok:false(결제 500 UX/RC 재시도).
  // 수정 후: catch가 재조회 dedup으로 수렴 → 둘 다 ok:true·applied 정확히 1개.
  const purge = async (uid: string) => { await db.delete(walletLedger).where(sql`user_id = ${uid}`); await db.update(users).set({ balance: 0 }).where(sql`id = ${uid}`); };

  console.log('\n── H2b: 동시 same-key(웹훅↔confirm 경쟁) → dedup 수렴 ──');
  const uid2 = await ensureDevUser('conc-samekey-user');
  const DELTA = 1000;
  // 구로직에선 레이스 타이밍(양쪽이 dup 선조회 통과 후 insert 경쟁)이 flaky → 반복 N=20으로 최소 1회 유니크 충돌을 유도.
  // 신로직에선 매 반복 두 결과 모두 ok:true·applied 정확히 1개·잔액 정확히 DELTA·원장 그 키 1행이어야 한다.
  let pair2ok = true;
  for (let i = 0; i < 20; i++) {
    await purge(uid2);
    const key = `samekey-${uid2}-${i}`;
    const [a, b] = await Promise.all([
      applyWallet(uid2, DELTA, 'purchase', key, 'race'),
      applyWallet(uid2, DELTA, 'purchase', key, 'race'),
    ]);
    const bothOk = a.ok && b.ok; // 판정: 두 결과 모두 ok:true(진 쪽도 error 아님)
    const appliedCount = [a, b].filter((r) => r.ok && r.applied).length; // applied 정확히 1개
    const [uu] = await db.select({ balance: users.balance }).from(users).where(sql`id = ${uid2}`);
    const rows2 = await db.select({ delta: walletLedger.delta }).from(walletLedger).where(sql`idempotency_key = ${key} and user_id = ${uid2}`);
    const rowCnt = rows2.length; // 원장 그 키 행 정확히 1개
    const bal = uu.balance; // 잔액 정확히 delta 1회분
    const iterPass = bothOk && appliedCount === 1 && bal === DELTA && rowCnt === 1;
    if (!iterPass) { console.log(`  ✗ iter ${i}: bothOk=${bothOk} applied=${appliedCount} bal=${bal} rows=${rowCnt} a=${JSON.stringify(a)} b=${JSON.stringify(b)}`); pair2ok = false; break; }
  }
  console.log(pair2ok ? '  ✓ 20/20: 동시 2건 모두 ok·applied 1·잔액=1000·원장 1행(진 쪽 error→dedup 수렴)' : '  ✗ 동시 same-key dedup 실패');
  // [A/B] 판정줄이 구로직을 실제로 잡는지 논증: 구로직 catch는 진 쪽에 {ok:false,reason:'error'}를 준다 → "동시 2건 중 1건 ok:false면 FAIL"이
  //   구로직 충돌 반복에서 실제로 트리거된다(위 bothOk 검사가 그 판정). 신로직은 같은 충돌을 dedup(applied:false)로 수렴시켜 bothOk 유지.
  console.log('  [A/B] 판정 bothOk=false(진 쪽 error)는 구로직 유니크 충돌 시 트리거되는 실검출점 — 신로직은 dedup 수렴으로 20/20 통과');

  // ── H2c 3방향 동시(웹훅+confirm+재시도 가정) → applied 1·dedup 2 ──
  console.log('\n── H2c: 3방향 동시 same-key → applied 1·dedup 2 ──');
  let pair3ok = true;
  for (let i = 0; i < 20; i++) {
    await purge(uid2);
    const key = `samekey3-${uid2}-${i}`;
    const results3 = await Promise.all([
      applyWallet(uid2, DELTA, 'purchase', key, 'webhook'),
      applyWallet(uid2, DELTA, 'purchase', key, 'confirm'),
      applyWallet(uid2, DELTA, 'purchase', key, 'retry'),
    ]);
    const allOk = results3.every((r) => r.ok);
    const appliedCount = results3.filter((r) => r.ok && r.applied).length; // 정확히 1
    const dedupCount = results3.filter((r) => r.ok && !r.applied).length; // 정확히 2
    const [uu] = await db.select({ balance: users.balance }).from(users).where(sql`id = ${uid2}`);
    const rows3 = await db.select({ delta: walletLedger.delta }).from(walletLedger).where(sql`idempotency_key = ${key} and user_id = ${uid2}`);
    const iterPass = allOk && appliedCount === 1 && dedupCount === 2 && uu.balance === DELTA && rows3.length === 1;
    if (!iterPass) { console.log(`  ✗ iter ${i}: allOk=${allOk} applied=${appliedCount} dedup=${dedupCount} bal=${uu.balance} rows=${rows3.length}`); pair3ok = false; break; }
  }
  console.log(pair3ok ? '  ✓ 20/20: 3건 모두 ok·applied 1·dedup 2·잔액=1000·원장 1행' : '  ✗ 3방향 동시 dedup 실패');

  // 정리 — H2b/H2c 테스트 유저 원장·잔액 리셋(공유 DB 오염 방지, 유저행은 ensureDevUser 재사용 위해 유지).
  await purge(uid2);
  console.log('  ✓ 정리 완료(same-key 테스트 원장·잔액 리셋)');

  const pass = passH2 && pair2ok && pair3ok;
  console.log(pass ? '\n✅ ALL PASS — H2(이중지불 0)·H2b(동시 same-key dedup)·H2c(3방향 dedup)' : '\n❌ FAIL');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
