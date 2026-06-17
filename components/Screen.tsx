import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { displayOvr } from '../engine/overall';

/** 감독 성향 한글 라벨 — 여러 화면 공유 */
export const STYLE_LABEL = { attack: '공격형', defense: '수비형', balanced: '밸런스' } as const;

// KOVO 스타일 타일(밝고 깔끔) 디자인 시스템 — 2026-06-15 라이트 테마 전환
export const theme = {
  bg: '#F4F7FB',       // 부드러운 오프화이트
  card: '#FFFFFF',     // 순백 카드
  cardAlt: '#EEF1F6',  // 트랙·세그먼트 배경
  text: '#15202B',     // 잉크
  muted: '#8A94A6',    // 보조 텍스트
  accent: '#10B9A6',   // 틸 민트(프라이머리)
  good: '#16B07D',     // 승/긍정
  warn: '#F2A93B',     // 주의
  bad: '#FF6B5A',      // 워키 코랄(패/위험·외국인)
  elite: '#3B82F6',    // OVR 85+ 엘리트(틸·녹과 구분되는 블루칩)
  border: '#E6EAF0',   // 헤어라인
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

/** OVR 진행호 링 배지 (값에 따라 색·채움) — 스타일타일의 원형 레이팅 링 */
export function OvrBadge({ value, size = 46 }: { value: number; size?: number }) {
  // value는 raw OVR(overall/teamOverall) — 표시 스케일로 스트레치해 색·링·숫자에 일괄 반영.
  // 호출부는 항상 raw를 넘긴다(이중 변환 금지). 색 임계값은 스트레치된 값 기준이라 의미가 또렷.
  const v = displayOvr(value);
  const color = v >= 85 ? theme.elite : v >= 72 ? theme.accent : v >= 60 ? theme.warn : theme.muted;
  const stroke = size >= 56 ? 5 : 4;
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const frac = Math.max(0.04, Math.min(1, v / 100));
  return (
    <View style={[styles.ovr, { width: size, height: size }]}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.cardAlt} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeLinecap="round"
          strokeDasharray={`${frac * C} ${C}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Text style={[styles.ovrText, { color, fontSize: size >= 56 ? 19 : 15 }]}>{v}</Text>
    </View>
  );
}

const POS_LABEL: Record<string, string> = {
  S: '세터', OH: '아웃사이드', OP: '아포짓', MB: '미들', L: '리베로',
};
const POS_COLOR: Record<string, string> = {
  S: '#36BE9A', OH: '#0E9C8C', OP: '#FF6B5A', MB: '#8B7CF0', L: '#C8961F',
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
  card: {
    backgroundColor: theme.card, borderRadius: 18, padding: 16, gap: 8,
    borderWidth: 1, borderColor: theme.border,
    shadowColor: '#1B2A4A', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  muted: { color: theme.muted, fontSize: 14, lineHeight: 20 },
  btn: { borderRadius: 999, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: theme.accent },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: theme.accent },
  btnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  ovr: { alignItems: 'center', justifyContent: 'center' },
  ovrText: { fontWeight: '900' },
  pos: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  posText: { fontSize: 12, fontWeight: '800' },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statLabel: { color: theme.muted, fontSize: 13, width: 64 },
  statVal: { color: theme.text, fontSize: 13, fontWeight: '700', width: 28, textAlign: 'right' },
  barTrack: { flex: 1, height: 8, backgroundColor: theme.cardAlt, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
