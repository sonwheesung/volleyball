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

  const pass =
    ok === K && // 정확히 K건만 성공
    u.balance === 0 && // 잔액 0
    u.balance >= 0 && // 음수 아님(초과지출 없음)
    ledgerSum === u.balance && // 불변식: balance == 원장합
    errors === 0; // 잠금 경합이 error로 새지 않음
  console.log(pass ? '\n✅ H2 PASS — 동시 이중지불 없음(정확히 K 성공·음수 0·원장==잔액)' : '\n❌ H2 FAIL');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
