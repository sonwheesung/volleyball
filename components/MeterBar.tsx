// 트랙 + % 채움 막대 — 예산/진행/게이지 공용(2026-07-12 추출).
// 인라인 구현을 그대로 옮긴 것(무회귀): 트랙(라운드 height/2 + overflow hidden)이 채움을 클립,
// 채움은 자체 라운드 없음(staff 예산바·achievements 진행바와 동일 룩).
// pct 계산·색 분기(예: 예산 비율 색)는 호출부에 두고, 계산된 pct/color만 넘긴다.
import { View } from 'react-native';
import { theme } from './theme';

/** 트랙+채움 막대. pct 0~100(호출부에서 클램프), color=채움색, height 기본 8, track 기본 theme.cardAlt. */
export function MeterBar({ pct, color, height = 8, track }: { pct: number; color: string; height?: number; track?: string }) {
  return (
    <View style={{ height, backgroundColor: track ?? theme.cardAlt, borderRadius: height / 2, overflow: 'hidden' }}>
      <View style={{ width: `${pct}%`, height, backgroundColor: color }} />
    </View>
  );
}
