// 접속 핑(하트비트) 가드 — BACKEND_SYSTEM §13.29.   `cd server && npx tsx tools/_dv_heartbeat.ts ; echo $?`
//
// 봉인 대상 2개:
//  ⓐ **서버 라우트의 경량 계약** — POST /api/heartbeat 는 UPDATE 1건짜리다. 나중에 누가 "겸사겸사" getWallet 을 끼워넣으면
//     빈도 높은 경로가 쿼리 6개짜리로 변한다. 소스 수준 + 응답 키 수준 양쪽에서 막는다.
//  ⓑ **클라 sendHeartbeat 의 5성질** — 특히 **무음 실패**. 기존 call() 은 실패 시 logError → lib/log 의 errorSink →
//     기기 진단 롤링 버퍼로 흘러가서, 핑이 실패할 때마다 오류가 쌓여 **문의 진단 스냅샷(§13.20)을 오염**시킨다.
//     "call() 재사용으로 리팩터링" 이 그 오염을 조용히 되살리는 가장 그럴듯한 회귀라 스파이로 못 박는다.
//
// 티어: **순수**(DB 불필요 — 라우트 401·소스 계약·클라 전 성질)는 항상 실행. **라이브**(인증 200·응답 키·lastSeenAt 실갱신)는
//       dev DB 가 붙을 때만, 안 붙으면 SKIP(순수 티어는 그대로 판정).
//
// A/B 자가검증(허위 오라클 금지) — 오라클이 "항상 통과"가 아님을 같은 하니스로 증명:
//   · 소스 린트: getWallet 을 끼워넣은 **변이 소스**를 같은 린터에 태워 검출되는지(내장).
//   · 60초 가드: **1번째는 실제로 발사된다**를 같은 카운터로 관측(카운터가 blind 가 아님을 증명) + 프레시 인스턴스는 다시 발사.
//   · 무음 실패: **똑같이 실패하는 fetch 를 기존 call() 경로(getWallet)로** 태우면 errorSink·console.warn 이 **실제로 울린다**
//     (스파이가 고장나서 조용한 게 아님을 증명) — 이게 이 가드의 핵심 양성대조.
import './_env'; // db import 전에 env 주입(호이스팅 — 첫 import). 라이브 티어용, 값은 어디에도 출력하지 않는다.
import { readFileSync } from 'fs';
import { join } from 'path';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
const skip = (m: string) => console.log('  – SKIP:', m);

const ROUTE_PATH = join(__dirname, '..', 'app', 'api', 'heartbeat', 'route.ts');

// 루트 lib/server.ts 는 **정적 import 불가**: server tsconfig 는 server/** 만 include 하는데 루트 lib/log.ts 의
//   `__DEV__`(Expo 전역)가 server tsc 에서 미해결이라 컴파일이 깨진다. 비리터럴 스펙 require 로 타입 해석을 끊는다.
//   (가드 전용 회피 — 프로덕션 코드에는 어떤 테스트 시임도 남기지 않는다.)
const CLIENT_SPEC = '../../lib/server';
const LOG_SPEC = '../../lib/log';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const req: any = require;

interface Client {
  sendHeartbeat: () => void;
  setServerToken: (t: string | null) => void;
  isServerConfigured: () => boolean;
  getWallet: () => Promise<unknown>;
}
/** lib/server.ts 를 **모듈 상태(lastHeartbeatAt·SERVER_URL) 초기화된 새 인스턴스**로 로드.
 *  SERVER_URL 은 모듈 스코프 const 라 env 를 바꾼 뒤 require 캐시를 비워야 반영된다. lib/log 는 캐시 유지(스파이 공유). */
function loadClient(serverUrl: string): Client {
  process.env.EXPO_PUBLIC_SERVER_URL = serverUrl;
  delete req.cache[req.resolve(CLIENT_SPEC)];
  return req(CLIENT_SPEC) as Client;
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0)); // fetch 프라미스 처리 마이크로태스크 소진

