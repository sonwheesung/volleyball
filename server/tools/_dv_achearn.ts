// 업적/광고 적립 라이브 가드 (BACKEND_SYSTEM §13.12 P0-2·H3) — earn 라우트 핸들러 직접 import·호출, 라이브 dev DB.
// 검증: 정상 earn(applied·잔액+)·멱등 재호출(applied:false)·호출당 클램프(per-claim 1000)·
//       평생합 경계(remaining 클램프 부분지급)·평생합 초과(409 cap·잔액 불변)·A/B 자가검증(백스톱 없으면 통과했을 것).
//       + 광고 쿨다운 서버 백스톱(2026-07-17): 1회 성공→즉시 2회째 409 cooldown · 원장 created_at 2h전 조작→통과(경계) · A/B(쿨다운 게이트 없는 applyWallet 직접은 지급).
// earn 라우트는 requireUserId(무토큰=401 — 구 resolveUserId 폴백 서술은 2026-07-07 통일로 stale, 2026-07-15 정정)라
// **반드시 실 토큰(Bearer)**으로 호출.
// Usage: cd server && npx tsx tools/_dv_achearn.ts (dev는 .env.development.local 우선, 없으면 .env.local — 운영 겨냥 시 DATABASE_URL 오버라이드)
import './_env'; // db 모듈 import 전에 env 주입(호이스팅 순서 — 첫 import)
process.env.SESSION_JWT_SECRET = 'test-session-secret-abcdef0123456789'; // signToken↔verifyToken 일관 — import 전 주입

