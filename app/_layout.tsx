import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, DarkTheme } from '@react-navigation/native';
import { theme, useThemeMode } from '../components/Screen';
import { loadThemeMode } from '../components/theme';
import { SpotlightProvider } from '../components/Spotlight';
import { IntroSplash } from '../components/IntroSplash';
import { BootGate } from '../components/BootGate';
import { DialogHost } from '../components/AppDialog';
import { useGameStore } from '../store/useGameStore';
import { initIap } from '../lib/iap';
import { installErrorSink } from '../lib/deviceLog';
import { track } from '../lib/analytics';
import { computeStandings } from '../data/standings';
import { leagueProduction } from '../data/production';
import { availableTeamPlayers } from '../data/injury';

// 인트로 게이지 100% 직전 무거운 워밍 — 운영 중 구단이 있으면 시즌 순위·생산·부상(dyn) 캐시를 미리 데운다.
// 엔진버전 범프(예: 체력 튜닝) 후 첫 진입은 저장 캐시가 무효화돼 1회 재계산(~수초)이 필요 — 그 비용을
// 대시보드 첫 렌더가 아니라 인트로 단계에서 치러 "100%인데 멈춤"을 없앤다(이후 진입은 즉시).
function warmCachesForIntro(): void {
  const s = useGameStore.getState();
  if (!s.selectedTeamId) return; // 신규(구단 미선택)는 워밍 불필요(선택 화면은 가벼움)
  try {
    computeStandings(Number.MAX_SAFE_INTEGER);
    leagueProduction(Number.MAX_SAFE_INTEGER);
    availableTeamPlayers(s.selectedTeamId, s.currentDay);
  } catch { /* 워밍 실패해도 진입은 진행(해당 화면이 폴백 재계산) */ }
}

// 네비게이션 컨테이너(화면 뒤 바탕)도 다크로 — 기본 흰색이라 화면 전환/뒤로가기 시 슬라이드되며 한 프레임
// 흰 바탕이 새어 깜박였다(사용자 보고 2026-06-28). card=헤더 바탕도 다크 동기. 전환은 slide_from_right(가로 슬라이드).
const NAV_THEME = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: theme.bg,
    card: theme.bg,
    text: theme.text,
    border: theme.border,
    primary: theme.accent,
  },
};

