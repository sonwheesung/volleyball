// 라우트 에러 폴백 (SEASON_SYSTEM §5.6.3 ⑤ · UI-50 ⑦) — expo-router 6의 route-level `export const ErrorBoundary`.
//
// 왜: 전 코드베이스에 ErrorBoundary가 0건이라, 화면 하나가 render throw하면 **앱 프로세스가 죽었다**(EC-UI-04).
//   2026-07-24 FA 센터 렌더 크래시(P0 a04c0bc)가 오프시즌 소프트락으로 번진 근본 원인이 이것 — 허브(우회로)는
//   증상 대응이고, 이 폴백이 원인 봉인이다.
// 규칙: ① 폴백에서 **반드시 일정으로 나갈 수 있어야** 한다(그게 소프트락 방지의 핵심)
//       ② 에러를 삼키지 말고 **diag(#44 진단 로그)** 에 남긴다 — 문의 스냅샷에 잡히게
//       ③ 폴백 자신은 최소 의존(Screen·테마 훅·네비게이션 컨텍스트 훅 없이) — 루트 레이아웃이 죽어도 그려져야 하므로
//          내비게이션은 훅이 아니라 expo-router의 **명령형 `router` 싱글턴**을 쓴다.
import { Component, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { logError } from '../lib/log';
import { diag } from '../lib/deviceLog';

// 폴백은 테마 토글에 반응할 필요가 없고(에러 상태), theme 객체 접근 자체가 실패할 수도 있어 픽셀 고정색.
const INK = '#F2F5FA';
const MUTED = '#9FB0C4';
const BG = '#0B1018';
const ACCENT = '#19C2AE';

function seasonTag(): number {
  try {
    // 스토어 접근 자체가 실패할 수 있는 상황(수화 전·모듈 초기화 실패)이라 방어적으로.
    const mod = require('../store/useGameStore') as { useGameStore: { getState: () => { season: number } } };
    return mod.useGameStore.getState().season;
  } catch { return -1; }
}

function goSchedule(): void {
  try {
    if (router.canDismiss?.()) router.dismissAll();
  } catch { /* 스택이 없으면 무시 */ }
  try { router.replace('/(tabs)/schedule'); } catch (e) { logError('errorBoundary.goSchedule', e); }
}

/** expo-router가 라우트에 주입하는 폴백. `export const ErrorBoundary = RouteErrorBoundary` 로 각 라우트에서 재노출. */
export function RouteErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }): ReactNode {
  // 렌더 중 로깅 — 폴백은 오류당 한 번만 마운트되므로 중복 적재 위험이 낮고, effect보다 이르게 남는다.
  logError('screen.render', error);
  diag(seasonTag(), 'crash', `화면 렌더 실패: ${error?.message ?? String(error)}`, { stack: String(error?.stack ?? '').slice(0, 1200) });

  return (
    <View style={styles.wrap}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.mark}>⚠️</Text>
        <Text style={styles.title}>이 화면을 여는 중 문제가 발생했습니다</Text>
        <Text style={styles.sub}>
          일정으로 돌아가면 게임은 그대로 이어집니다. 다른 오프시즌 화면도 계속 열 수 있어요.
        </Text>
        <Text style={styles.detail} numberOfLines={4}>{error?.message ?? '알 수 없는 오류'}</Text>
        <Pressable style={styles.btn} onPress={goSchedule} accessibilityRole="button">
          <Text style={styles.btnTxt}>일정으로 돌아가기</Text>
        </Pressable>
        <Pressable style={styles.ghost} onPress={() => { void retry(); }} accessibilityRole="button">
          <Text style={styles.ghostTxt}>다시 시도</Text>
        </Pressable>
        <Text style={styles.note}>이 오류는 진단 기록에 남았습니다. 설정 → 문의하기로 보내주시면 도움이 됩니다.</Text>
      </ScrollView>
    </View>
  );
}

/** 라우트 파일에서 `export { ErrorBoundary }` 로 재노출하는 이름. */
export const ErrorBoundary = RouteErrorBoundary;

/** 루트(_layout)용 클래스 경계 — expo-router가 레이아웃 자식 트리의 throw를 여기로 넘긴다.
 *  라우트별 ErrorBoundary가 없는 화면까지 전역으로 덮는 안전망. */
export class GlobalErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { logError('app.global', error); }
  render() {
    if (this.state.error) {
      return <RouteErrorBoundary error={this.state.error} retry={async () => { this.setState({ error: null }); }} />;
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: BG },
  body: { padding: 24, paddingTop: 72, gap: 10, alignItems: 'center' },
  mark: { fontSize: 44, marginBottom: 4 },
  title: { color: INK, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  sub: { color: MUTED, fontSize: 13.5, textAlign: 'center', lineHeight: 20 },
  detail: { color: MUTED, fontSize: 11.5, textAlign: 'center', marginTop: 6, opacity: 0.75 },
  btn: { marginTop: 18, backgroundColor: ACCENT + '29', borderColor: ACCENT, borderWidth: 1.5, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 30 },
  btnTxt: { color: ACCENT, fontSize: 15, fontWeight: '800' },
  ghost: { marginTop: 8, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 26, borderWidth: 1, borderColor: '#2A3648' },
  ghostTxt: { color: MUTED, fontSize: 13.5, fontWeight: '700' },
  note: { color: MUTED, fontSize: 11.5, textAlign: 'center', marginTop: 18, opacity: 0.7 },
});
