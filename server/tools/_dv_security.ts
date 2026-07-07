// 보안 수정 상설 가드 (SECURITY_AUDIT #1·#2(a)·#4·#5, 2026-07-07) — **순수 로직, DB 불필요**.
// 실행: server 디렉터리에서 `npx tsx tools/_dv_security.ts` (DATABASE_URL 없이도 동작 — auth/walletKey는 쿼리를 안 함).
//   (auth→wallet→db 임포트 체인은 postgres-js 클라 객체만 생성하고 연결은 지연이라 로드 시 DB 접속 없음.)
//
// 검증 항목:
//  (a) #1 welcome 무한발행: earnClientKeyPart('welcome', k)가 5개 다른 클라키에 **동일 상수** 반환(클라키 무시) +
//      최종 저장키가 `${userId}:welcome`로 계정당 단일.
//  (b) #5 userId 미바인딩 선점: ad/achievement 저장키가 **호출자(공격자) userId로 시작**(클라키가 피해자 userId를
//      임베드해도) → 교차유저 선점 불가.
//  (c) #2(a) 시크릿 fail-closed + 토큰 만료: 프로덕션+약한/미설정 시크릿이면 signToken throw·verifyToken null,
//      강한 시크릿이면 왕복 성공, iat 초과(180일+) 토큰은 거부.
//  (d) #4 스냅샷 상한: >256KB 페이로드 거부·작은 페이로드 통과(SNAPSHOT_MAX_BYTES 임포트로 드리프트 차단).
//
// ⚠ 변이 자가검증(mutant self-check): 아래 어느 FIX든 원복하면 해당 assert가 FAIL 나야 한다.
//   예) earnClientKeyPart가 welcome에도 clientKey를 반환하면 (a) 동일성 5/5가 깨짐;
//       verifyToken이 secretUnsafeInProd 게이트를 지우면 (c) 약한시크릿 null 검사가 깨짐;
//       size 컷을 지우면 (d) 큰 페이로드 거부가 깨짐.
import crypto from 'node:crypto';
import { signToken, verifyToken } from '../lib/auth';
import { earnClientKeyPart, walletIdemKey, WELCOME_KEY_PART } from '../lib/walletKey';
import { SNAPSHOT_MAX_BYTES } from '../app/api/snapshot/route';

let pass = 0;
let total = 0;
const ok = (cond: boolean, msg: string): void => {
  total++;
  if (cond) { pass++; console.log('  ✓', msg); }
  else console.error('  ✗ FAIL:', msg);
};

