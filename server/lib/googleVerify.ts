// 구글 ID 토큰 검증(AUTH_SYSTEM) — google-auth-library로 서명·audience·만료 검증 후 **sub만** 도출.
//   개인정보 최소화: 이메일·이름은 저장/반환하지 않는다(sub=구글 계정 고유 식별자만).
//   audience = GOOGLE_OAUTH_CLIENT_IDS(콤마구분, **웹 클라이언트 ID 포함** — google-signin은 webClientId로 idToken 발급).
//   ⚠ 미설정이면 검증 불가(null) → 로그인 실패(fail-closed).
import { OAuth2Client } from 'google-auth-library';

const CLIENT_IDS = (process.env.GOOGLE_OAUTH_CLIENT_IDS ?? '').split(',').map((s: string) => s.trim()).filter(Boolean);
const client = new OAuth2Client();

/** 유효한 구글 idToken이면 sub(구글 계정 고유 id) 반환, 아니면 null. throw 없음. */
export async function verifyGoogleIdToken(idToken: string | undefined | null): Promise<string | null> {
  if (!idToken || CLIENT_IDS.length === 0) return null;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: CLIENT_IDS });
    const payload = ticket.getPayload();
    return payload?.sub ?? null; // sub만 — 이메일/이름 미사용(최소수집)
  } catch {
    return null; // 위·변조·만료·audience 불일치 → 거부
  }
}
