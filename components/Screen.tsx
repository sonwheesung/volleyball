import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const theme = {
  bg: '#0f172a',
  card: '#1e293b',
  cardAlt: '#334155',
  text: '#f8fafc',
  muted: '#94a3b8',
  accent: '#38bdf8',
  good: '#4ade80',
  warn: '#fbbf24',
  bad: '#f87171',
  border: '#334155',
};

interface ScreenProps {
  title?: string;
  children?: ReactNode;
  scroll?: boolean;
}

/** 다크 테마 + SafeArea 패딩 기본 화면 래퍼 */
export function Screen({ title, children, scroll = true }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const pad = { paddingBottom: insets.bottom + 24 };
  if (!scroll) {
    return (
      <View style={[styles.root, styles.content, pad]}>
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {children}
      </View>
    );
  }
  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, pad]}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {children}
    </ScrollView>
  );
}

export function Card({ children, onPress }: { children: ReactNode; onPress?: () => void }) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={styles.card}>{children}</View>;
}

export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[styles.muted, style]}>{children}</Text>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.h2}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' ? styles.btnPrimary : styles.btnGhost,
        disabled && { opacity: 0.4 },
        pressed && !disabled && { opacity: 0.8 },
      ]}
    >
      <Text style={[styles.btnText, variant === 'ghost' && { color: theme.accent }]}>{label}</Text>
    </Pressable>
  );
}

/** OVR 숫자 배지 (값에 따라 색) */
export function OvrBadge({ value }: { value: number }) {
  const color = value >= 85 ? theme.good : value >= 72 ? theme.accent : value >= 60 ? theme.warn : theme.muted;
  return (
    <View style={[styles.ovr, { borderColor: color }]}>
      <Text style={[styles.ovrText, { color }]}>{value}</Text>
    </View>
  );
}

const POS_LABEL: Record<string, string> = {
  S: '세터', OH: '아웃사이드', OP: '아포짓', MB: '미들', L: '리베로',
};
const POS_COLOR: Record<string, string> = {
  S: '#a78bfa', OH: '#38bdf8', OP: '#f87171', MB: '#fbbf24', L: '#4ade80',
};

export function PosTag({ pos, full }: { pos: string; full?: boolean }) {
  return (
    <View style={[styles.pos, { backgroundColor: (POS_COLOR[pos] ?? theme.muted) + '33' }]}>
      <Text style={[styles.posText, { color: POS_COLOR[pos] ?? theme.muted }]}>
        {full ? POS_LABEL[pos] ?? pos : pos}
      </Text>
    </View>
  );
}

/** 0~100 스탯 막대 */
export function StatBar({ label, value }: { label: string; value: number }) {
  const color = value >= 80 ? theme.good : value >= 65 ? theme.accent : value >= 50 ? theme.warn : theme.bad;
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.statVal}>{value}</Text>
    </View>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={styles.rowBetween}>{children}</View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, gap: 12 },
  title: { color: theme.text, fontSize: 24, fontWeight: '800', marginBottom: 2 },
  h2: { color: theme.text, fontSize: 16, fontWeight: '700' },
  card: { backgroundColor: theme.card, borderRadius: 14, padding: 16, gap: 8 },
  muted: { color: theme.muted, fontSize: 14, lineHeight: 20 },
  btn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: theme.accent },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.accent },
  btnText: { color: '#06283d', fontSize: 16, fontWeight: '800' },
  ovr: { minWidth: 40, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8, borderWidth: 1.5, alignItems: 'center' },
  ovrText: { fontSize: 16, fontWeight: '800' },
  pos: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  posText: { fontSize: 12, fontWeight: '700' },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statLabel: { color: theme.muted, fontSize: 13, width: 64 },
  statVal: { color: theme.text, fontSize: 13, fontWeight: '700', width: 28, textAlign: 'right' },
  barTrack: { flex: 1, height: 8, backgroundColor: theme.cardAlt, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
