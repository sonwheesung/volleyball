// 신규 가입 디스코드 알림 가드 (BACKEND_SYSTEM §13.28) — 2티어.
//
//  ① 순수 티어(DB 불요): `lib/notify.ts` notifySignup 계약 — env 미설정 no-op · 폴백 체인 · 전용채널 우선 ·
//     임베드 내용(프로바이더/기기/누적수/마스킹/proj/시각) · **PII 부재**(providerId·userId 원문·displayName·이메일) ·
//     전송 실패(reject)·행(4초 타임아웃)에도 **throw 없음**.
//  ② 라이브 티어(dev DB): `/api/auth/login` 라우트를 직접 호출 — **신규 가입 = 정확히 1발**, **재로그인 = 0발**,
//     디스코드 500/reject여도 **로그인 200**(가입 비차단), `countSignups` 누적 +1 및 **ensureUser 행 미포함**(실가입만 셈).
//
// A/B 자가검증(허위 오라클 금지): "재로그인 0발" 오라클이 진짜 민감한지 증명하기 위해, **잘못된 부착 지점**
//   (ensureUser=저수준 upsert 자리에 알림을 붙인 변이)을 하니스 안에서 재현해 **같은 오라클이 1발을 보고 FAIL로 뒤집히는지**
//   확인한다. 즉 "항상 0이라 통과"가 아님을 가드 자신이 증명한다. 프로덕션 코드엔 테스트 시임 0.
//
// 정리: **이 실행이 만든 유저 id만** 삭제(프리픽스 일괄 삭제 금지 — 병렬 세션 데이터 유실 방지).
// Usage:
//   cd server && DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" npx tsx tools/_dv_signup_notify.ts
//   (DB 없이 순수 티어만: DV_PURE_ONLY=1 npx tsx tools/_dv_signup_notify.ts)
import './_env'; // db 모듈 import 전에 env 주입(호이스팅 순서 — 첫 import)
process.env.SESSION_JWT_SECRET = 'test-session-secret-abcdef0123456789';
delete process.env.VERCEL_ENV; // dev provider 허용(프로덕션 게이트 회피 — 로컬 가드)
// 디스코드 env는 케이스마다 직접 세팅/해제한다(notify는 **호출 시점** env를 읽으므로 import 순서 무관).
delete process.env.DISCORD_WEBHOOK_URL;
delete process.env.DISCORD_SIGNUP_WEBHOOK_URL;

type Fired = { url: string; body: Record<string, unknown>; raw: string };

