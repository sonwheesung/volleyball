// 부팅 게이트 (AUTH_SYSTEM §4) — 앱 진입 순서: 점검 차단 → 강제 버전 차단 → 로그인 벽 → 게임.
// 판정은 서버 /api/bootstrap 응답 기준(앱 로컬 신뢰 금지). 오프라인이면 게이트 스킵(캐시 세션 진입 — online-first ≠ online-only).
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Constants from 'expo-constants';
import { ActivityIndicator, AppState, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Loading, Screen, theme, themedStyles } from './Screen';
import { getBootstrap, type BootstrapData } from '../lib/server';
import { belowVersion } from '../lib/bootstrap';
import { useAuthStore } from '../store/useAuthStore';
import { useGameStore } from '../store/useGameStore';
import { useServerConfig } from '../store/useServerConfig';
import { LoginScreen } from './LoginScreen';
import { AnnouncementModal } from './AnnouncementModal';
import { useSpotlightActive } from './Spotlight';
import { usePathname } from 'expo-router';

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
  const scopeUser = useGameStore((s) => s.saveScopeUserId); // 현재 로드된 세이브 슬롯의 계정(§7.4 함정 a 게이트)
  const readAnnouncements = useAuthStore((s) => s.readAnnouncements);
  const markAnnouncementsRead = useAuthStore((s) => s.markAnnouncementsRead);
  const pruneReadAnnouncements = useAuthStore((s) => s.pruneReadAnnouncements);
  const [boot, setBoot] = useState<BootstrapData | null | undefined>(undefined); // undefined=조회중, null=오프라인/실패(게이트 스킵)
  const [reloadKey, setReloadKey] = useState(0);
  const [annDismissed, setAnnDismissed] = useState(false); // 이번 실행에 공지 모달 닫음(다음 실행에 안 본 것만 재계산)
  // 공지 모달 보류 게이트(2026-07-21 사용자 보고 — 첫 실행 스포트라이트 온보딩 위에 공지가 겹쳐 깨짐):
  // 온보딩 경로(인트로·구단 선택)와 스포트라이트 팁 표시 중엔 모달을 띄우지 않는다. 읽음 처리 전이라
  // 보류일 뿐 유실 없음 — 튜토리얼이 끝나는 즉시 같은 실행 안에서 뜬다(§13.13 "진입 시" 정신 유지).
  const spotlightBusy = useSpotlightActive();
  const pathname = usePathname();
  const onboardingRoute = pathname.startsWith('/onboarding') || pathname.startsWith('/select-team');

  useEffect(() => {
    let settled = false;
    const settle = (v: BootstrapData | null) => { if (!settled) { settled = true; setBoot(v); useServerConfig.getState().setBoot(v); } }; // 배너 등이 재조회 없이 읽도록 캐시(§13.16)
    const timer = setTimeout(() => settle(null), 3000); // 오프라인/지연 시 게이트 스킵(캐시 세션 진입)
    getBootstrap()
      .then((r) => settle(r.ok ? r : null))
      .catch(() => settle(null));
    return () => { settled = true; clearTimeout(timer); };
  }, [reloadKey]);

  const retry = useCallback(() => { setBoot(undefined); setReloadKey((k) => k + 1); }, []);
  const appVer = (Constants.expoConfig?.version as string) ?? '0.0.0';

  // 다이아 지갑 캐시 리싱크(BACKEND §13.12 P0-3) — 로그인(userId 확보) 직후 + 앱 포그라운드 복귀 시 서버 잔액으로
  // 캐시를 맞추고 전지훈련 아웃박스를 정산한다. syncWallet은 userId 없으면 no-op(관전형 오프라인 무해).
  const userId = session?.userId;
  useEffect(() => {
    if (!userId) return;
    const sync = () => { void useGameStore.getState().syncWallet(); };
    sync();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') sync(); });
    return () => sub.remove();
  }, [userId]);

  // 읽음 목록 prune — 활성 공지 id와 교집합만 유지(만료 공지 id 무한증가 차단, §13.13).
  // 서버 응답 존재 시에만(빈 배열 포함) prune. 오프라인(boot=null)엔 스킵 — 응답 없는데 prune하면
  // 만료 아닌 공지 읽음까지 지워져 재노출된다(오프라인 보호).
  const activeAnns = boot?.announcements ?? [];
  useEffect(() => {
    if (boot) pruneReadAnnouncements((boot.announcements ?? []).map((a) => a.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot]);

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

  // ③.5 계정 슬롯 스코프 게이트(SAVE_SYSTEM §7.4 함정 a) — 세션이 바뀐 직후 switchSaveScope가 끝나기 전엔
  //   이전 계정 메모리 상태가 노출될 수 있다. 현재 로드된 슬롯이 이 세션 계정이 될 때까지 Loading으로 막는다.
  if (scopeUser !== session.userId) return <Loading variant="brand" />;

  // 통과 → 게임 + 안 본 활성 공지 모달(무푸시 — 진입 시에만, §13.13). 닫으면 표시분 읽음 처리.
  const unread = activeAnns.filter((a) => !readAnnouncements.includes(a.id));
  return (
    <>
      {children}
      {!annDismissed && unread.length && !spotlightBusy && !onboardingRoute ? (
        <AnnouncementModal items={unread} onClose={() => { markAnnouncementsRead(unread.map((a) => a.id)); setAnnDismissed(true); }} />
      ) : null}
    </>
  );
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
