import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFonts } from 'expo-font';
import { SafeAreaProvider, initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
import { ThemeProvider, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { theme, useThemeMode } from '../components/Screen';
import { loadThemeMode } from '../components/theme';
import { SpotlightProvider } from '../components/Spotlight';
import { IntroSplash } from '../components/IntroSplash';
import { BootGate } from '../components/BootGate';
import { DialogHost } from '../components/AppDialog';
import { MockAdHost } from '../components/MockAdHost';
import { useGameStore } from '../store/useGameStore';
import { initIap } from '../lib/iap';
import { initAds, IS_MOCK_AD_ENV } from '../lib/ads';
import { initBgm, startBgm, setBgmVolume } from '../audio/bgm';
import { installErrorSink, installCrashHandler } from '../lib/deviceLog';
import { installImmersive } from '../lib/immersive';
import { installKoreanKeepAll } from '../lib/koreanLineBreak';
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

// 네비게이션 컨테이너(화면 뒤 바탕 = 전환/뒤로가기 슬라이드 중 노출되는 면)를 **현재 모드**에 맞춘다.
// 다크만 박제하면(구 NAV_THEME) 다크의 흰 깜박임은 막지만 **라이트 모드에선 이 다크 바탕이 검정으로 샜다**
// (화이트모드 기록 화면 뒤로가기 시 검은 화면, 사용자 보고 2026-07-04). 렌더에서 mode로 생성해 토글에 따라간다.
function makeNavTheme(mode: 'light' | 'dark') {
  const base = mode === 'light' ? DefaultTheme : DarkTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      background: theme.bg,
      card: theme.bg,
      text: theme.text,
      border: theme.border,
      primary: theme.accent,
    },
  };
}

// 전역 기본 폰트 = Pretendard(가변) + 기본 텍스트 색 = 밝은 잉크(theme.text).
// (RN Text.defaultProps — 전 화면 Text를 건드리지 않고 한 번에 적용)
// **색 기본값 중요(2026-06-28)**: RN Text는 색 미지정 시 검정 → 다크 배경에서 안 보인다. 기본을 밝은색으로
// 박아 "색 빠뜨린 텍스트"가 묻히는 걸 전역 차단(명시 색은 그대로 우선 — 코트 등 라이트 표면은 자체 색 보유).
const TextDefaults = Text as unknown as { defaultProps?: { style?: unknown; textBreakStrategy?: string } };
TextDefaults.defaultProps = TextDefaults.defaultProps ?? {};
TextDefaults.defaultProps.style = { fontFamily: 'Pretendard', color: theme.text };
// 줄바꿈을 **어절(단어) 단위**로(2026-06-30 사용자 요청).
// ⚠️ 구 방식 `textBreakStrategy='simple'`은 **실기기(RN0.81/Android/React19)에서 효과 없음** 확인(2026-07-04 에뮬 검증):
//   Android 라인브레이커는 breakStrategy와 무관하게 한글 음절 사이를 항상 끊을 수 있어 `구단주입|니다`처럼 쪼개졌다.
//   → 실제 keep-all은 아래 installKoreanKeepAll(WORD JOINER 삽입, lib/koreanLineBreak.ts)로 처리. 이 줄은 보조(무해)로 유지.
TextDefaults.defaultProps.textBreakStrategy = 'simple';
// 한글 어절 단위 줄바꿈(웹 word-break:keep-all 격) — JSX 런타임을 감싸 `<Text>` 문자열 자식의 인접 한글 사이에 U+2060 삽입.
installKoreanKeepAll(Text);

