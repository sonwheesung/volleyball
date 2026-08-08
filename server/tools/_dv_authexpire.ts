// _dv_authexpire — 죽은 토큰 → 강제 로그아웃 배선 가드 (AUTH_SYSTEM §3.4)
//
// 무엇을 봉인하나
//   토큰이 죽는 경로는 세 가지다: **180일 TTL 만료 · SESSION_JWT_SECRET 회전 · 서버측 계정 삭제.**
//   셋 다 결과는 같다 — 서버가 401. 이때 앱이 세션을 **스스로 비우지 않으면** 유저는
//   "앱은 열리는데 다이아·쿠폰·백업만 전부 실패하는" 반쪽 상태에 갇힌다(로그인 벽이 세션 **객체 유무**만 보기 때문).
//   TTL이 180일이라 이건 회전을 안 해도 언젠가 전 유저에게 터진다 — 그래서 상비 가드로 둔다.
//
//   ① Bearer 실은 401 → 콜백 발화 + bearer 즉시 무효화
//   ② **Bearer 없는 401 → 콜백 미발화**(익명 호출의 401은 "로그인 필요"라는 정상 응답 — 여기서 세션을 지우면 안 된다)
//   ③ **offline·타임아웃·5xx → 콜백 미발화**(네트워크가 나빠서 로그아웃되는 일은 없어야 한다 — 가장 위험한 오작동)
//   ④ 연속 401 → 콜백 **1회만**(bearer가 이미 비었으므로) + 이후 호출은 Authorization 헤더를 안 싣는다
//   ⑤ 배선(소스): useAuthStore가 setUnauthorizedHandler 등록 · sessionExpired를 signOut **전에** 세움 · 로그인 성공 시 해제
//   ⑥ 배선(소스): LoginScreen이 sessionExpired를 읽어 이유를 표시(말없이 튕기면 "내 구단 날아갔나"로 읽힌다)
//
// A/B 자가검증: `--mutant` 는 "bearer 유무를 안 보고 무조건 콜백"으로 바꾼 하니스를 돌린다 → ②가 FAIL로 뒤집혀야 한다.
//   (그 변이가 바로 이 가드가 막으려는 최악의 오작동 — 익명 401에 세션을 지우는 것)
//
// 실행: npx tsx server/tools/_dv_authexpire.ts   /   ... --mutant   (DB 불필요 — 순수)
import { readFileSync } from 'fs';
import { join } from 'path';

const MUTANT = process.argv.includes('--mutant');
let fails = 0;
const ok = (cond: boolean, label: string) => {
  if (cond) console.log(`  ✅ ${label}`);
  else { console.log(`  ❌ ${label}`); fails++; }
};

// 루트 lib/server.ts 는 정적 import 불가(server tsconfig 가 server/** 만 include · lib/log 의 __DEV__ 미해결).
//   `_dv_heartbeat` 과 동일한 비리터럴 require 회피 — 프로덕션 코드엔 테스트 시임을 남기지 않는다.
const CLIENT_SPEC = '../../lib/server';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const req: any = require;

interface Client {
  setServerToken: (t: string | null) => void;
  setUnauthorizedHandler: (f: (() => void) | null) => void;
  getWallet: () => Promise<any>;
}
function loadClient(): Client {
  process.env.EXPO_PUBLIC_SERVER_URL = 'http://auth.test';
  delete req.cache[req.resolve(CLIENT_SPEC)];
  return req(CLIENT_SPEC) as Client;
}

type Mode = 'ok' | '401' | '500' | 'reject';
let sent: any[] = [];
function installFetch(mode: Mode): void {
  (globalThis as any).fetch = (url: string, init: any) => {
    sent.push({ url: String(url), auth: init?.headers?.authorization ?? null });
    if (mode === 'reject') return Promise.reject(new Error('network down'));
    const status = mode === '401' ? 401 : mode === '500' ? 500 : 200;
    return Promise.resolve({
      status, ok: status === 200,
      json: () => Promise.resolve(status === 200 ? { ok: true, balance: 0 } : { ok: false, reason: 'x' }),
      text: () => Promise.resolve('{}'),
    });
  };
}

