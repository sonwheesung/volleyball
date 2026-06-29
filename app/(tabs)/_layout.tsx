import type { ComponentProps } from 'react';
import { Redirect, Tabs, useRouter } from 'expo-router';
import { Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Loading, theme } from '../../components/Screen';
import { useGameStore } from '../../store/useGameStore';

type IoniconName = ComponentProps<typeof Ionicons>['name'];
// 선택된 탭은 채워진 아이콘(filled), 나머지는 outline — 색만이 아니라 모양으로도 선택을 확실히 표시
const tabIcon = (outline: IoniconName, filled: IoniconName) =>
  ({ color, size, focused }: { color: string; size: number; focused: boolean }) =>
    <Ionicons name={focused ? filled : outline} size={size} color={color} />;

export default function TabsLayout() {
  const router = useRouter();
  const hydrated = useGameStore((s) => s.hydrated);
  const onboarded = useGameStore((s) => s.onboarded);
  const selectedTeamId = useGameStore((s) => s.selectedTeamId);

  // 저장 데이터 로드 전(AsyncStorage 복원 = 유일한 진짜 비동기 로드): 로딩 화면
  if (!hydrated) return <Loading message="저장된 시즌을 불러오는 중…" variant="brand" />;

  // 첫 실행 → 온보딩(게임 소개) → 구단 선택
  if (!onboarded) return <Redirect href="/onboarding" />;
  // 팀 미선택 → 구단 선택으로
  if (!selectedTeamId) return <Redirect href="/select-team" />;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.bg },
        headerTintColor: theme.text,
        headerTitleStyle: { fontWeight: '800' },
        // 설정 = 전 탭 공통 헤더 우측 톱니(2026-06-28) — 구단 대시보드 본문에 있던 "설정" 버튼을 옮김(유틸리티 분리)
        headerRight: () => (
          <Pressable hitSlop={10} onPress={() => router.push('/settings')} style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
            <Ionicons name="settings-outline" size={22} color={theme.text} />
          </Pressable>
        ),
        // 탭바 — 글래스(theme.card)는 반투명이라 바닥이 비쳐 지저분 → 솔리드 다크로 또렷하게
        tabBarStyle: { backgroundColor: '#0E1521', borderTopColor: theme.border },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.muted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        sceneStyle: { backgroundColor: theme.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: '대시보드', tabBarLabel: '구단', tabBarIcon: tabIcon('home-outline', 'home') }} />
      <Tabs.Screen name="schedule" options={{ title: '일정', tabBarLabel: '일정', tabBarIcon: tabIcon('calendar-outline', 'calendar') }} />
      <Tabs.Screen name="squad" options={{ title: '선수단', tabBarLabel: '선수단', tabBarIcon: tabIcon('people-outline', 'people') }} />
      <Tabs.Screen name="office" options={{ title: '단장실', tabBarLabel: '단장실', tabBarIcon: tabIcon('briefcase-outline', 'briefcase') }} />
      <Tabs.Screen name="mypage" options={{ title: '마이페이지', tabBarLabel: '마이페이지', tabBarIcon: tabIcon('person-circle-outline', 'person-circle') }} />
    </Tabs>
  );
}