// ── fetch 스텁 ──────────────────────────────────────────────────────────────
type Mode = 'ok' | 'reject' | '401' | '500';
interface Fired { url: string; init: any }
let fired: Fired[] = [];
let bodyReads = 0; // 응답 본문을 읽으면(성질 ③ 위반) 증가
function installFetch(mode: Mode): void {
  (globalThis as any).fetch = (url: string, init: any) => {
    fired.push({ url: String(url), init });
    if (mode === 'reject') return Promise.reject(new Error('network down'));
    const status = mode === '401' ? 401 : mode === '500' ? 500 : 200;
    const bump = () => { bodyReads++; return Promise.resolve(mode === 'ok' ? { ok: true } : { ok: false, reason: 'x' }); };
    return Promise.resolve({ status, ok: status === 200, json: bump, text: () => { bodyReads++; return Promise.resolve('{}'); } });
  };
}
const hbFired = () => fired.filter((f) => f.url.includes('/api/heartbeat'));

// ── logError 스파이(진단 버퍼 오염 감지) ────────────────────────────────────
// logError 는 ①console.warn('[error:…') ②errorSink(진단 롤링 버퍼) 둘 다 친다. 양쪽 모두 감시해
//   한쪽만 우회하는 회귀도 잡는다. errorSink 는 lib/log 의 공개 API(setErrorSink)로 붙인다 — 몽키패치 아님.
const logMod = req(LOG_SPEC) as { setErrorSink: (f: ((w: string, m: string) => void) | null) => void };
let sinkHits: string[] = [];
let warnHits: string[] = [];
const realWarn = console.warn;
function armSpies(): void {
  sinkHits = []; warnHits = [];
  logMod.setErrorSink((where) => { sinkHits.push(where); });
  console.warn = (...a: unknown[]) => { const s = String(a[0] ?? ''); if (s.startsWith('[error:')) warnHits.push(s); };
}
const disarmSpies = () => { console.warn = realWarn; logMod.setErrorSink(null); };

// ── ⓐ 라우트 소스 경량 계약 린트 ────────────────────────────────────────────
// 지갑 조회 심볼이 라우트에 등장하면 위반. `touchLastSeen`(=lib/wallet 의 UPDATE 1건)만 허용한다.
const HEAVY = [/\bgetWallet\b/, /\bwalletLedger\b/, /\bpassStatus\b/, /\bmailCounts\b/, /\badStatusToday\b/, /\bbalance\b/, /\bledger\b/];
function lintRoute(src: string): string[] {
  const body = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n'); // 주석 줄 제외(설명문에 단어가 나옴)
  return HEAVY.filter((re) => re.test(body)).map((re) => re.source);
}

