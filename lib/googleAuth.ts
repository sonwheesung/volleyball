// 구글 로그인 — 네이티브 계정 선택창(@react-native-google-signin). idToken만 얻어 서버가 검증(sub 도출).
//   개인정보 최소화: 이메일·이름은 서버에 저장하지 않는다(서버는 idToken에서 sub만 추출). AUTH_SYSTEM.
//   Expo Go엔 네이티브 모듈이 없으므로 **지연 require + graceful**(미설정/미설치면 unavailable). 실동작은 EAS 빌드.
//   webClientId = Google Cloud "웹 애플리케이션" OAuth 클라이언트 ID(EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) — 미설정이면 로그인 불가.
import { logError } from './log';

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';

/** 네이티브 모듈 지연 로드 — 미설치(Expo Go)면 null. */
function gsi(): any | null {
  try {
    // @ts-ignore — 선택적 네이티브 모듈(EAS 빌드에만 존재)
    return require('@react-native-google-signin/google-signin');
  } catch {
    return null;
  }
}

let configured = false;
function ensureConfigured(): any | null {
  const mod = gsi();
  if (!mod?.GoogleSignin) return null;
  if (!configured && WEB_CLIENT_ID) {
    mod.GoogleSignin.configure({ webClientId: WEB_CLIENT_ID }); // idToken 발급 대상(서버 검증 audience)
    configured = true;
  }
  return mod;
}

export type GoogleResult =
  | { ok: true; idToken: string }
  | { ok: false; reason: 'cancelled' | 'unavailable' | 'error'; message?: string };

/** 네이티브 구글 로그인 → idToken(계정 선택창). throw 없음. 서버가 idToken을 검증해 sub만 저장. */
export async function signInGoogle(): Promise<GoogleResult> {
  const mod = ensureConfigured();
  if (!mod || !WEB_CLIENT_ID) return { ok: false, reason: 'unavailable', message: 'Google 로그인 미설정(빌드/키 필요)' };
  const { GoogleSignin, statusCodes } = mod;
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const info = await GoogleSignin.signIn();
    // v13+: { data: { idToken } } · 구버전: { idToken }
    const idToken: string | undefined = info?.data?.idToken ?? info?.idToken;
    if (!idToken) return { ok: false, reason: 'error', message: 'idToken 없음' };
    return { ok: true, idToken };
  } catch (e: any) {
    if (e?.code && statusCodes && e.code === statusCodes.SIGN_IN_CANCELLED) return { ok: false, reason: 'cancelled' };
    logError('googleAuth.signIn', e);
    return { ok: false, reason: 'error', message: String(e?.message ?? e) };
  }
}

/** 로그아웃 시 구글 세션도 정리(다음 로그인에서 계정 재선택 가능). graceful. */
export async function signOutGoogle(): Promise<void> {
  try { const mod = gsi(); await mod?.GoogleSignin?.signOut?.(); } catch { /* graceful */ }
}
