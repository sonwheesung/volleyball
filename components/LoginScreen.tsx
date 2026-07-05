// 로그인 벽 (AUTH_SYSTEM §4) — 하드 게이트. 로그인 전엔 게임 진입 불가. 성공 시 BootGate가 session 감지→게임 전환.
// 구글: 네이티브 @react-native-google-signin → idToken → 서버 verifyGoogleIdToken(2026-07-05 실기기 연결).
//       개발자 로그인(dev)은 __DEV__ 빌드에만 노출(Expo Go/네이티브 미탑재 폴백). 애플은 iOS 정식 빌드 예정.
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, theme, themedStyles } from './Screen';
import { useAuthStore } from '../store/useAuthStore';

type Provider = 'google' | 'apple' | 'dev';

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

  const doSignIn = async (provider: Provider) => {
    setBusy(provider);
    setErr(null);
    const r = await signIn(provider);
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
          <Text style={styles.tagline}>구단주의 100년, 지금 시작합니다</Text>
        </View>

        <View style={styles.btnGroup}>
          <ProviderButton icon="logo-google" label="Google로 계속하기" onPress={() => doSignIn('google')} busy={busy === 'google'} />
          {Platform.OS === 'ios' ? (
            <ProviderButton icon="logo-apple" label="Apple로 계속하기" onPress={() => doSignIn('apple')} busy={busy === 'apple'} />
          ) : null}
          {__DEV__ ? (
            <ProviderButton icon="construct-outline" label="개발자 로그인" onPress={() => doSignIn('dev')} busy={busy === 'dev'} tint={theme.muted} />
          ) : null}
        </View>

        {err ? <Text style={styles.err}>{err}</Text> : null}

        <Text style={styles.notice}>
          로그인하면 다이아·구매 내역이 계정에 안전하게 보관되어 기기를 바꿔도 이어집니다.
          {__DEV__ ? '\n* 개발 빌드입니다 — 정식 빌드에서는 Google 로그인만 노출됩니다.' : ''}
        </Text>
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
    btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: theme.card, borderRadius: 14, paddingVertical: 15, borderWidth: 1, borderColor: theme.border },
    btnLabel: { color: theme.text, fontSize: 15.5, fontWeight: '800' },
    err: { color: theme.bad, fontSize: 13.5, textAlign: 'center', fontWeight: '700', marginTop: -20 },
    notice: { color: theme.muted, fontSize: 11.5, lineHeight: 18, textAlign: 'center' },
  }),
);
