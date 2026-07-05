// 성장 리포트 모달 (TRAINING §성장리포트, 2026-07-04 사용자 요청) — 날짜 진행 후 내 팀 종합 스탯 변화를
// "누가·어떤 스탯이 +N(초록)/−N(빨강)" 으로 보여줘 성장 체감을 준다(GPT ②③ 피드백). 엔진 무변경(diff 표시만).
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Popup } from './Popup';
import { Button, PosTag, theme } from './Screen';
import { PlayerAvatar } from './PlayerAvatar';
import { themedStyles } from './theme';
import type { PlayerGrowth } from '../data/growthReport';

export function GrowthReportModal({ visible, report, onClose }: { visible: boolean; report: PlayerGrowth[]; onClose: () => void }) {
  const ups = report.reduce((n, p) => n + p.deltas.filter((d) => d.delta > 0).length, 0);
  const downs = report.reduce((n, p) => n + p.deltas.filter((d) => d.delta < 0).length, 0);
  return (
    <Popup visible={visible} onRequestClose={onClose}>
      <Text style={styles.title}>🏋️ 훈련 성과</Text>
      <Text style={styles.sub}>
        지난 기간 우리 선수들의 성장·변화
        {ups + downs > 0 ? <Text>{'  '}
          {ups > 0 ? <Text style={{ color: theme.good, fontWeight: '800' }}>▲{ups}</Text> : null}
          {ups > 0 && downs > 0 ? ' ' : ''}
          {downs > 0 ? <Text style={{ color: theme.bad, fontWeight: '800' }}>▼{downs}</Text> : null}
        </Text> : null}
      </Text>
      <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 10 }}>
        {report.map((p) => (
          <View key={p.id} style={styles.row}>
            <View style={styles.head}>
              <PlayerAvatar id={p.id} size={34} />
              <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
              <PosTag pos={p.position} solid compact />
            </View>
            <View style={styles.chips}>
              {p.deltas.map((d, i) => {
                const up = d.delta > 0;
                const c = up ? theme.good : theme.bad;
                return (
                  <View key={i} style={[styles.chip, { borderColor: c + '66', backgroundColor: c + '1A' }]}>
                    <Text style={styles.chipLabel}>{d.label}</Text>
                    <Text style={styles.chipFrom}>{d.from}</Text>
                    <Text style={[styles.chipArrow, { color: c }]}>→</Text>
                    <Text style={[styles.chipTo, { color: c }]}>{d.to}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
      <Button label="확인" onPress={onClose} />
    </Popup>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  title: { color: theme.text, fontSize: 19, fontWeight: '900' },
  sub: { color: theme.muted, fontSize: 13, marginTop: -4 },
  row: { backgroundColor: theme.cardAlt, borderRadius: 12, padding: 12, gap: 8, borderWidth: 1, borderColor: theme.border },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: theme.text, fontSize: 15, fontWeight: '800', flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  chipLabel: { color: theme.text, fontSize: 12.5, fontWeight: '700', marginRight: 2 },
  chipFrom: { color: theme.muted, fontSize: 12.5, fontWeight: '700' },
  chipArrow: { fontSize: 12.5, fontWeight: '900' },
  chipTo: { fontSize: 13, fontWeight: '900' },
}));
