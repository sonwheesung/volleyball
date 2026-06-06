import { Redirect, Tabs } from 'expo-router';
import { View } from 'react-native';
import { theme } from '../../components/Screen';
import { useGameStore } from '../../store/useGameStore';

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
        tabBarStyle: { backgroundColor: theme.bg, borderTopColor: theme.border },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.muted,
        sceneStyle: { backgroundColor: theme.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: '대시보드', tabBarLabel: '구단' }} />
      <Tabs.Screen name="schedule" options={{ title: '일정', tabBarLabel: '일정' }} />
      <Tabs.Screen name="squad" options={{ title: '선수단', tabBarLabel: '선수단' }} />
      <Tabs.Screen name="office" options={{ title: '단장 업무', tabBarLabel: '단장실' }} />
      <Tabs.Screen name="history" options={{ title: '기록', tabBarLabel: '기록' }} />
    </Tabs>
  );
}
