import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { theme } from '../components/Screen';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.bg },
          headerTintColor: theme.text,
          headerTitleStyle: { fontWeight: '800' },
          contentStyle: { backgroundColor: theme.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="select-team" options={{ title: '구단 선택', headerBackVisible: false }} />
        <Stack.Screen name="team/[id]" options={{ title: '구단 정보' }} />
        <Stack.Screen name="player/[id]" options={{ title: '선수 정보' }} />
        <Stack.Screen name="coach/[id]" options={{ title: '감독 정보' }} />
        <Stack.Screen name="fa" options={{ title: 'FA 센터' }} />
        <Stack.Screen name="match/[id]" options={{ title: '경기', presentation: 'fullScreenModal' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
