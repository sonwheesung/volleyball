import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface ScreenProps {
  title?: string;
  children?: ReactNode;
}

/** 다크 테마 + SafeArea 하단 패딩을 공유하는 기본 화면 래퍼 */
export function Screen({ title, children }: ScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
    >
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {children}
    </ScrollView>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 16, gap: 12 },
  title: { color: '#f8fafc', fontSize: 22, fontWeight: '700', marginBottom: 4 },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    gap: 6,
  },
  muted: { color: '#94a3b8', fontSize: 14, lineHeight: 20 },
});
