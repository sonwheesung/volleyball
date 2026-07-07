// 예상 역할 배지 — 주전(good)·리베로(gold, 주전 리베로라 구분 색)·벤치(muted).
// squad statusTag pill과 같은 시각 언어. 전지훈련(training-camp)·FA 보호명단(fa)이 공유 —
// buildLineup 결과를 그대로 뱃지로 보여주는 단일 프레젠테이션(로직은 각 화면이 도출).
import { StyleSheet, Text, View } from 'react-native';
import { theme, themedStyles } from './Screen';

export function RoleBadge({ role }: { role?: '주전' | '리베로' }) {
  const c = role === '주전' ? theme.good : role === '리베로' ? theme.gold : theme.muted;
  const label = role ?? '벤치';
  return (
    <View style={[styles.roleBadge, { borderColor: c, backgroundColor: c + '22' }]}>
      <Text style={[styles.roleBadgeTxt, { color: c }]}>{label}</Text>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  roleBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5, borderWidth: 1 },
  roleBadgeTxt: { fontSize: 11, fontWeight: '800' },
}));