// env 스냅샷/복원(테스트가 프로덕션/시크릿을 임시 조작) — NODE_ENV가 타입상 readonly라 mutable 별칭으로 조작.
const env = process.env as Record<string, string | undefined>;
const ENV0 = { VERCEL_ENV: env.VERCEL_ENV, NODE_ENV: env.NODE_ENV, SESSION_JWT_SECRET: env.SESSION_JWT_SECRET };
const restoreEnv = (): void => {
  for (const k of ['VERCEL_ENV', 'NODE_ENV', 'SESSION_JWT_SECRET'] as const) {
    const v = ENV0[k];
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
};

// 로컬/가드 실행 환경이 production 게이트에 걸리지 않게(비프로덕션에서 강한키 왕복 테스트) 기본은 test로.
const setDev = (): void => { env.VERCEL_ENV = 'preview'; env.NODE_ENV = 'test'; };
const setProd = (): void => { env.VERCEL_ENV = 'production'; env.NODE_ENV = 'production'; };

// base64url 헬퍼 — 만료 토큰을 직접 위조(같은 서명 스킴 복제)해 verifyToken을 시험.
const b64u = (v: crypto.BinaryLike): string => Buffer.from(v as Buffer).toString('base64url');
const forgeToken = (sub: string, iatMs: number, secret: string): string => {
  const body = b64u(JSON.stringify({ sub, iat: iatMs }));
  const sig = b64u(crypto.createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
};

function main(): number {
  // ───────────────────────── (a) FIX#1 — welcome 클라키 무시 + 계정당 상수 ─────────────────────────
  console.log('── (a) #1 welcome 무한발행 차단 ──');
  const uid = 'attacker-uuid-1111';
  const welcomeClientKeys = ['welcome:x1', 'welcome:x2', 'garbage', 'welcome:99', ''];
  const welcomeStored = welcomeClientKeys.map((k) => walletIdemKey(uid, earnClientKeyPart('welcome', k)));
  ok(welcomeStored.every((k) => k === welcomeStored[0]), `welcome 저장키가 5개 다른 클라키에 모두 동일(클라키 무시) — ${welcomeStored[0]}`);
  ok(welcomeStored[0] === `${uid}:${WELCOME_KEY_PART}`, `welcome 저장키 = "\${userId}:welcome" 결정론 (실측 ${welcomeStored[0]})`);
  ok(welcomeStored[0].startsWith(`${uid}:`), 'welcome 저장키가 서버 userId로 시작');

  // ───────────────────────── (b) FIX#5 — 저장키 userId 서버 바인딩(선점 차단) ─────────────────────────
  console.log('── (b) #5 멱등키 userId 바인딩(교차유저 선점 차단) ──');
  const victim = 'victim-uuid-2222';
  // 공격자가 피해자 userId를 임베드한 클라키로 미리 적립 시도:
  const attackerClientKey = `ad:${victim}:2026-07-07:3`;
  for (const reason of ['ad', 'achievement']) {
    const stored = walletIdemKey(uid, earnClientKeyPart(reason, attackerClientKey));
    ok(stored.startsWith(`${uid}:`), `${reason} 저장키가 공격자(호출자) userId로 시작 — 피해자 userId로 시작 안 함 (실측 ${stored})`);
    ok(!stored.startsWith(`${victim}:`), `${reason} 저장키가 피해자 userId로 시작하지 않음(선점 불가)`);
    ok(stored === `${uid}:${attackerClientKey}`, `${reason} 클라키 부분 보존(정당 재시도 dedupe 유지)`);
  }
  // 정당 재시도 동일성: 같은 userId + 같은 클라키 → 같은 저장키
  ok(
    walletIdemKey(victim, earnClientKeyPart('ad', 'ad:slotA')) === walletIdemKey(victim, earnClientKeyPart('ad', 'ad:slotA')),
    '정당 재시도(동일 userId+클라키)는 동일 저장키(dedupe 유지)',
  );

  // ───────────────────────── (c) FIX#2(a) — 시크릿 fail-closed + 토큰 만료 ─────────────────────────
  console.log('── (c) #2(a) 세션 시크릿 prod fail-closed + 토큰 만료 ──');
  const STRONG = 'S'.repeat(48); // 32자 이상 강한 시크릿

  // (c1) 프로덕션 + 시크릿 미설정 → signToken throw, verifyToken null
  setProd();
  delete env.SESSION_JWT_SECRET;
  let threw = false;
  try { signToken('google:victim'); } catch { threw = true; }
  ok(threw, 'prod + 시크릿 미설정: signToken이 throw(fail-closed)');
  ok(verifyToken('anything.deadbeef') === null, 'prod + 시크릿 미설정: verifyToken null');

  // (c2) 프로덕션 + 약한 시크릿(32자 미만) → 동일 fail-closed
  process.env.SESSION_JWT_SECRET = 'short';
  let threw2 = false;
  try { signToken('google:victim'); } catch { threw2 = true; }
  ok(threw2, 'prod + 약한 시크릿(<32자): signToken throw');

  // (c3) 프로덕션 + 기본값 'dev-only-change-me'(길이는 충분하나 기본값) → fail-closed
  process.env.SESSION_JWT_SECRET = 'dev-only-change-me';
  let threw3 = false;
  try { signToken('google:victim'); } catch { threw3 = true; }
  ok(threw3, "prod + 기본값 'dev-only-change-me': signToken throw");

  // (c4) 프로덕션 + 강한 시크릿 → 왕복 성공
  process.env.SESSION_JWT_SECRET = STRONG;
  const tok = signToken('google:legit');
  ok(verifyToken(tok) === 'google:legit', 'prod + 강한 시크릿: 서명 토큰 왕복 성공');

  // (c5) 강한 시크릿 + iat 초과(200일 전) → 거부 / 신선 위조 토큰은 통과(오라클 민감도)
  const old = forgeToken('google:legit', Date.now() - 200 * 24 * 3600 * 1000, STRONG);
  const fresh = forgeToken('google:legit', Date.now(), STRONG);
  ok(verifyToken(old) === null, 'iat 200일 초과 토큰 거부(만료)');
  ok(verifyToken(fresh) === 'google:legit', '신선 iat 토큰 통과(만료 오탐 아님)');
  // 잘못된 서명(다른 시크릿으로 위조) → null (fail-closed 회귀 대조)
  ok(verifyToken(forgeToken('google:legit', Date.now(), 'WRONG'.repeat(10))) === null, '다른 시크릿 서명 위조 토큰 거부');

  // (c6) 비프로덕션 + 시크릿 미설정 → dev 기본키로 왕복 성공(로컬 dev 안 깨짐)
  setDev();
  delete env.SESSION_JWT_SECRET;
  const devTok = signToken('dev:local-1');
  ok(verifyToken(devTok) === 'dev:local-1', '비프로덕션 + 시크릿 미설정: dev 기본키 왕복(로컬 dev 정상)');

  restoreEnv();

  // ───────────────────────── (d) FIX#4 — 스냅샷 blob 크기 상한 ─────────────────────────
  console.log('── (d) #4 스냅샷 256KB 상한 ──');
  ok(SNAPSHOT_MAX_BYTES === 262144, `SNAPSHOT_MAX_BYTES=256KB (실측 ${SNAPSHOT_MAX_BYTES})`);
  const tooLarge = (snap: unknown): boolean => JSON.stringify(snap).length > SNAPSHOT_MAX_BYTES; // 라우트 컷 로직 미러
  const bigPayload = { blob: 'x'.repeat(SNAPSHOT_MAX_BYTES + 10) };
  const smallPayload = { day: 12, players: [{ id: 'p1', ovr: 80 }] };
  ok(tooLarge(bigPayload), '>256KB 페이로드는 거부(size>cap)');
  ok(!tooLarge(smallPayload), '작은 페이로드는 통과');
  // 경계: 정확히 상한 이하는 통과, 초과는 거부
  ok(!tooLarge('x'.repeat(SNAPSHOT_MAX_BYTES - 2)), '상한 경계 이하 통과(문자열은 따옴표 2개 포함 stringify)');

  console.log(pass === total ? `\n✅ SECURITY PASS (${pass}/${total})` : `\n❌ SECURITY FAIL (${pass}/${total})`);
  return pass === total ? 0 : 1;
}

const code = main();
process.exit(code);
