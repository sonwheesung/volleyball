// 인증 — 자체 Bearer 세션 토큰(AUTH_SYSTEM §3). HS256 미니 JWT(외부 의존성 0, node:crypto).
// 스텁: 클라가 준 provider+providerId를 서버가 신뢰(dev). EAS에서 이 신뢰를 구글/애플 ID토큰 JWKS 검증으로 교체(§2).
import crypto from 'node:crypto';
import { ensureUser } from './wallet';

const SECRET = process.env.SESSION_JWT_SECRET ?? 'dev-only-change-me';
const b64 = (v: crypto.BinaryLike): string => Buffer.from(v as Buffer).toString('base64url');
const hmac = (body: string): string => b64(crypto.createHmac('sha256', SECRET).update(body).digest());

/** sub("provider:providerId")를 서명한 세션 토큰 발급. */
export function signToken(sub: string): string {
  const body = b64(JSON.stringify({ sub, iat: Date.now() }));
  return `${body}.${hmac(body)}`;
}

/** 토큰 검증 → sub. 위조/변조면 null(상수시간 비교). */
export function verifyToken(token: string): string | null {
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(body);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return typeof p.sub === 'string' ? p.sub : null;
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