(async () => {
  let fail = 0;
  const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

  // ── fetch 스텁: 디스코드 발사만 캡처(DB는 TCP postgres-js라 fetch 미사용, 구글검증은 provider=dev라 미호출) ──
  const fired: Fired[] = [];
  let mode: 'ok' | 'reject' | 'http500' | 'hang' = 'ok';
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { body?: string; signal?: AbortSignal }) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? '');
    const raw = String(init?.body ?? '');
    fired.push({ url, raw, body: JSON.parse(raw || '{}') as Record<string, unknown> });
    if (mode === 'reject') throw new Error('discord down (stub)');
    if (mode === 'http500') return { ok: false, status: 500 } as unknown as Response;
    if (mode === 'hang') {
      // 응답 없음 → postDiscord의 4초 AbortController가 끊어야 한다(끊기면 abort로 reject).
      return await new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new Error('aborted')));
      });
    }
    return { ok: true, status: 204 } as unknown as Response;
  }) as unknown as typeof fetch;

  const reset = () => { fired.length = 0; mode = 'ok'; };
  const embedOf = (f: Fired) => (f.body.embeds as Array<Record<string, unknown>>)[0];
  const fieldsOf = (f: Fired) => (embedOf(f).fields as Array<{ name: string; value: string }>);
  const fieldVal = (f: Fired, name: string) => fieldsOf(f).find((x) => x.name === name)?.value ?? '';
  /** afterSafe는 응답 후 비동기 실행 → 최대 ms까지 폴링해 발사 수렴을 기다린다. */
  const waitFires = async (want: number, ms = 3000): Promise<number> => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (fired.length >= want) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    await new Promise((r) => setTimeout(r, 150)); // 초과 발사(중복)도 잡히도록 여유
    return fired.length;
  };

  const SIGNUP_URL = 'https://discord.test/webhooks/SIGNUP';
  const PAY_URL = 'https://discord.test/webhooks/PAY';

  // ═══════════════ ① 순수 티어 (DB 불요) ═══════════════
  console.log('\n[A] 순수 — notifySignup 계약(§13.28)');
  const { notifySignup } = await import('../lib/notify');
  const { PROJ_CODE } = await import('../lib/proj');
  const FAKE_UID = '11112222-3333-4444-5555-666677778888';
  const base = { userId: FAKE_UID, provider: 'google', platform: 'android', appVersion: '1.4.2', totalSignups: 137, projCode: PROJ_CODE };

  // A1 — env 둘 다 미설정 = 완전 no-op
  reset();
  await notifySignup(base);
  ok(fired.length === 0, `A1 env 미설정 → 발사 0 (실측 ${fired.length})`);

  // A2 — 일반 채널만 있으면 그리로 폴백
  reset();
  process.env.DISCORD_WEBHOOK_URL = PAY_URL;
  await notifySignup(base);
  ok(fired.length === 1 && fired[0].url === PAY_URL, `A2 DISCORD_WEBHOOK_URL 폴백 1발 (실측 ${fired.length}발 → ${fired[0]?.url ?? '-'})`);

  // A3 — 전용 채널이 있으면 우선(notifyTicket 폴백 체인과 동형)
  reset();
  process.env.DISCORD_SIGNUP_WEBHOOK_URL = SIGNUP_URL;
  await notifySignup(base);
  ok(fired.length === 1 && fired[0].url === SIGNUP_URL, `A3 DISCORD_SIGNUP_WEBHOOK_URL 우선 (실측 ${fired[0]?.url ?? '-'})`);

  // A4 — 임베드 내용(요구 정보가 실제로 담기는가)
  {
    const f = fired[0];
    const e = embedOf(f);
    ok(String(e.title ?? '').includes('신규 가입'), 'A4a 제목=신규 가입');
    ok(fieldVal(f, '가입 경로').includes('Google'), `A4b 프로바이더 표기 (실측 "${fieldVal(f, '가입 경로')}")`);
    ok(fieldVal(f, '기기') === 'android · v1.4.2', `A4c 플랫폼·앱버전 (실측 "${fieldVal(f, '기기')}")`);
    ok(fieldVal(f, '누적 가입') === '137번째', `A4d 누적 가입자 수 (실측 "${fieldVal(f, '누적 가입')}")`);
    ok(fieldVal(f, '유저') === '…' + FAKE_UID.slice(-6), `A4e 유저 축약(뒤 6자, maskUser 규약) (실측 "${fieldVal(f, '유저')}")`);
    ok(String((e.footer as { text?: string })?.text ?? '').includes(PROJ_CODE), `A4f footer proj 표기 (실측 "${(e.footer as { text?: string })?.text}")`);
    const ts = Date.parse(String(e.timestamp ?? ''));
    ok(Number.isFinite(ts) && Math.abs(Date.now() - ts) < 60_000, 'A4g 가입 시각(timestamp) 현재 시각');
  }

  // A5 — PII 부재(§13.9): userId 원문·displayName·이메일 키가 페이로드에 없어야
  {
    const raw = fired[0].raw;
    ok(!raw.includes(FAKE_UID), 'A5a userId 원문 미전송(마스킹만)');
    ok(!/displayName/i.test(raw), 'A5b displayName 키 미전송');
    ok(!raw.includes('@'), 'A5c 이메일 형태 문자열 없음');
    const names = fieldsOf(fired[0]).map((x) => x.name).sort().join('|');
    ok(names === ['가입 경로', '기기', '누적 가입', '유저'].sort().join('|'), `A5d 필드 화이트리스트 고정 (실측 ${names})`);
  }

  // A6 — 누적 카운트 조회 실패(null)여도 알림은 그대로 나가고 '—' 표기
  reset();
  await notifySignup({ ...base, totalSignups: null });
  ok(fired.length === 1 && fieldVal(fired[0], '누적 가입') === '—', `A6 누적수 null → '—'로 정상 발사 (실측 "${fieldVal(fired[0], '누적 가입')}")`);

  // A7 — 전송 실패(reject) throw-none
  reset(); mode = 'reject';
  let threw = false;
  try { await notifySignup(base); } catch { threw = true; }
  ok(!threw, 'A7 디스코드 reject → notifySignup throw 없음');

  // A8 — 응답 행(hang) → 4초 타임아웃 후에도 throw 없음(가입 경로 무한대기 방지)
  reset(); mode = 'hang';
  const t0 = Date.now(); threw = false;
  try { await notifySignup(base); } catch { threw = true; }
  const el = Date.now() - t0;
  ok(!threw && el < 8000, `A8 디스코드 행 → ${el}ms만에 복귀·throw 없음(4초 abort)`);
  reset();

  // ═══════════════ ② 라이브 티어 (dev DB) ═══════════════
  if (process.env.DV_PURE_ONLY === '1') {
    console.log('\n[B] 라이브 — DV_PURE_ONLY=1 → 건너뜀(순수 티어만 검증됨)');
    globalThis.fetch = realFetch;
    console.log(fail === 0 ? `\nPASS _dv_signup_notify (순수 티어 only) — 0 FAIL` : `\nFAIL _dv_signup_notify — ${fail}건`);
    process.exit(fail === 0 ? 0 : 1);
  }

  console.log('\n[B] 라이브 — /api/auth/login 신규/재로그인 발화(§13.28)');
  const loginRoute = await import('../app/api/auth/login/route');
  const { db } = await import('../db');
  const { users } = await import('../db/schema');
  const { eq, inArray } = await import('drizzle-orm');
  const { countSignups, ensureUser, ensureProj } = await import('../lib/wallet');

  const PFX = `_DV_SIGNUP_${Date.now()}_`;
  const madeUsers: string[] = [];
  const login = (providerId: string, extra: Record<string, unknown> = {}) =>
    loginRoute.POST(new Request('http://x/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'dev', providerId, device: { platform: 'android', osVersion: '14', appVersion: '1.4.2' }, ...extra }),
    }));

  try {
    await ensureProj();
    process.env.DISCORD_SIGNUP_WEBHOOK_URL = SIGNUP_URL;

    // B1 — 신규 가입 = 정확히 1발
    const pidA = PFX + 'A';
    const before = await countSignups();
    reset();
    const r1 = await login(pidA, { ageConfirmed: true });
    const j1 = (await r1.json()) as { ok: boolean; userId?: string };
    if (j1.userId) madeUsers.push(j1.userId);
    const n1 = await waitFires(1);
    ok(r1.status === 200 && j1.ok === true, `B1a 신규 로그인 200 ok (실측 ${r1.status})`);
    ok(n1 === 1, `B1b 신규 가입 = 정확히 1발 (실측 ${n1}발)`);
    ok(n1 === 1 && fired[0].url === SIGNUP_URL, 'B1c 가입 전용 채널로 발사');
    ok(n1 === 1 && !fired[0].raw.includes(pidA), 'B1d providerId(구글 sub 자리) 미전송');
    ok(n1 === 1 && !!j1.userId && !fired[0].raw.includes(j1.userId), 'B1e userId 원문 미전송');
    ok(n1 === 1 && fieldVal(fired[0], '기기') === 'android · v1.4.2', `B1f 기기·버전 실제 body 반영 (실측 "${n1 === 1 ? fieldVal(fired[0], '기기') : '-'}")`);

    // B2 — 같은 계정 재로그인 = 0발 (★ 핵심 오라클)
    reset();
    const r2 = await login(pidA); // ageConfirmed 없이도 기존 계정이라 통과해야 함
    const j2 = (await r2.json()) as { ok: boolean; userId?: string };
    const n2 = await waitFires(1); // 1발이 오면 잡히도록 같은 대기창
    ok(r2.status === 200 && j2.ok === true && j2.userId === j1.userId, `B2a 재로그인 200·같은 userId (실측 ${r2.status})`);
    ok(n2 === 0, `B2b 재로그인 = 발사 0 (실측 ${n2}발)`);

    // B3 — countSignups: 신규 +1, 재로그인 +0, ensureUser(저수준 upsert) 행은 미포함(실가입만)
    const afterSignup = await countSignups();
    ok(before != null && afterSignup === (before as number) + 1, `B3a 신규 1건 → 누적 +1 (${before} → ${afterSignup})`);
    const uidEnsure = await ensureUser(PFX + 'ENSURE', 'dev');
    madeUsers.push(uidEnsure);
    const afterEnsure = await countSignups();
    ok(afterEnsure === afterSignup, `B3b ensureUser 행은 누적에 미포함(ageConfirmedAt null) (${afterSignup} → ${afterEnsure})`);

    // B4 — 디스코드가 죽어도(reject) 가입은 성공해야 한다 (최중요 제약)
    const pidB = PFX + 'B';
    reset(); mode = 'reject';
    const r4 = await login(pidB, { ageConfirmed: true });
    const j4 = (await r4.json()) as { ok: boolean; userId?: string };
    if (j4.userId) madeUsers.push(j4.userId);
    await waitFires(1);
    const rowB = j4.userId ? await db.select({ id: users.id }).from(users).where(eq(users.id, j4.userId)).limit(1) : [];
    ok(r4.status === 200 && j4.ok === true, `B4a 디스코드 reject여도 로그인 200 (실측 ${r4.status})`);
    ok(rowB.length === 1, 'B4b 유저 행 실제 생성(알림 실패가 가입을 막지 않음)');

    // B5 — 디스코드 행(hang, 4초 타임아웃)에도 로그인 응답은 즉시(afterSafe = 응답 후 실행)
    const pidC = PFX + 'C';
    reset(); mode = 'hang';
    const tB = Date.now();
    const r5 = await login(pidC, { ageConfirmed: true });
    const elB = Date.now() - tB;
    const j5 = (await r5.json()) as { ok: boolean; userId?: string };
    if (j5.userId) madeUsers.push(j5.userId);
    ok(r5.status === 200 && j5.ok === true, `B5a 디스코드 행에도 로그인 200 (실측 ${r5.status})`);
    ok(elB < 2000, `B5b 로그인 응답이 디스코드 4초 타임아웃에 안 물림 — ${elB}ms`);
    await waitFires(99, 4500); // 배경 알림이 abort로 끝날 때까지 정리 대기
    reset();

    // ── A/B 자가검증: 오라클(B2b "재로그인 0발")이 잘못된 부착 지점을 실제로 잡는가 ──
    //    변이 = 알림을 ensureUser(저수준 upsert = 매 로그인 경로)에 붙인 구현. 같은 계정 재로그인에도 발사돼야 하고,
    //    그러면 B2b가 FAIL로 뒤집힌다 → B2b는 "항상 0이라 통과"가 아니다. (프로덕션 코드 무변경 — 하니스 내 재현)
    {
      const { notifySignup: notif } = await import('../lib/notify');
      const mutantLogin = async (providerId: string) => {
        const uid = await ensureUser(providerId, 'dev'); // ← 잘못된 자리(있으면 조회·없으면 생성)
        await notif({ userId: uid, provider: 'dev', platform: 'android', appVersion: '1.4.2', totalSignups: await countSignups(), projCode: PROJ_CODE });
        return uid;
      };
      reset();
      const mUid = await mutantLogin(PFX + 'MUT'); madeUsers.push(mUid);
      const mFirst = fired.length;
      reset();
      await mutantLogin(PFX + 'MUT'); // 재로그인 상당
      const mSecond = fired.length;
      ok(mFirst === 1 && mSecond === 1,
        `A/B 민감도: 변이(ensureUser 자리 부착)는 재로그인에도 ${mSecond}발 → B2b 오라클이 FAIL로 뒤집힘(신규 ${mFirst}발/재 ${mSecond}발)`);
    }
    reset();
  } catch (e) {
    console.error('  ✗ FAIL: 라이브 티어 예외', e);
    fail++;
  } finally {
    // 이 실행이 만든 유저만 정리(프리픽스 일괄 삭제 금지)
    try { if (madeUsers.length) await db.delete(users).where(inArray(users.id, madeUsers)); } catch (e) { console.error('  (정리 실패)', e); }
    globalThis.fetch = realFetch;
  }

  console.log(fail === 0 ? `\nPASS _dv_signup_notify — 0 FAIL` : `\nFAIL _dv_signup_notify — ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
})();
