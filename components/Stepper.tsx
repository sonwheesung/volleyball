// −/＋ 수치 스텝퍼(연봉·기간 등) — fa 오퍼 폼·contracts 재계약 빌더 공용(2026-07-12 추출).
// 인라인 구현을 그대로 옮긴 것(무회귀): 스타일·구조 동일.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme, themedStyles } from './theme';

/** −/＋ 스텝퍼 — 라벨 + 감소 버튼 + 값 + 증가 버튼. decOff/incOff로 각 끝단 비활성. */
export function Stepper({ label, display, onDec, onInc, decOff, incOff }: {
  label: string; display: string; onDec: () => void; onInc: () => void; decOff?: boolean; incOff?: boolean;
}) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepLabel}>{label}</Text>
      <Pressable onPress={onDec} disabled={decOff} hitSlop={6} style={[styles.stepBtn, decOff && styles.stepBtnOff]}>
        <Text style={styles.stepBtnTxt}>−</Text>
      </Pressable>
      <Text style={styles.stepVal}>{display}</Text>
      <Pressable onPress={onInc} disabled={incOff} hitSlop={6} style={[styles.stepBtn, incOff && styles.stepBtnOff]}>
        <Text style={styles.stepBtnTxt}>＋</Text>
      </Pressable>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepLabel: { color: theme.text, fontSize: 13, fontWeight: '700', width: 44 },
  stepBtn: {
    width: 34, height: 34, borderRadius: 9, borderWidth: 1, borderColor: theme.accent,
    backgroundColor: theme.accent + '18', alignItems: 'center', justifyContent: 'center',
  },
  stepBtnOff: { borderColor: theme.border, backgroundColor: 'transparent' },
  stepBtnTxt: { color: theme.text, fontSize: 18, fontWeight: '900', lineHeight: 20 },
  stepVal: { color: theme.text, fontSize: 14, fontWeight: '800', flex: 1, textAlign: 'center' },
}));
