import type { ComponentProps } from 'react';
import { Redirect, Tabs } from 'expo-router';
import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { theme } from '../../components/Screen';
import { useGameStore } from '../../store/useGameStore';

type IoniconName = ComponentProps<typeof Ionicons>['name'];
const tabIcon = (name: IoniconName) =>
  ({ color, size }: { color: string; size: number }) => <Ionicons name={name} size={size} color={color} />;

export default function TabsLayout() {
  const hydrated = useGameStore((s) => s.hydrated);
  const selectedTeamId = useGameStore((s) => s.selectedTeamId);

  // 저장 데이터 로드 전: 빈 화면(깜빡임 방지)
  if (!hydrated) return <View style={{ flex: 1, backgroundColor: theme.bg }} />;

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
      <Tabs.Screen name="index" options={{ title: '대시보드', tabBarLabel: '구단', tabBarIcon: tabIcon('home-outline') }} />
      <Tabs.Screen name="schedule" options={{ title: '일정', tabBarLabel: '일정', tabBarIcon: tabIcon('calendar-outline') }} />
      <Tabs.Screen name="squad" options={{ title: '선수단', tabBarLabel: '선수단', tabBarIcon: tabIcon('people-outline') }} />
      <Tabs.Screen name="office" options={{ title: '단장실', tabBarLabel: '단장실', tabBarIcon: tabIcon('briefcase-outline') }} />
      <Tabs.Screen name="history" options={{ title: '기록', tabBarLabel: '기록', tabBarIcon: tabIcon('trophy-outline') }} />
    </Tabs>
  );
}
