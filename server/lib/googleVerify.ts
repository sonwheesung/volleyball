// 구글 ID 토큰 검증(AUTH_SYSTEM) — google-auth-library로 서명·audience·만료 검증 후 **sub만** 도출.
//   ~~개인정보 최소화: 이메일·이름은 저장/반환하지 않는다(sub=구글 계정 고유 식별자만).~~
//   → **정정(2026-08-08, 사용자 결정)**: 운영 식별을 위해 **이메일도 취득**한다(AUTH §3.5).
//     이름·프로필 사진은 계속 안 받는다(최소수집 유지). 처리방침 §1① 개정 동반 — 코드만 바꾸면 안 된다.
//   audience = GOOGLE_OAUTH_CLIENT_IDS(콤마구분, **웹 클라이언트 ID 포함** — google-signin은 webClientId로 idToken 발급).
//   ⚠ 미설정이면 검증 불가(null) → 로그인 실패(fail-closed).
import { OAuth2Client } from 'google-auth-library';

const CLIENT_IDS = (process.env.GOOGLE_OAUTH_CLIENT_IDS ?? '').split(',').map((s: string) => s.trim()).filter(Boolean);
const client = new OAuth2Client();

export interface GoogleIdentity { sub: string; email: string | null }

/** 유효한 구글 idToken이면 { sub, email } 반환, 아니면 null. throw 없음.
 *  email 은 **검증된 것만**(email_verified=true) 취한다 — 미검증 이메일은 소유가 확인되지 않아 식별 근거가 못 된다. */
export async function verifyGoogleIdToken(idToken: string | undefined | null): Promise<GoogleIdentity | null> {
  if (!idToken || CLIENT_IDS.length === 0) return null;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: CLIENT_IDS });
    const payload = ticket.getPayload();
    const sub = payload?.sub;
    if (!sub) return null;
    const email = payload?.email && payload?.email_verified === true ? payload.email : null;
    return { sub, email }; // 이름·사진은 계속 미사용(최소수집)
  } catch {
    return null; // 위·변조·만료·audience 불일치 → 거부
  }
}
