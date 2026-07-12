// 3열(가변 2~4) 구분선 스탯 헤더 — tryout·asian-tryout 현황 카드 공용(2026-07-12 추출).
// 인라인 구현을 그대로 옮긴 것(무회귀): 셀 사이 얇은 세로 구분선, 스타일 동일.
import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme, themedStyles } from './theme';

/** 가로 N칸 스탯 헤더(칸 2~4). 각 셀 = 라벨 + 값(color로 값 색 오버라이드). 셀 사이 얇은 세로 구분선. */
export function StatTriad({ cells }: { cells: { label: string; value: string; color?: string }[] }) {
  return (
    <View style={styles.statHeader}>
      {cells.map((c, i) => (
        <Fragment key={i}>
          {i > 0 ? <View style={styles.statDivider} /> : null}
          <View style={styles.statCell}>
            <Text style={styles.statCellLabel}>{c.label}</Text>
            <Text style={[styles.statCellVal, c.color ? { color: c.color } : null]} numberOfLines={1}>{c.value}</Text>
          </View>
        </Fragment>
      ))}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  statHeader: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  statCell: { flex: 1, gap: 2 },
  statCellLabel: { color: theme.muted, fontSize: 11 },
  statCellVal: { color: theme.text, fontSize: 15, fontWeight: '800' },
  statDivider: { width: 1, alignSelf: 'stretch', backgroundColor: theme.border, marginHorizontal: 10 },
}));