// 전역 기본 폰트 = Pretendard(가변) + 기본 텍스트 색 = 밝은 잉크(theme.text).
// (RN Text.defaultProps — 전 화면 Text를 건드리지 않고 한 번에 적용)
// **색 기본값 중요(2026-06-28)**: RN Text는 색 미지정 시 검정 → 다크 배경에서 안 보인다. 기본을 밝은색으로
// 박아 "색 빠뜨린 텍스트"가 묻히는 걸 전역 차단(명시 색은 그대로 우선 — 코트 등 라이트 표면은 자체 색 보유).
const TextDefaults = Text as unknown as { defaultProps?: { style?: unknown; textBreakStrategy?: string } };
TextDefaults.defaultProps = TextDefaults.defaultProps ?? {};
TextDefaults.defaultProps.style = { fontFamily: 'Pretendard', color: theme.text };
// 줄바꿈을 **어절(단어) 단위**로(2026-06-30 사용자 요청) — Android 기본 'highQuality'는 한글을 CJK로 보고
// 어절 중간에서도 끊어 긴 문장이 글자 단위로 쪼개졌다. 'simple'=공백(어절) 경계에서만 줄바꿈(웹 word-break:keep-all 격).
TextDefaults.defaultProps.textBreakStrategy = 'simple';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Pretendard: require('../assets/fonts/PretendardVariable.ttf'),
  });
  // 인트로 게이트(2026-06-28): 스파이크 일러스트 + 로딩 게이지. 실제 준비(폰트 로드 + 세이브 복원=hydrated)에
  // 연동해 100% 차오르면 진입. 이후엔 (tabs) 복원 로딩이 이미 끝나 있어 중복 로딩 없음.
  const hydrated = useGameStore((s) => s.hydrated);
  const [introDone, setIntroDone] = useState(false);
  const mode = useThemeMode(); // 테마 토글 시 리렌더 → key로 전 화면 리마운트(새 스타일 반영)
  // 전역 기본 텍스트 색을 현재 모드로(다크=밝은잉크 / 라이트=검정). 색 미지정 Text 폴백이 안 묻히게(리마운트 전에 갱신).
  TextDefaults.defaultProps!.style = { fontFamily: 'Pretendard', color: theme.text };
  // 앱 시작 1회 — 저장 테마 적용 + IAP 초기화 + 오류 싱크. loadThemeMode는 인트로 스플래시가 뜬 동안 완료(부팅 깜빡임 마스킹).
  useEffect(() => {
    loadThemeMode();
    initIap();
    installErrorSink(() => useGameStore.getState().season); // 오류를 진단 버퍼에 시즌 태그로(#44)
    track('app_open'); // 세션 시작(ANALYTICS_PLAN — 리텐션 자동산출 근간)
  }, []);
  if (!introDone) {
    return (
      <>
        <StatusBar style="light" />
        <IntroSplash ready={fontsLoaded && hydrated} onWarm={warmCachesForIntro} onDone={() => setIntroDone(true)} />
      </>
    );
  }

  return (
    <SafeAreaProvider key={mode}>
      <StatusBar style={mode === 'light' ? 'dark' : 'light'} />
      <ThemeProvider value={NAV_THEME}>
      <SpotlightProvider>
      <BootGate>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.bg },
          headerTintColor: theme.text,
          headerTitleStyle: { fontWeight: '800' },
          contentStyle: { backgroundColor: theme.bg },
          animation: 'slide_from_right', // 가로 슬라이드(푸시=우→좌, 뒤로가기=좌→우 자동 역재생)
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="select-team" options={{ title: '구단 선택', headerBackVisible: false }} />
        <Stack.Screen name="team/[id]" options={{ title: '구단 정보' }} />
        <Stack.Screen name="player/[id]" options={{ title: '선수 정보' }} />
        <Stack.Screen name="coach/[id]" options={{ title: '감독 정보' }} />
        <Stack.Screen name="staff" options={{ title: '스태프 계약' }} />
        <Stack.Screen name="transactions" options={{ title: '시즌 중 FA 영입' }} />
        <Stack.Screen name="playoffs" options={{ title: '포스트시즌' }} />
        <Stack.Screen name="awards-ceremony" options={{ title: '시상식' }} />
        <Stack.Screen name="training-camp" options={{ title: '전지훈련' }} />
        <Stack.Screen name="guide" options={{ title: '게임 가이드' }} />
        <Stack.Screen name="support" options={{ title: '문의하기' }} />
        <Stack.Screen name="announcements" options={{ title: '공지사항' }} />
        <Stack.Screen name="coupon" options={{ title: '쿠폰 입력' }} />
        <Stack.Screen name="terms" options={{ title: '이용약관' }} />
        <Stack.Screen name="policy" options={{ title: '운영정책' }} />
        <Stack.Screen name="shop" options={{ title: '상점' }} />
        <Stack.Screen name="season-recap" options={{ title: '시즌 결산' }} />
        <Stack.Screen name="season-start" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="tryout" options={{ title: '외국인 트라이아웃' }} />
        <Stack.Screen name="asian-tryout" options={{ title: '아시아쿼터 트라이아웃' }} />
        <Stack.Screen name="fa" options={{ title: 'FA 센터' }} />
        <Stack.Screen name="draft" options={{ title: '신인 드래프트' }} />
        <Stack.Screen name="draft-live" options={{ title: '라이브 드래프트' }} />
        <Stack.Screen name="enshrine" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="exhibition" options={{ title: '테스트 경기' }} />
        <Stack.Screen name="achievements" options={{ title: '업적' }} />
        <Stack.Screen name="records" options={{ title: '통산 순위' }} />
        <Stack.Screen name="records-archive" options={{ title: '기록' }} />
        <Stack.Screen name="settings" options={{ title: '설정' }} />
        <Stack.Screen name="supporter" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="credits" options={{ title: '크레딧' }} />
        <Stack.Screen name="debug-court" options={{ title: '보드 위치 검증' }} />
        <Stack.Screen name="board-lab" options={{ title: '수비 위치 실험실' }} />
        <Stack.Screen name="audit" options={{ title: '영입 무결성 감사' }} />
        <Stack.Screen name="match/[id]" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
        <Stack.Screen name="matchresult/[id]" options={{ title: '경기 상세' }} />
        <Stack.Screen name="contracts" options={{ title: '계약 관리' }} />
        <Stack.Screen name="results" options={{ title: '경기 결과' }} />
        <Stack.Screen name="calendar" options={{ title: '일정' }} />
        <Stack.Screen name="standings" options={{ title: '리그 순위' }} />
        <Stack.Screen name="news" options={{ title: '리그 뉴스' }} />
        <Stack.Screen name="news/[id]" options={{ title: '뉴스' }} />
      </Stack>
      </BootGate>
      <DialogHost />{/* 전역 커스텀 다이얼로그(UI-21) — showAlert가 여기로 렌더. BootGate 밖: 로그인/점검 화면에서도 동작 */}
      </SpotlightProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
