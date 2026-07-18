// 로그인 벽 (AUTH_SYSTEM §4) — 하드 게이트. 로그인 전엔 게임 진입 불가. 성공 시 BootGate가 session 감지→게임 전환.
// 구글: 네이티브 @react-native-google-signin → idToken → 서버 verifyGoogleIdToken(2026-07-05 실기기 연결).
//       개발자 로그인(dev)은 __DEV__ 빌드에만 노출(Expo Go/네이티브 미탑재 폴백). 애플은 iOS 정식 빌드 예정.
//       구글 버튼은 브랜드 가이드(흰 배경·4색 G 로고)로 — 타 게임과 동일한 익숙한 룩(2026-07-05).
import { useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Path } from 'react-native-svg';
import { Screen, theme, themedStyles } from './Screen';
import { useAuthStore } from '../store/useAuthStore';

type Provider = 'google' | 'apple' | 'dev';

/** 구글 공식 4색 "G" 로고(브랜드 가이드) — 흰 버튼 위에 얹는다. */
function GoogleGLogo({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
      <Path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
      <Path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z" />
      <Path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
    </Svg>
  );
}

/** 구글 로그인 버튼 — 브랜드 가이드(흰 배경·#1f1f1f 텍스트·4색 G). */
function GoogleButton({ onPress, busy }: { onPress: () => void; busy: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={busy} style={({ pressed }) => [styles.googleBtn, (pressed || busy) && { opacity: 0.85 }]}>
      {busy ? <ActivityIndicator color="#1f1f1f" /> : <GoogleGLogo size={20} />}
      <Text style={styles.googleLabel}>Google로 로그인</Text>
    </Pressable>
  );
}

/** 보조 로그인(애플·개발자) — 다크 버튼. */
function ProviderButton({ icon, label, onPress, busy, tint }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; busy: boolean; tint?: string }) {
  return (
    <Pressable onPress={onPress} disabled={busy} style={({ pressed }) => [styles.btn, tint ? { borderColor: tint + '55' } : null, (pressed || busy) && { opacity: 0.7 }]}>
      {busy ? <ActivityIndicator color={tint ?? theme.text} /> : <Ionicons name={icon} size={20} color={tint ?? theme.text} />}
      <Text style={[styles.btnLabel, tint ? { color: tint } : null]}>{label}</Text>
    </Pressable>
  );
}

