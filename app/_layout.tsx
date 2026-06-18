import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Text, View } from 'react-native';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { theme } from '../components/Screen';

// 전역 기본 폰트 = Pretendard(가변). 인스턴스의 fontWeight가 굵기 축을 구동한다.
// (RN Text.defaultProps — 전 화면 Text를 건드리지 않고 한 번에 적용)
const TextDefaults = Text as unknown as { defaultProps?: { style?: unknown } };
TextDefaults.defaultProps = TextDefaults.defaultProps ?? {};
TextDefaults.defaultProps.style = { fontFamily: 'Pretendard' };

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Pretendard: require('../assets/fonts/PretendardVariable.ttf'),
  });
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: theme.bg }} />; // 폰트 로드 전(깜빡임 방지)

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.bg },
          headerTintColor: theme.text,
          headerTitleStyle: { fontWeight: '800' },
          contentStyle: { backgroundColor: theme.bg },
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
        <Stack.Screen name="fa" options={{ title: 'FA 센터' }} />
        <Stack.Screen name="draft" options={{ title: '신인 드래프트' }} />
        <Stack.Screen name="exhibition" options={{ title: '테스트 경기' }} />
        <Stack.Screen name="achievements" options={{ title: '업적' }} />
        <Stack.Screen name="records" options={{ title: '통산 순위' }} />
        <Stack.Screen name="settings" options={{ title: '설정' }} />
        <Stack.Screen name="supporter" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="credits" options={{ title: '크레딧' }} />
        <Stack.Screen name="debug-court" options={{ title: '보드 위치 검증' }} />
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
    </SafeAreaProvider>
  );
}
