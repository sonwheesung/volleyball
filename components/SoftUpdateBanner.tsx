// 소프트 업데이트 배너 (BACKEND_SYSTEM §13.16) — latestVersion 미만일 때 대시보드 상단에 안내(진입 차단 아님).
// 강제(minVersion)는 BootGate가 이미 하드 게이트. 관전형 무푸시 — 닫으면 그 latest는 재노출 안 함.
import Constants from 'expo-constants';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { theme, themedStyles } from './Screen';
import { useServerConfig } from '../store/useServerConfig';
import { useAuthStore } from '../store/useAuthStore';
import { needsSoftUpdate } from '../lib/bootstrap';

export function SoftUpdateBanner() {
  const boot = useServerConfig((s) => s.boot);
  const dismissed = useAuthStore((s) => s.dismissedUpdateVersion);
  const dismissUpdate = useAuthStore((s) => s.dismissUpdate);
  const appVer = (Constants.expoConfig?.version as string) ?? '0.0.0';

  if (!boot || !needsSoftUpdate(appVer, boot.version)) return null;
  const latest = boot.version.latest;
  if (latest && dismissed === latest) return null; // 이 버전은 이미 닫음
  const url = (Platform.OS === 'ios' ? boot.version.iosUrl : boot.version.androidUrl) || null; // 애플 미준비면 null → 안내만

  return (
    <View style={styles.bar}>
      <Ionicons name="arrow-up-circle-outline" size={18} color={theme.accent} />
      <Text style={styles.txt} numberOfLines={2}>새 버전이 있어요. 업데이트하면 최신 기능을 쓸 수 있습니다.</Text>
      {url ? (
        <Pressable onPress={() => Linking.openURL(url).catch(() => {})} style={({ pressed }) => [styles.btn, pressed && { opacity: 0.8 }]}>
          <Text style={styles.btnTxt}>업데이트</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={() => latest && dismissUpdate(latest)} hitSlop={8} style={styles.x}>
        <Ionicons name="close" size={16} color={theme.muted} />
      </Pressable>
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    bar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.accentGlass, borderWidth: 1, borderColor: theme.accent + '66', borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12, marginBottom: 10 },
    txt: { flex: 1, color: theme.text, fontSize: 12.5, fontWeight: '600', lineHeight: 16 },
    btn: { backgroundColor: theme.accent, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 },
    btnTxt: { color: '#04150E', fontSize: 12.5, fontWeight: '900' },
    x: { padding: 2 },
  }),
);