async function main(): Promise<void> {
  console.log('── 접속 핑(하트비트) 가드 · BACKEND §13.29 ──');
  const routeSrc = readFileSync(ROUTE_PATH, 'utf8');

  // ══ [A] 라우트 계약 (순수 — DB 미접속) ══════════════════════════════════
  console.log('\n[A] 라우트 계약(순수)');
  const route = await import('../app/api/heartbeat/route');
  ok(typeof route.POST === 'function', 'A0 POST 핸들러 export');
  ok((route as { dynamic?: string }).dynamic === 'force-dynamic', "A1 export const dynamic = 'force-dynamic'");
  ok(typeof (route as Record<string, unknown>).GET === 'undefined', 'A2 GET 미노출(POST 전용 — 프리페치/크롤러가 못 침)');

  const post = (auth: string | null) =>
    route.POST(new Request('http://x/api/heartbeat', {
      method: 'POST',
      headers: auth ? { 'content-type': 'application/json', authorization: `Bearer ${auth}` } : { 'content-type': 'application/json' },
      body: '{}',
    }));

  const r401 = await post(null);
  ok(r401.status === 401, 'A3 무토큰 → 401');
  ok((await r401.json()).reason === 'unauthorized', 'A3 무토큰 → reason:unauthorized');
  const rBad = await post('not.a.real.token');
  ok(rBad.status === 401, 'A4 위조 토큰 → 401');

  const violations = lintRoute(routeSrc);
  ok(violations.length === 0, `A5 경량 계약 — 라우트에 지갑 조회 심볼 0 (검출: ${violations.join(', ') || '없음'})`);
  ok(/touchLastSeen/.test(routeSrc) && /requireUserId/.test(routeSrc), 'A5 touchLastSeen + requireUserId 는 존재');
  // A/B(내장): getWallet 을 끼워넣은 변이 소스는 같은 린터에 걸려야 한다.
  const mutant = routeSrc.replace('await touchLastSeen(userId);', 'const w = await getWallet(userId); await touchLastSeen(userId);');
  const mutV = lintRoute(mutant);
  ok(mutV.length > 0, `A6 [A/B] getWallet 주입 변이를 린터가 검출 (${mutV.join(', ')}) — 오라클 비공허`);

  // ══ [C] 클라 5성질 (순수) ═══════════════════════════════════════════════
  console.log('\n[C] 클라 sendHeartbeat 5성질(순수)');

  // C1 서버 URL 미설정 = no-op
  fired = []; installFetch('ok');
  let unconfigured = true;
  { const c = loadClient(''); unconfigured = !c.isServerConfigured(); c.setServerToken('tok'); c.sendHeartbeat(); await tick(); }
  ok(unconfigured, 'C1 셋업: 서버 미설정 인스턴스(isServerConfigured=false)');
  ok(hbFired().length === 0, 'C1 EXPO_PUBLIC_SERVER_URL 미설정 → 발사 0(no-op)');

  // C2 미로그인 = no-op
  fired = [];
  { const c = loadClient('http://hb.test'); c.setServerToken(null); c.sendHeartbeat(); await tick(); }
  ok(hbFired().length === 0, 'C2 미로그인(bearer null) → 발사 0(no-op)');

  // C3 60초 가드 + 발사 형태 + 반환값
  fired = []; bodyReads = 0; installFetch('ok');
  const c3 = loadClient('http://hb.test'); c3.setServerToken('tok');
  const ret = c3.sendHeartbeat();
  ok(hbFired().length === 1, 'C3 [A/B 양성대조] 1번째 호출은 실제로 발사됨(카운터가 blind 아님)');
  ok(ret === undefined, 'C3 반환값 undefined = fire-and-forget(호출부가 await 할 것이 없음)');
  c3.sendHeartbeat(); c3.sendHeartbeat();
  await tick();
  ok(hbFired().length === 1, 'C3 60초 가드 — 연속 3회 호출에 발사 1회(2·3번째 억제)');
  const f0 = hbFired()[0];
  ok(f0.init?.method === 'POST', 'C3 method=POST');
  ok(String(f0.init?.headers?.authorization ?? '') === 'Bearer tok', 'C3 Authorization Bearer 동봉');
  ok(f0.init?.body === '{}', 'C3 body는 빈 객체(체류시간 편입은 §13.29 범위 밖 — 계약만 열어둠)');
  ok(bodyReads === 0, 'C4 응답 미파싱 — json()/text() 0회(결정론 격리 계약 봉인)');
  // 프레시 인스턴스는 다시 발사된다 = 60초 가드가 "영구 봉인"이 아님(양성대조 2)
  fired = [];
  { const c = loadClient('http://hb.test'); c.setServerToken('tok'); c.sendHeartbeat(); await tick(); }
  ok(hbFired().length === 1, 'C3 [A/B 양성대조] 프레시 인스턴스는 다시 발사(가드가 상태 기반임을 확인)');

  // C5 무음 실패 3종 — throw 0 · logError 0(errorSink 0 · console.warn 0)
  for (const mode of ['reject', '401', '500'] as Mode[]) {
    fired = []; installFetch(mode);
    const c = loadClient('http://hb.test'); c.setServerToken('tok');
    armSpies();
    let threw: unknown = null;
    try { c.sendHeartbeat(); } catch (e) { threw = e; }
    await tick(); await tick();
    disarmSpies();
    ok(threw === null, `C5(${mode}) 동기 throw 0`);
    ok(hbFired().length === 1, `C5(${mode}) 발사는 실제로 일어남(대조군 성립)`);
    ok(sinkHits.length === 0, `C5(${mode}) errorSink 미호출 — 기기 진단 버퍼 무오염`);
    ok(warnHits.length === 0, `C5(${mode}) console.warn('[error:…') 미호출 — logError 경로 미진입`);
  }

  // C6 [A/B 핵심 양성대조] 똑같이 실패하는 fetch 를 기존 call() 경로(getWallet)로 태우면 스파이가 **울려야** 한다.
  fired = []; installFetch('reject');
  {
    const c = loadClient('http://hb.test'); c.setServerToken('tok');
    armSpies();
    const r = await c.getWallet();
    await tick();
    disarmSpies();
    ok((r as { ok: boolean }).ok === false, 'C6 대조군 getWallet 은 실패를 typed 로 반환(throw 없음 — 기존 규약)');
    ok(sinkHits.length >= 1, `C6 [A/B] 같은 실패가 call() 경로에선 errorSink 를 실제로 침(${sinkHits.length}회) — 스파이 유효`);
    ok(warnHits.length >= 1, `C6 [A/B] 같은 실패가 call() 경로에선 console.warn('[error:…') 를 실제로 침(${warnHits.length}회) — 스파이 유효`);
  }

  // ══ [B] 라이브 티어 (dev DB 있을 때만) ═══════════════════════════════════
  console.log('\n[B] 라우트 라이브(dev DB)');
  (globalThis as any).fetch = undefined; // 스텁 제거 — 라이브 티어는 진짜 DB 드라이버만 쓴다
  try {
    const { db } = await import('../db');
    const { users } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const { ensureProj } = await import('../lib/wallet');
    await ensureProj();
    const loginRoute = await import('../app/api/auth/login/route');
    const pid = '_DVHB_' + Date.now();
    const lr = await (await loginRoute.POST(new Request('http://x/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'dev', providerId: pid, ageConfirmed: true }),
    }))).json() as { token: string; userId: string };
    ok(!!lr.token && !!lr.userId, 'B0 셋업: dev 로그인 토큰 발급');

    // lastSeenAt 을 비워 두고 핑이 실제로 찍는지 본다(로그인이 찍어둔 값과 구분).
    await db.update(users).set({ lastSeenAt: null }).where(eq(users.id, lr.userId));
    const before = (await db.select({ l: users.lastSeenAt }).from(users).where(eq(users.id, lr.userId)))[0]?.l ?? null;
    ok(before === null, 'B1 셋업: lastSeenAt 비움');

    const rOkRes = await post(lr.token);
    const rOkBody = await rOkRes.json() as Record<string, unknown>;
    ok(rOkRes.status === 200 && rOkBody.ok === true, 'B2 인증 POST → 200 {ok:true}');
    ok(JSON.stringify(Object.keys(rOkBody)) === JSON.stringify(['ok']),
      `B3 응답 키가 정확히 ['ok'] — 잔액·원장·패스 미동봉 (실제: ${Object.keys(rOkBody).join(',')})`);

    const after = (await db.select({ l: users.lastSeenAt }).from(users).where(eq(users.id, lr.userId)))[0]?.l ?? null;
    ok(after !== null, 'B4 핑 후 lastSeenAt 이 실제로 갱신됨(now())');

    // 정리 — 가드가 만든 계정 제거
    await db.delete(users).where(eq(users.id, lr.userId));
    console.log('  · 정리: 가드 계정 삭제');
  } catch (e) {
    skip(`dev DB 미접속 — 라이브 티어 생략(순수 티어는 판정됨). 사유: ${(e as Error).message.slice(0, 90)}`);
  }

  console.log(fail === 0 ? '\n결과: PASS (접속 핑 계약 봉인)' : `\n결과: FAIL ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('가드 예외:', e); process.exit(1); });