export function LoginScreen() {
  const signIn = useAuthStore((s) => s.signIn);
  const [busy, setBusy] = useState<Provider | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // 만 14세 연령 게이트(AUTH §8) — 최초 가입 경로 확인. 미확인 시 로그인 진행 차단(방침 4조 정합).
  const [ageOk, setAgeOk] = useState(false);

  const doSignIn = async (provider: Provider) => {
    if (!ageOk) { setErr('만 14세 미만은 이용할 수 없습니다. 만 14세 이상임을 확인해 주세요.'); return; }
    setBusy(provider);
    setErr(null);
    const r = await signIn(provider, true); // 체크박스로 게이팅 — 여기 도달하면 항상 확인됨(신규 가입만 서버가 요구)
    setBusy(null);
    if (!r.ok) {
      if (r.reason === 'cancelled') return; // 유저가 계정 선택 취소 — 조용히
      setErr(
        r.reason === 'offline' ? '네트워크 연결이 필요합니다 (최초 로그인 1회).'
          : r.reason === 'unavailable' ? 'Google 로그인은 정식 빌드에서 지원됩니다. 개발 중에는 개발자 로그인을 이용하세요.'
            : '로그인에 실패했어요. 잠시 후 다시 시도해 주세요.');
    }
    // 성공 시 별도 네비 없음 — BootGate가 session 변화를 감지해 자동으로 게임으로 전환
  };

  return (
    <Screen scroll={false}>
      <View style={styles.wrap}>
        <View style={styles.brandBox}>
          <View style={styles.logoChip}><Text style={styles.logoEmoji}>🏐</Text></View>
          <Text style={styles.mark}>배구명가</Text>
          <Text style={styles.tagline}>명문 구단의 역사가 시작됩니다</Text>
        </View>

        {/* 만 14세 연령 확인 — 체크해야 로그인 버튼 활성(AUTH §8). */}
        <Pressable onPress={() => { setAgeOk((v) => !v); setErr(null); }} style={styles.ageRow} hitSlop={8}>
          <Ionicons name={ageOk ? 'checkbox' : 'square-outline'} size={22} color={ageOk ? theme.accent : theme.muted} />
          <Text style={styles.ageLabel}>만 14세 이상입니다</Text>
        </Pressable>

        <View style={[styles.btnGroup, !ageOk && styles.btnGroupDim]}>
          <GoogleButton onPress={() => doSignIn('google')} busy={busy === 'google'} />
          {Platform.OS === 'ios' ? (
            <ProviderButton icon="logo-apple" label="Apple로 로그인" onPress={() => doSignIn('apple')} busy={busy === 'apple'} />
          ) : null}
          {__DEV__ ? (
            <ProviderButton icon="construct-outline" label="개발자 로그인" onPress={() => doSignIn('dev')} busy={busy === 'dev'} tint={theme.muted} />
          ) : null}
        </View>

        {err ? <Text style={styles.err}>{err}</Text> : null}

        {/* 로그인 전 정책 고지 + 링크(스토어 심사 요건) — 웹 게시본으로 연결. */}
        <Text style={styles.policyNote}>
          로그인 시{' '}
          <Text style={styles.policyLink} onPress={() => Linking.openURL('https://volleyball-jet-nine.vercel.app/terms')}>이용약관</Text>
          {' '}및{' '}
          <Text style={styles.policyLink} onPress={() => Linking.openURL('https://volleyball-jet-nine.vercel.app/privacy')}>개인정보처리방침</Text>
          에 동의하게 됩니다.
        </Text>

        {__DEV__ ? (
          <Text style={styles.notice}>* 개발 빌드입니다. 정식 빌드에서는 Google 로그인만 노출됩니다.</Text>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    wrap: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 36 },
    brandBox: { alignItems: 'center', gap: 10 },
    logoChip: { width: 84, height: 84, borderRadius: 24, backgroundColor: theme.accentGlass, borderWidth: 1.5, borderColor: theme.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
    logoEmoji: { fontSize: 42 },
    mark: { color: theme.text, fontSize: 32, fontWeight: '900', letterSpacing: 1 },
    tagline: { color: theme.muted, fontSize: 14.5 },
    btnGroup: { gap: 11 },
    btnGroupDim: { opacity: 0.45 }, // 연령 미확인 — 로그인 버튼 흐리게(진행 차단, AUTH §8)
    ageRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginBottom: -14 },
    ageLabel: { color: theme.text, fontSize: 14.5, fontWeight: '700' },
    // 구글 브랜드 버튼 — 흰 배경·다크 텍스트(가이드 준수, 어느 테마에서도 동일)
    googleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#FFFFFF', borderRadius: 14, paddingVertical: 15, borderWidth: 1, borderColor: '#DADCE0' },
    googleLabel: { color: '#1F1F1F', fontSize: 15.5, fontWeight: '700' },
    btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: theme.card, borderRadius: 14, paddingVertical: 15, borderWidth: 1, borderColor: theme.border },
    btnLabel: { color: theme.text, fontSize: 15.5, fontWeight: '800' },
    err: { color: theme.bad, fontSize: 13.5, textAlign: 'center', fontWeight: '700', marginTop: -20 },
    policyNote: { color: theme.muted, fontSize: 11.5, lineHeight: 18, textAlign: 'center', marginTop: -18 },
    policyLink: { color: theme.accent, textDecorationLine: 'underline', fontWeight: '700' },
    notice: { color: theme.muted, fontSize: 11.5, lineHeight: 18, textAlign: 'center' },
  }),
);