(async () => {
  const earnRoute = await import('../app/api/wallet/earn/route');
  const { signToken } = await import('../lib/auth');
  const { ensureUser, ensureProj, applyWallet, sumReason, countReasonToday, lastReasonAt } = await import('../lib/wallet');
  const { earnAmount, ACH_LIFETIME_CAP, ACH_MAX_PER_CLAIM, AD_REWARD, AD_DAILY_CAP, AD_COOLDOWN_MS } = await import('../lib/econ');
  const { db } = await import('../db');
  const { walletLedger, users } = await import('../db/schema');
  const { and, eq, sql } = await import('drizzle-orm');
  const { PROJ_CODE } = await import('../lib/proj');

  let fail = 0;
  const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

  const PFX = '_DVACH_';
  const pid = PFX + 'user1';

  const bal = async (uid: string): Promise<number> => { const r = await db.select({ b: users.balance }).from(users).where(eq(users.id, uid)).limit(1); return r.length ? r[0].b : NaN; };
  const hdr = (token: string | null): Record<string, string> => { const h: Record<string, string> = { 'content-type': 'application/json' }; if (token) h.authorization = `Bearer ${token}`; return h; };
  const earn = (body: unknown, token: string) => earnRoute.POST(new Request('http://x/api/wallet/earn', { method: 'POST', headers: hdr(token), body: JSON.stringify(body) }));

  let uid = '';
  try {
    await ensureProj();
    uid = await ensureUser(pid, 'dev');
    const token = signToken(`dev:${pid}`);
    const key = (achId: string) => `ach:${uid}:${achId}`; // walletKeys.achKey와 동일 형식(전역 유일)

    console.log('── ① 정상 earn(achievement, 120) → applied·잔액+120 ──');
    const b0 = await bal(uid);
    const r1 = await earn({ reason: 'achievement', amount: 120, idempotencyKey: key('test1'), ref: 'test1' }, token);
    const r1b = await r1.json();
    ok(r1.status === 200 && r1b.ok === true && r1b.applied === true, '① earn 200·applied true');
    ok((await bal(uid)) === b0 + 120, `① 잔액 +120 [${b0}→${await bal(uid)}]`);

    console.log('── ② 같은 achId 재호출 → applied:false·잔액 불변(멱등) ──');
    const b1 = await bal(uid);
    const r2 = await earn({ reason: 'achievement', amount: 120, idempotencyKey: key('test1'), ref: 'test1' }, token);
    const r2b = await r2.json();
    ok(r2.status === 200 && r2b.ok === true && r2b.applied === false, '② 재호출 → applied false(멱등)');
    ok((await bal(uid)) === b1, '② 잔액 불변');

    console.log('── ③ 클라 99999 → 호출당 1000만 지급(per-claim 클램프) ──');
    const b2 = await bal(uid);
    const r3 = await earn({ reason: 'achievement', amount: 99999, idempotencyKey: key('test2'), ref: 'test2' }, token);
    const r3b = await r3.json();
    ok(r3.status === 200 && r3b.ok === true && r3b.applied === true, '③ earn 200·applied true');
    ok((await bal(uid)) === b2 + ACH_MAX_PER_CLAIM && ACH_MAX_PER_CLAIM === 1000, `③ +1000만(99999 아님) [${b2}→${await bal(uid)}]`);

    console.log('── ④ 평생합 경계: 19,900까지 채운 뒤 500 요청 → remaining 100만 지급 ──');
    // 스캐폴딩: applyWallet 직접(라우트 클램프 우회)으로 achievement 원장 합을 19,900으로 세팅 — 경계 재현.
    const curSum = await sumReason(uid, 'achievement');
    const fillDelta = 19900 - curSum;
    ok(fillDelta > 0, `④ 채울 잔량 계산(현재 합 ${curSum} → 19900, +${fillDelta})`);
    await applyWallet(uid, fillDelta, 'achievement', key('__fill__'), 'fill-to-19900');
    ok((await sumReason(uid, 'achievement')) === 19900, '④ achievement 원장 합 = 19,900(경계 세팅)');
    const b3 = await bal(uid);
    const r4 = await earn({ reason: 'achievement', amount: 500, idempotencyKey: key('boundary'), ref: 'boundary' }, token);
    const r4b = await r4.json();
    ok(r4.status === 200 && r4b.ok === true && r4b.applied === true, '④ earn 200·applied true(경계 통과)');
    ok((await bal(uid)) === b3 + 100, `④ +100만 지급(500 아님 — remaining=${ACH_LIFETIME_CAP}-19900=100 클램프) [${b3}→${await bal(uid)}]`);
    ok((await sumReason(uid, 'achievement')) === ACH_LIFETIME_CAP, `④ 원장 합 = 캡(${ACH_LIFETIME_CAP})`);

    console.log('── ⑤ 그 후 추가 요청 → 409 cap·잔액 불변 ──');
    const b4 = await bal(uid);
    const r5 = await earn({ reason: 'achievement', amount: 50, idempotencyKey: key('over'), ref: 'over' }, token);
    const r5b = await r5.json();
    ok(r5.status === 409 && r5b.ok === false && r5b.reason === 'cap', '⑤ 초과 요청 → 409 cap');
    ok((await bal(uid)) === b4, '⑤ 잔액 불변(캡 초과 미지급)');

    console.log('── ⑥ A/B 자가검증: 평생합 백스톱 없으면 ⑤가 통과했을 것(오라클 이빨) ──');
    // 대조군: 라우트의 sumReason 평생합 체크를 뺀 계산(per-claim만) — earnAmount>0이라 지급됐을 것.
    const wouldGrant = earnAmount('achievement', 50); // 50 — 호출당 클램프만으론 양수 통과
    ok(wouldGrant === 50, '⑥-AB[A] 백스톱 없으면(per-claim만) 50 지급됐을 것(대조군 — 버그 재현 경로)');
    ok(r5.status === 409 && r5b.reason === 'cap', '⑥-AB[B] 실제 라우트는 평생합 백스톱으로 409 cap(=오라클 민감·허위 아님)');

    // ── 광고 쿨다운 서버 백스톱(§13.12, 2026-07-17) — 이 유저는 아직 'ad' 원장 0건이라 첫 광고는 통과 ──
    const adKey = (n: number) => `ad:${uid}:test:${n}`;
    console.log('── ⑦ 광고 1회 성공 → 즉시 2회째 409 cooldown(하루상한 미도달인데도 차단) ──');
    const a0 = await bal(uid);
    const ra1 = await earn({ reason: 'ad', amount: 50, idempotencyKey: adKey(1), ref: 'ad1' }, token);
    const ra1b = await ra1.json();
    ok(ra1.status === 200 && ra1b.ok === true && ra1b.applied === true, '⑦ 첫 광고 earn 200·applied true');
    ok((await bal(uid)) === a0 + AD_REWARD, `⑦ 잔액 +${AD_REWARD} [${a0}→${await bal(uid)}]`);
    const ra2 = await earn({ reason: 'ad', amount: 50, idempotencyKey: adKey(2), ref: 'ad2' }, token);
    const ra2b = await ra2.json();
    ok(ra2.status === 409 && ra2b.ok === false && ra2b.reason === 'cooldown', '⑦ 즉시 2회째 → 409 cooldown(cap 아님)');
    ok((await bal(uid)) === a0 + AD_REWARD, '⑦ 쿨다운 거부 → 잔액 불변(미지급)');

    console.log('── ⑧ A/B 자가검증: 쿨다운 게이트 없는 경로(applyWallet 직접)는 같은 순간에도 지급 ──');
    // 대조군 = 라우트의 쿨다운 게이트를 통째로 뺀 경로. applyWallet은 쿨다운 무검사 → 새 키면 즉시 지급.
    // ⑦ 2회째는 하루 상한(count<8)·금액(>0) 모두 통과 상태였으므로 유일한 차단자가 쿨다운임을 실측으로 못박음.
    const cntBefore = await countReasonToday(uid, 'ad');
    ok(cntBefore < AD_DAILY_CAP, `⑧-AB[A0] 하루 상한 미도달(count ${cntBefore}<${AD_DAILY_CAP}) — cap이 차단자 아님`);
    const a1 = await bal(uid);
    const direct = await applyWallet(uid, AD_REWARD, 'ad', adKey(90), 'ab-nocooldown');
    ok(direct.ok && direct.applied === true, '⑧-AB[A] 쿨다운 게이트 없으면(applyWallet 직접) 즉시 지급됨(대조군)');
    ok((await bal(uid)) === a1 + AD_REWARD, `⑧-AB[A] 대조군 잔액 +${AD_REWARD} [${a1}→${await bal(uid)}]`);
    ok(ra2.status === 409 && ra2b.reason === 'cooldown', '⑧-AB[B] 실제 라우트는 쿨다운 백스톱으로 409 cooldown(=오라클 민감·허위 아님)');

    console.log('── ⑨ 경계: 최근 ad 원장 created_at을 3시간 전으로 조작 → lastReasonAt>2h → 재시도 성공 ──');
    await db.update(walletLedger)
      .set({ createdAt: sql`now() - interval '3 hours'` })
      .where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.userId, uid), eq(walletLedger.reason, 'ad')));
    const lastAt = await lastReasonAt(uid, 'ad');
    ok(lastAt !== null && Date.now() - lastAt >= AD_COOLDOWN_MS, `⑨ lastReasonAt 쿨다운 초과(경계) [${lastAt !== null ? Math.round((Date.now() - lastAt) / 60000) : 'null'}분 전 ≥ ${AD_COOLDOWN_MS / 60000}분]`);
    const a2 = await bal(uid);
    const ra3 = await earn({ reason: 'ad', amount: 50, idempotencyKey: adKey(3), ref: 'ad3' }, token);
    const ra3b = await ra3.json();
    ok(ra3.status === 200 && ra3b.ok === true && ra3b.applied === true, '⑨ 쿨다운 만료 후 재시도 → 200 applied');
    ok((await bal(uid)) === a2 + AD_REWARD, `⑨ 잔액 +${AD_REWARD}(경계 통과) [${a2}→${await bal(uid)}]`);
  } finally {
    // 정리 — 테스트 유저 원장·유저 삭제(공유 DB 오염 방지, FK 순서: ledger→user)
    if (uid) await db.delete(walletLedger).where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.userId, uid)));
    if (uid) await db.delete(users).where(eq(users.id, uid));
    console.log('  ✓ 정리 완료(_DVACH_ 테스트 유저·원장 삭제)');
  }

  console.log(fail === 0 ? '\n✅ 업적/광고 적립 라이브 가드 — 정상·멱등·per-claim·평생합 경계·409 cap·광고 쿨다운(409 cooldown·경계·A/B) 전부 통과' : `\n❌ ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
