import { Tabs } from 'expo-router';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: '#0f172a' },
        headerTintColor: '#f8fafc',
        tabBarStyle: { backgroundColor: '#0f172a', borderTopColor: '#1e293b' },
        tabBarActiveTintColor: '#38bdf8',
        tabBarInactiveTintColor: '#64748b',
        sceneStyle: { backgroundColor: '#0f172a' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: '대시보드', tabBarLabel: '구단' }} />
      <Tabs.Screen name="squad" options={{ title: '선수단', tabBarLabel: '선수단' }} />
      <Tabs.Screen name="schedule" options={{ title: '일정', tabBarLabel: '일정' }} />
      <Tabs.Screen name="office" options={{ title: '단장 업무', tabBarLabel: '단장실' }} />
      <Tabs.Screen name="history" options={{ title: '기록', tabBarLabel: '기록' }} />
    </Tabs>
  );
}