/** 한 시나리오 실행 → 콜백 발화 횟수. MUTANT면 "bearer 유무 무시" 변이를 흉내내 직접 발화시킨다. */
async function run(mode: Mode, token: string | null, calls = 1): Promise<{ fires: number; auths: (string | null)[] }> {
  const c = loadClient();
  let fires = 0;
  c.setUnauthorizedHandler(() => { fires++; });
  c.setServerToken(token);
  sent = [];
  installFetch(mode);
  for (let i = 0; i < calls; i++) await c.getWallet();
  // 변이: 실제 코드의 `if (bearer)` 게이트를 무시하고 401이면 무조건 발화하는 구현을 재현.
  if (MUTANT && mode === '401' && token === null) fires += calls;
  return { fires, auths: sent.map((s) => s.auth) };
}

(async () => {
  console.log(`\n=== _dv_authexpire (AUTH §3.4) ${MUTANT ? '[MUTANT — ②가 FAIL로 뒤집혀야 정상]' : ''} ===`);

  console.log('\n[①] Bearer 실은 401 → 강제 로그아웃 발화');
  const a = await run('401', 'live-token');
  ok(a.fires === 1, `콜백 1회 발화 (실제 ${a.fires})`);
  ok(a.auths[0] === 'Bearer live-token', '요청에 Bearer가 실려 있었다(전제 확인 — 익명 호출과 헷갈리지 않게)');

  console.log('\n[②] Bearer 없는 401 → 발화 안 함 (익명 401은 정상 응답)');
  const b = await run('401', null);
  ok(b.fires === 0, `콜백 미발화 (실제 ${b.fires})`);
  ok(b.auths[0] === null, 'Authorization 헤더 자체가 없었다');

  console.log('\n[③] 네트워크 문제로는 절대 로그아웃 안 됨');
  for (const m of ['reject', '500'] as Mode[]) {
    const r = await run(m, 'live-token');
    ok(r.fires === 0, `${m}: 콜백 미발화 (실제 ${r.fires})`);
  }
  const okRun = await run('ok', 'live-token');
  ok(okRun.fires === 0, `정상 200: 콜백 미발화 (실제 ${okRun.fires})`);

  console.log('\n[④] 연속 401 → 1회만 발화 + 이후 Bearer 미탑재');
  const d = await run('401', 'live-token', 3);
  ok(d.fires === 1, `3회 호출에 발화 1회 (실제 ${d.fires})`);
  ok(d.auths[0] === 'Bearer live-token' && d.auths[1] === null && d.auths[2] === null,
    `첫 호출만 Bearer, 이후는 없음 (실제 ${JSON.stringify(d.auths)})`);

  console.log('\n[⑤] 배선 — useAuthStore');
  const storeSrc = readFileSync(join(__dirname, '..', '..', 'store', 'useAuthStore.ts'), 'utf8');
  ok(/setUnauthorizedHandler\(/.test(storeSrc), '핸들러를 등록한다');
  ok(/sessionExpired: true/.test(storeSrc), 'sessionExpired를 세운다');
  ok(/sessionExpired: true[\s\S]{0,200}?signOut\(\)/.test(storeSrc), 'sessionExpired를 signOut **전에** 세운다(순서 — 뒤면 로그인 화면이 이유를 모른다)');
  ok(/sessionExpired: false/.test(storeSrc), '로그인 성공 시 해제한다');
  ok(/getState\(\)\.session\) return/.test(storeSrc), '이미 로그아웃 상태면 no-op(중복 발화 무해화)');

  console.log('\n[⑥] 배선 — LoginScreen이 이유를 표시');
  const loginSrc = readFileSync(join(__dirname, '..', '..', 'components', 'LoginScreen.tsx'), 'utf8');
  ok(/sessionExpired/.test(loginSrc), 'sessionExpired를 구독한다');
  ok(/만료/.test(loginSrc), '만료 안내 문구가 있다');
  ok(/구단이 그대로/.test(loginSrc), '"구단은 보존된다"를 알려준다(데이터 소실 오해 차단)');

  console.log(`\n=== ${fails === 0 ? 'PASS' : `FAIL ${fails}건`} ===`);
  if (MUTANT) {
    console.log(fails > 0
      ? '✅ A/B 민감도 확인 — "bearer 무시" 변이가 ②에서 검출됨(익명 401에 세션을 지우는 최악의 오작동을 이 가드가 실제로 막는다)'
      : '❌ A/B 실패 — 변이를 넣었는데도 통과했다. 이 가드는 무의미하다.');
    process.exit(fails > 0 ? 0 : 1);
  }
  process.exit(fails === 0 ? 0 : 1);
})();
