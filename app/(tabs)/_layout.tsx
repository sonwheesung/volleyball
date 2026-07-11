import type { ComponentProps } from 'react';
import { useEffect } from 'react';
import { Redirect, Tabs, useRouter } from 'expo-router';
import { BackHandler, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Loading, theme } from '../../components/Screen';
import { showAlert } from '../../components/AppDialog';
import { useGameStore } from '../../store/useGameStore';

type IoniconName = ComponentProps<typeof Ionicons>['name'];
// 선택된 탭은 채워진 아이콘(filled), 나머지는 outline — 색만이 아니라 모양으로도 선택을 확실히 표시
const tabIcon = (outline: IoniconName, filled: IoniconName) =>
  ({ color, size, focused }: { color: string; size: number; focused: boolean }) =>
    <Ionicons name={focused ? filled : outline} size={size} color={color} />;

export default function TabsLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const hydrated = useGameStore((s) => s.hydrated);
  const onboarded = useGameStore((s) => s.onboarded);
  const selectedTeamId = useGameStore((s) => s.selectedTeamId);

  // 뒤로가기 앱 종료 확인(UI-35, Android 전용) — 탭 루트에서 더 갈 곳이 없을 때만 종료 다이얼로그.
  //   스택 화면(선수·계약 등)이 위에 있으면 canGoBack()=true → 기본 pop을 그대로 둔다(정상 뒤로가기 유지).
  //   iOS는 hardwareBackPress가 없어 무영향. 훅은 조기 return 전에 무조건 호출(hooks 규칙).
  useEffect(() => {
    const onBack = () => {
      if (router.canGoBack()) return false; // 스택 화면 위에 있음 → 기본 뒤로가기(pop)
      showAlert('게임을 종료할까요?', undefined, [
        { text: '계속하기', style: 'cancel' },
        { text: '종료', style: 'destructive', onPress: () => BackHandler.exitApp() },
      ]);
      return true; // 기본 동작(앱 즉시 종료) 차단 — 확인 후 exitApp
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [router]);

  // 저장 데이터 로드 전(AsyncStorage 복원 = 유일한 진짜 비동기 로드): 로딩 화면
  if (!hydrated) return <Loading message="저장된 시즌을 불러오는 중…" variant="brand" />;

  // 첫 실행 → 온보딩(게임 소개) → 구단 선택
  if (!onboarded) return <Redirect href="/onboarding" />;
  // 팀 미선택 → 구단 선택으로
  if (!selectedTeamId) return <Redirect href="/select-team" />;

  return (
    <Tabs
      screenOptions={{
        // 헤더 컴팩트(2026-07-11 테스터 — 기본 툴바가 높음). 총높이 = 상단인셋 + 44dp 툴바. 루트 Stack과 동일값(탭↔스택 일치).
        headerStyle: { backgroundColor: theme.bg, height: insets.top + 44 },
        headerTintColor: theme.text,
        headerTitleStyle: { fontWeight: '700', fontSize: 18 },
        // 설정 = 전 탭 공통 헤더 우측 톱니(2026-06-28) — 구단 대시보드 본문에 있던 "설정" 버튼을 옮김(유틸리티 분리)
        // 아이콘 크기(22)는 유지, 터치 영역만 확대(hitSlop 10→12 + paddingVertical 4→10) — 오탭 방지(UI polish).
        headerRight: () => (
          <Pressable hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} onPress={() => router.push('/settings')} style={{ paddingHorizontal: 14, paddingVertical: 10 }}>
            <Ionicons name="settings-outline" size={22} color={theme.text} />
          </Pressable>
        ),
        // 탭바 — 글래스(theme.card)는 반투명이라 바닥이 비쳐 지저분 → 솔리드로 또렷하게. 모드별(다크 #0E1521 / 라이트 #FFF, UI-25)
        //   하단 여백(UI-34·UI-40 정정): 몰입 모드(UI-40)가 시스템 내비바를 숨기면 insets.bottom=0이 돼 라벨이 화면 끝에
        //   붙는다(테스터 제보 2026-07-11) → inset과 무관한 **최소 하단 여백 16**을 보장(max로 제스처바 인셋도 존중).
        //   콘텐츠 높이 = height − padTop − padBottom ≈ 44(아이콘+라벨 여유).
        tabBarStyle: {
          backgroundColor: theme.tabBar,
          borderTopColor: theme.border,
          height: 60 + Math.max(insets.bottom, 16),
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 16) + 6,
        },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.muted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        sceneStyle: { backgroundColor: theme.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: '홈', tabBarLabel: '홈', tabBarIcon: tabIcon('home-outline', 'home') }} />
      <Tabs.Screen name="schedule" options={{ title: '일정', tabBarLabel: '일정', tabBarIcon: tabIcon('calendar-outline', 'calendar') }} />
      <Tabs.Screen name="squad" options={{ title: '선수단', tabBarLabel: '선수단', tabBarIcon: tabIcon('people-outline', 'people') }} />
      <Tabs.Screen name="office" options={{ title: '단장실', tabBarLabel: '단장실', tabBarIcon: tabIcon('briefcase-outline', 'briefcase') }} />
      <Tabs.Screen name="mypage" options={{ title: '마이페이지', tabBarLabel: '마이페이지', tabBarIcon: tabIcon('person-circle-outline', 'person-circle') }} />
    </Tabs>
  );
}