// 컴팩트 스택 헤더(2026-07-11 테스터 — native-stack 기본 툴바가 높고 headerStyle.height 미지원이라 커스텀).
// 총높이 = 상단인셋 + 44dp 툴바(탭 네비와 동일). 뒤로가기 + 제목만. _layout 인라인(별도 파일 import 이슈 회피).
function CompactStackHeader({ navigation, options, back }: NativeStackHeaderProps) {
  useThemeMode(); // 테마 토글 시 리렌더
  const insets = useSafeAreaInsets();
  const title = typeof options.headerTitle === 'string' ? options.headerTitle : (options.title ?? '');
  return (
    <View style={[hdrStyles.bar, { backgroundColor: theme.bg, paddingTop: insets.top, height: insets.top + 44 }]}>
      {back ? (
        <Pressable onPress={navigation.goBack} hitSlop={12} style={hdrStyles.back} accessibilityRole="button" accessibilityLabel="뒤로">
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
      ) : <View style={hdrStyles.pad} />}
      <Text style={[hdrStyles.title, { color: theme.text }]} numberOfLines={1}>{title}</Text>
    </View>
  );
}
const hdrStyles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  back: { padding: 6, marginRight: 2 },
  pad: { width: 12 },
  title: { fontSize: 18, fontWeight: '800', flex: 1 },
});

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
    initAds(); // AdMob SDK 초기화 + UMP 동의(매 실행, EEA만 폼 표시) — dev/미설치 graceful(MONETIZATION §3.2)
    installErrorSink(() => useGameStore.getState().season); // 오류를 진단 버퍼에 시즌 태그로(#44)
    installCrashHandler(); // 미처리 예외도 진단 버퍼에(BACKEND §13.20 ④) — 없으면 크래시가 스냅샷에 안 남음
    track('app_open'); // 세션 시작(ANALYTICS_PLAN — 리텐션 자동산출 근간)
    initBgm(); startBgm(); // 배경음악(SOUND_SYSTEM §2) — 루트 1회, 게임 실행 전체(인트로·로그인 포함). 경기 화면은 자체 suppress
    installImmersive(); // 안드로이드 시스템 내비바 표시 유지 — 전 화면, 포그라운드 복귀 시 재적용(사용자 요청 2026-07-12)
  }, []);
  // 저장된 BGM 볼륨을 반영(hydration 완료·설정 변경 시 반응적으로). 슬라이더 라이브는 setBgmVolume 직접, 커밋은 이 경로.
  const bgmVolume = useGameStore((s) => s.bgmVolume);
  useEffect(() => { setBgmVolume(bgmVolume); }, [bgmVolume]);
  if (!introDone) {
    return (
      <>
        <StatusBar style="light" />
        <IntroSplash ready={fontsLoaded && hydrated} onWarm={warmCachesForIntro} onDone={() => setIntroDone(true)} />
      </>
    );
  }

  return (
    <SafeAreaProvider key={mode} initialMetrics={initialWindowMetrics} style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar style={mode === 'light' ? 'dark' : 'light'} />
      <ThemeProvider value={makeNavTheme(mode)}>
      <SpotlightProvider>
      <BootGate>
      <Stack
        screenOptions={{
          // 헤더 컴팩트(2026-07-11 테스터 — 네이티브 스택 기본 툴바가 높음). native-stack은 headerStyle.height 미지원 →
          // 인라인 커스텀 헤더(총높이 상단인셋+44dp)로 대체. 탭 네비(insets.top+44)와 동일 높이.
          header: (props) => <CompactStackHeader {...props} />,
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
        <Stack.Screen name="champion-ceremony" options={{ title: '시상식' }} />
        <Stack.Screen name="awards-ceremony" options={{ title: '시상식' }} />
        <Stack.Screen name="training-camp" options={{ title: '전지훈련' }} />
        <Stack.Screen name="training-policy" options={{ title: '훈련 방침' }} />
        <Stack.Screen name="guide" options={{ title: '게임 가이드' }} />
        <Stack.Screen name="support" options={{ title: '문의하기' }} />
        <Stack.Screen name="announcements" options={{ title: '공지사항' }} />
        <Stack.Screen name="coupon" options={{ title: '쿠폰 입력' }} />
        <Stack.Screen name="terms" options={{ title: '이용약관' }} />
        <Stack.Screen name="policy" options={{ title: '운영정책' }} />
        <Stack.Screen name="privacy" options={{ title: '개인정보처리방침' }} />
        <Stack.Screen name="shop" options={{ title: '상점' }} />
        <Stack.Screen name="buy-diamonds" options={{ title: '다이아 구매' }} />
        <Stack.Screen name="season-recap" options={{ title: '시즌 결산' }} />
        <Stack.Screen name="season-recap-detail/[section]" options={{ title: '결산 상세' }} />
        <Stack.Screen name="season-start" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="tryout" options={{ title: '외국인 트라이아웃' }} />
        <Stack.Screen name="asian-tryout" options={{ title: '아시아쿼터 트라이아웃' }} />
        <Stack.Screen name="fa" options={{ title: 'FA 센터' }} />
        <Stack.Screen name="draft" options={{ title: '신인 드래프트' }} />
        <Stack.Screen name="draft-live" options={{ title: '라이브 드래프트' }} />
        <Stack.Screen name="enshrine" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="season-opening" options={{ headerShown: false, gestureEnabled: false }} />
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
      {IS_MOCK_AD_ENV && <MockAdHost />}{/* 테스트 전용 목 전면광고(MONETIZATION §3.2). 개발/Expo Go만 마운트 → 운영 릴리스엔 없음 */}
      </SpotlightProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
