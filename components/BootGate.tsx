// 부팅 게이트 (AUTH_SYSTEM §4) — 앱 진입 순서: 점검 차단 → 강제 버전 차단 → 로그인 벽 → 게임.
// 판정은 서버 /api/bootstrap 응답 기준(앱 로컬 신뢰 금지). 오프라인이면 게이트 스킵(캐시 세션 진입 — online-first ≠ online-only).
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Constants from 'expo-constants';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Loading, Screen, theme, themedStyles } from './Screen';
import { getBootstrap, type BootstrapData } from '../lib/server';
import { belowVersion } from '../lib/bootstrap';
import { useAuthStore } from '../store/useAuthStore';
import { LoginScreen } from './LoginScreen';

function GateScreen({ icon, title, body, actionLabel, onAction }: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; body: string; actionLabel: string; onAction: () => void }) {
  return (
    <Screen scroll={false}>
      <View style={styles.wrap}>
        <View style={styles.iconChip}><Ionicons name={icon} size={40} color={theme.accent} /></View>
        <Text style={styles.title}>{title}</Text>
        {body ? <Text style={styles.body}>{body}</Text> : null}
        <Pressable onPress={onAction} style={({ pressed }) => [styles.action, pressed && { opacity: 0.8 }]}>
          <Text style={styles.actionTxt}>{actionLabel}</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

export function BootGate({ children }: { children: ReactNode }) {
  const session = useAuthStore((s) => s.session);
  const authHydrated = useAuthStore((s) => s.hydrated);
  const [boot, setBoot] = useState<BootstrapData | null | undefined>(undefined); // undefined=조회중, null=오프라인/실패(게이트 스킵)
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let settled = false;
    const settle = (v: BootstrapData | null) => { if (!settled) { settled = true; setBoot(v); } };
    const timer = setTimeout(() => settle(null), 3000); // 오프라인/지연 시 게이트 스킵(캐시 세션 진입)
    getBootstrap()
      .then((r) => settle(r.ok ? r : null))
      .catch(() => settle(null));
    return () => { settled = true; clearTimeout(timer); };
  }, [reloadKey]);

  const retry = useCallback(() => { setBoot(undefined); setReloadKey((k) => k + 1); }, []);
  const appVer = (Constants.expoConfig?.version as string) ?? '0.0.0';

  if (!authHydrated || boot === undefined) return <Loading variant="brand" />;

  // ① 서버 점검 — 진입 차단
  if (boot && boot.maintenance.active) {
    return <GateScreen icon="build-outline" title={boot.maintenance.title || '서버 점검 중'} body={boot.maintenance.body || '더 나은 서비스를 위해 점검 중입니다. 잠시 후 다시 접속해 주세요.'} actionLabel="다시 시도" onAction={retry} />;
  }
  // ② 강제 업데이트 — 진입 차단
  if (boot && belowVersion(appVer, boot.version.min)) {
    const url = (Platform.OS === 'ios' ? boot.version.iosUrl : boot.version.androidUrl) || null;
    return <GateScreen icon="arrow-up-circle-outline" title="업데이트가 필요합니다" body={'원활한 플레이를 위해 최신 버전으로 업데이트해 주세요.'} actionLabel={url ? '지금 업데이트' : '확인'} onAction={() => { if (url) Linking.openURL(url).catch(() => {}); }} />;
  }
  // ③ 로그인 벽 — 세션 없으면 진입 불가(캐시 세션이면 오프라인도 통과)
  if (!session) return <LoginScreen />;

  // 통과 → 게임(소프트 업데이트 안내·공지는 게임 내에서 surface)
  return <>{children}</>;
}

const styles = themedStyles(() =>
  StyleSheet.create({
    wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 },
    iconChip: { width: 80, height: 80, borderRadius: 24, backgroundColor: theme.accentGlass, borderWidth: 1.5, borderColor: theme.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
    title: { color: theme.text, fontSize: 21, fontWeight: '900', textAlign: 'center' },
    body: { color: theme.muted, fontSize: 14.5, lineHeight: 22, textAlign: 'center' },
    action: { marginTop: 12, backgroundColor: theme.accentGlass, borderWidth: 1.5, borderColor: theme.accent, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 40 },
    actionTxt: { color: theme.accent, fontSize: 15.5, fontWeight: '800' },
  }),
);
