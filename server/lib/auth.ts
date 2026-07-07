// 인증 — 자체 Bearer 세션 토큰(AUTH_SYSTEM §3). HS256 미니 JWT(외부 의존성 0, node:crypto).
// 스텁: 클라가 준 provider+providerId를 서버가 신뢰(dev). EAS에서 이 신뢰를 구글/애플 ID토큰 JWKS 검증으로 교체(§2).
// SECURITY_AUDIT #2(a)(2026-07-07): 시크릿 fail-open + 토큰 만료 부재를 fail-closed로.
//  · 프로덕션(VERCEL_ENV/NODE_ENV==='production')에서 SESSION_JWT_SECRET 미설정/32자 미만/기본값이면
//    signToken은 throw, verifyToken은 null(약한 키로 임의 계정 위조 차단). 로컬 dev는 기본키 유지(경고 1회).
//  · 토큰 만료: verifyToken이 iat 기준 TTL(180일) 초과 토큰 거부(관대 — 캐시 세션 갑작스런 로그아웃 회피).
// env는 **호출 시점**에 읽는다(모듈 로드 시 캐시 금지) — 프로덕션 게이트가 배포 env에 정확히 반응하도록.
import crypto from 'node:crypto';
import { ensureUser } from './wallet';

const DEFAULT_SECRET = 'dev-only-change-me';
const MIN_SECRET_LEN = 32;
const TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180일(관대 — iat 초과 시 거부)

const b64 = (v: crypto.BinaryLike): string => Buffer.from(v as Buffer).toString('base64url');

/** 프로덕션 배포인가(Vercel env 우선, 없으면 NODE_ENV). */
function isProd(): boolean {
  return process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
}

/** 프로덕션에서 시크릿이 미설정/약함/기본값이면 true(fail-closed). 비프로덕션은 항상 false(dev 기본키 허용). */
function secretUnsafeInProd(): boolean {
  const s = process.env.SESSION_JWT_SECRET;
  return isProd() && (!s || s.length < MIN_SECRET_LEN || s === DEFAULT_SECRET);
}

let warnedWeakSecret = false;
/** 서명/검증에 쓰는 활성 시크릿. 비프로덕션 미설정 시 dev 기본키(+경고 1회). */
function activeSecret(): string {
  const s = process.env.SESSION_JWT_SECRET;
  if ((!s || s === DEFAULT_SECRET) && !isProd() && !warnedWeakSecret) {
    console.warn('[auth] SESSION_JWT_SECRET 미설정/기본값 — dev 기본키 사용(로컬 전용). 프로덕션에선 fail-closed로 토큰 거부.');
    warnedWeakSecret = true;
  }
  return s ?? DEFAULT_SECRET;
}

const hmac = (body: string): string => b64(crypto.createHmac('sha256', activeSecret()).update(body).digest());

/** sub("provider:providerId")를 서명한 세션 토큰 발급. 프로덕션 약한 시크릿이면 throw(fail-closed). */
export function signToken(sub: string): string {
  if (secretUnsafeInProd()) {
    throw new Error('[auth] SESSION_JWT_SECRET가 프로덕션에서 미설정/약함(32자 미만/기본값) — 토큰 발급 거부(fail-closed).');
  }
  const body = b64(JSON.stringify({ sub, iat: Date.now() }));
  return `${body}.${hmac(body)}`;
}

/** 토큰 검증 → sub. 위조/변조/만료면 null(상수시간 비교). 프로덕션 약한 시크릿이면 무조건 null(fail-closed). */
export function verifyToken(token: string): string | null {
  if (secretUnsafeInProd()) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(body);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (typeof p.sub !== 'string') return null;
    // 토큰 만료(iat 기준 TTL) — iat 있으면 초과 시 거부. iat 없는 옛 토큰은 관대 통과(하위호환).
    if (typeof p.iat === 'number' && Date.now() - p.iat > TOKEN_TTL_MS) return null;
    return p.sub;
  } catch {
    return null;
  }
}

/** 요청의 Bearer → userId. 없거나 무효면 익명 dev 유저 폴백(하위호환 — online-first). */
export async function resolveUserId(req: Request): Promise<string> {
  const auth = req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  const sub = token ? verifyToken(token) : null;
  if (sub) {
    const idx = sub.indexOf(':');
    const provider = idx >= 0 ? sub.slice(0, idx) : 'dev';
    const providerId = idx >= 0 ? sub.slice(idx + 1) : sub;
    return ensureUser(providerId, provider);
  }
  return ensureUser('dev-user-1', 'dev'); // 익명(비로그인)
}

/** 요청의 **유효한 Bearer**가 있을 때만 userId, 없으면 null(→401). 익명 폴백 금지(§13.17 P0-5).
 *  티켓·환불·스냅샷·지갑 등 "특정 사용자에 귀속돼야 하는" 라우트용 — 비로그인이 dev-user-1 한 버킷에 붕괴되는 것 차단. */
export async function requireUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  const sub = token ? verifyToken(token) : null;
  if (!sub) return null;
  const idx = sub.indexOf(':');
  const provider = idx >= 0 ? sub.slice(0, idx) : 'dev';
  const providerId = idx >= 0 ? sub.slice(idx + 1) : sub;
  return ensureUser(providerId, provider);
}
