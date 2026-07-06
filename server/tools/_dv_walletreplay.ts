// 지갑 멱등 재시도 잔액 회귀 (BACKEND_SYSTEM §13 · 에뮬 재현 2026-07-06) — 라이브 dev DB.
// 버그: applyWalletTx 멱등 재시도가 원장의 그때 balanceAfter(스냅샷)를 반환 → 원 거래 이후의 지출이
//   반영 안 된 stale 잔액으로 클라를 덮어씀(환영 +1000 → 캠프 −900 = 100인데 화면 재진입 시 1000 표시).
// 수정: 멱등 재시도 시 현재 users.balance를 반환. 이 테스트가 A/B로 오라클 민감도 증명(원장 balanceAfter=1000 vs 현재 100).
// 실행: server 디렉터리에서 `node_modules/.bin/tsx tools/_dv_walletreplay.ts`. 던지기 유저 생성→검증→정리(finally).
import { readFileSync } from 'fs';
import { join } from 'path';

// server/.env.local 의 DATABASE_URL 주입 (db 모듈 import 전에)
try {
  const envPath = join(__dirname, '..', '.env.local');
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* env 없으면 db 기본값(localhost) — 연결 실패 시 ERROR로 드러남 */ }

async function main(): Promise<number> {
  const { db, schema } = await import('../db');
  const { applyWallet } = await import('../lib/wallet');
  const { PROJ_CODE } = await import('../lib/proj');
  const { eq, and } = await import('drizzle-orm');
  const { users, walletLedger } = schema;

  let fail = 0;
  const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

  const PID = '_dv_walletreplay_probe';
  const WKEY = `welcome:${PID}`;
  const CKEY = `camp:${PID}:1`;

  const cleanup = async (uid?: string) => {
    if (uid) await db.delete(walletLedger).where(eq(walletLedger.userId, uid));
    await db.delete(users).where(and(eq(users.projCode, PROJ_CODE), eq(users.provider, 'dev'), eq(users.providerId, PID)));
  };

  let userId = '';
  try {
    // 0) 이전 흔적 제거 후 새 던지기 유저
    const prior = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.projCode, PROJ_CODE), eq(users.provider, 'dev'), eq(users.providerId, PID))).limit(1);
    await cleanup(prior[0]?.id);
    const ins = await db.insert(users).values({ projCode: PROJ_CODE, provider: 'dev', providerId: PID, balance: 0 }).returning({ id: users.id });
    userId = ins[0].id;

    console.log('── 1. 환영 +1000 → 잔액 1000 ──');
    const g = await applyWallet(userId, 1000, 'welcome', WKEY);
    ok(g.ok && g.balance === 1000 && g.applied === true, `환영 첫 지급 ok/1000/applied (실측 ${JSON.stringify(g)})`);

    console.log('── 2. 캠프 −900 → 잔액 100 ──');
    const s = await applyWallet(userId, -900, 'camp', CKEY);
    ok(s.ok && s.balance === 100 && s.applied === true, `캠프 지출 ok/100/applied (실측 ${JSON.stringify(s)})`);

    console.log('── 3. 환영 키 재시도(멱등) → 현재 잔액 100 반환(재적용 X) [수정 검증] ──');
    const r = await applyWallet(userId, 1000, 'welcome', WKEY);
    ok(r.ok && r.applied === false, `재시도는 재적용 안 함(applied=false) (실측 ${JSON.stringify(r)})`);
    ok(r.ok && r.balance === 100, `재시도 잔액 = 현재 100 (버그면 1000) — 실측 ${r.ok ? r.balance : 'n/a'}`);

    console.log('── 4. A/B 대조군: 원장 balanceAfter=1000(스냅샷) — 옛 코드면 이 값을 반환해 버그 ──');
    const led = await db.select({ ba: walletLedger.balanceAfter }).from(walletLedger)
      .where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.idempotencyKey, WKEY))).limit(1);
    ok(led.length === 1 && led[0].ba === 1000, `환영 원장 balanceAfter=1000(옛 반환값) vs 수정본 반환 100 → 오라클 민감도 (실측 ${led[0]?.ba})`);

    console.log('── 5. 불변식: users.balance == 100 ──');
    const u = await db.select({ b: users.balance }).from(users).where(eq(users.id, userId)).limit(1);
    ok(u[0]?.b === 100, `최종 users.balance=100 (실측 ${u[0]?.b})`);
  } finally {
    await cleanup(userId);
    console.log('  · 정리 완료(던지기 유저·원장 삭제)');
  }

  console.log(fail === 0 ? '\n✅ PASS _dv_walletreplay (멱등 재시도 현재잔액 반환)' : `\n❌ FAIL ${fail}건`);
  return fail;
}

main().then((f) => process.exit(f === 0 ? 0 : 1)).catch((e) => { console.error('ERROR', e); process.exit(2); });
