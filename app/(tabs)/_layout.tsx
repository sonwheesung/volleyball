import type { ComponentProps } from 'react';
import { Redirect, Tabs } from 'expo-router';
import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { theme } from '../../components/Screen';
import { useGameStore } from '../../store/useGameStore';

type IoniconName = ComponentProps<typeof Ionicons>['name'];
// 선택된 탭은 채워진 아이콘(filled), 나머지는 outline — 색만이 아니라 모양으로도 선택을 확실히 표시
const tabIcon = (outline: IoniconName, filled: IoniconName) =>
  ({ color, size, focused }: { color: string; size: number; focused: boolean }) =>
    <Ionicons name={focused ? filled : outline} size={size} color={color} />;

export default function TabsLayout() {
  const hydrated = useGameStore((s) => s.hydrated);
  const onboarded = useGameStore((s) => s.onboarded);
  const selectedTeamId = useGameStore((s) => s.selectedTeamId);

  // 저장 데이터 로드 전: 빈 화면(깜빡임 방지)
  if (!hydrated) return <View style={{ flex: 1, backgroundColor: theme.bg }} />;

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
        tabBarStyle: { backgroundColor: theme.card, borderTopColor: theme.border },
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
      <Tabs.Screen name="history" options={{ title: '기록', tabBarLabel: '기록', tabBarIcon: tabIcon('trophy-outline', 'trophy') }} />
    </Tabs>
  );
}
