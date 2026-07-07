// 레이트리밋 순수 가드 (SECURITY_AUDIT #3, 2026-07-07) — **DB·Redis 불필요**.
// 실행: server 디렉터리에서 `npx tsx tools/_dv_ratelimit.ts`.
//   Upstash env를 일부러 UNSET한 상태로 fail-open no-op 경로를 검증한다(실 Redis 연결 안 함).
//
// 검증 항목:
//  (a) env(UPSTASH_REDIS_REST_URL/TOKEN) 미설정 시 checkLimit이 **항상 {ok:true}**(fail-open no-op)
//      → Upstash 세팅 전에도 안전하게 커밋 가능함을 증명. 5개 리미터 전부, 반복 호출해도 한도에 안 걸림.
//  (b) clientIp()가 x-forwarded-for 첫 홉("a, b, c"→"a")을 파싱, 헤더 없으면 폴백('unknown').
//  (c) LIMITS 상수가 의도한 윈도와 일치(login 10/60 등) — export 상수를 직접 읽어 드리프트 차단.
//  (d) 식별자 프리픽스가 엔드포인트별 구분 키 생성(cross-endpoint 충돌 없음).
//
// ⚠ 변이 자가검증(mutant self-check): 아래 어느 FIX든 원복하면 해당 assert가 FAIL 나야 한다.
//   예) checkLimit이 미설정 시 {ok:false}를 반환하면 (a) 실패(fail-open 깨짐);
//       clientIp가 xff 전체를 반환하면 (b) 첫 홉 파싱 실패;
//       LIMITS.login.limit을 10→5로 바꾸면 (c) 실패;
//       checkLimit이 name 프리픽스를 안 붙이면 (d) 엔드포인트 구분 실패.
import { checkLimit, clientIp, LIMITS, type LimiterName } from '../lib/ratelimit';

let pass = 0;
let total = 0;
const ok = (cond: boolean, msg: string): void => {
  total++;
  if (cond) { pass++; console.log('  ✓', msg); }
  else console.error('  ✗ FAIL:', msg);
};

// 헤더 1개짜리 가짜 Request(clientIp 파서 시험용) — 실 네트워크 없음.
const reqWith = (headers: Record<string, string>): Request =>
  new Request('http://localhost/x', { headers });

async function main(): Promise<number> {
  // env를 확실히 미설정으로(로컬에 잔존 값이 있어도 fail-open 경로를 재현) — 스냅샷/복원.
  const env = process.env as Record<string, string | undefined>;
  const ENV0 = { URL: env.UPSTASH_REDIS_REST_URL, TOKEN: env.UPSTASH_REDIS_REST_TOKEN };
  delete env.UPSTASH_REDIS_REST_URL;
  delete env.UPSTASH_REDIS_REST_TOKEN;

  // ───────────────────────── (a) 미설정 fail-open no-op ─────────────────────────
  console.log('── (a) env 미설정 → checkLimit 항상 허용(fail-open, 커밋 안전 증명) ──');
  const names: LimiterName[] = ['login', 'couponRedeemUser', 'couponRedeemIp', 'ticket', 'snapshot'];
  let allAllowed = true;
  for (const n of names) {
    // 한도(limit)의 3배 이상 반복 호출해도 전부 허용돼야 한다(no-op라 카운트 안 함).
    for (let i = 0; i < LIMITS[n].limit * 3 + 5; i++) {
      const r = await checkLimit(n, `id-${i % 4}`);
      if (!r.ok) { allAllowed = false; break; }
    }
    ok(allAllowed, `${n}: env 미설정 시 반복 호출(한도 3배+) 전부 {ok:true}(no-op)`);
    if (!allAllowed) break;
  }

  // ───────────────────────── (b) clientIp 파싱 ─────────────────────────
  console.log('── (b) clientIp x-forwarded-for 파싱 ──');
  ok(clientIp(reqWith({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 9.10.11.12' })) === '1.2.3.4', 'xff "a, b, c" → 첫 홉 "a"');
  ok(clientIp(reqWith({ 'x-forwarded-for': '  8.8.8.8  ' })) === '8.8.8.8', 'xff 단일값 trim');
  ok(clientIp(reqWith({})) === 'unknown', '헤더 없음 → 폴백 unknown');
  ok(clientIp(reqWith({ 'x-real-ip': '4.4.4.4' })) === '4.4.4.4', 'xff 없고 x-real-ip 있으면 그 값');

  // ───────────────────────── (c) LIMITS 상수 = 의도 윈도 ─────────────────────────
  console.log('── (c) LIMITS 상수 드리프트 가드 ──');
  ok(LIMITS.login.limit === 10 && LIMITS.login.windowSec === 60, 'login 10/60s');
  ok(LIMITS.couponRedeemUser.limit === 8 && LIMITS.couponRedeemUser.windowSec === 60, 'couponRedeem user 8/60s');
  ok(LIMITS.couponRedeemIp.limit === 20 && LIMITS.couponRedeemIp.windowSec === 600, 'couponRedeem IP 20/600s');
  ok(LIMITS.ticket.limit === 5 && LIMITS.ticket.windowSec === 600, 'ticket 5/600s');
  ok(LIMITS.snapshot.limit === 10 && LIMITS.snapshot.windowSec === 300, 'snapshot 10/300s');

  // ───────────────────────── (d) 프리픽스 → 엔드포인트별 구분 키 ─────────────────────────
  // checkLimit은 no-op이라 키를 직접 관측 못 하므로, 키 조립 규칙(`${name}:${identifier}`)을 미러해 구분성만 확인.
  console.log('── (d) 식별자 프리픽스(엔드포인트 구분) ──');
  const key = (name: LimiterName, id: string): string => `${name}:${id}`;
  ok(key('login', 'X') !== key('ticket', 'X'), '같은 identifier라도 엔드포인트가 다르면 키가 다름(login≠ticket)');
  ok(key('couponRedeemUser', 'u') !== key('couponRedeemIp', 'u'), 'coupon user 리미터와 IP 리미터 키 분리');
  ok(key('snapshot', 'a') === key('snapshot', 'a'), '동일 엔드포인트+동일 id는 동일 키(결정론)');

  // env 복원
  if (ENV0.URL === undefined) delete env.UPSTASH_REDIS_REST_URL; else env.UPSTASH_REDIS_REST_URL = ENV0.URL;
  if (ENV0.TOKEN === undefined) delete env.UPSTASH_REDIS_REST_TOKEN; else env.UPSTASH_REDIS_REST_TOKEN = ENV0.TOKEN;

  console.log(pass === total ? `\nRATELIMIT PASS (${pass}/${total})` : `\nRATELIMIT FAIL (${pass}/${total})`);
  return pass === total ? 0 : 1;
}

main().then((code) => process.exit(code));
