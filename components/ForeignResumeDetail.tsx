// 외국인/아시아쿼터 트라이아웃 이력 상세 (FOREIGN_SYSTEM §9) — 이전 리그 성적 + 스카우터 티어별 정보.
// 포텐 공개 없음(용병=완성형 렌탈). 드래프트 상세와 대칭 구조.
import { StyleSheet, Text, View } from 'react-native';
import { Muted, theme, themedStyles } from './Screen';
import { foreignResume } from '../data/foreignResume';
import type { Player } from '../types';

export function ForeignResumeDetail({ p, reveal }: { p: Player; reveal: number }) {
  const rz = foreignResume(p, reveal);
  return (
    <View style={styles.detail}>
      <Text style={styles.detailHead}>이전 리그 · {rz.league} <Text style={{ color: theme.muted }}>({rz.level})</Text></Text>
      <View style={styles.statWrap}>
        {rz.stats.map((s) => (
          <View key={s.key} style={styles.statChip}>
            <Text style={styles.statLabel}>{s.label}</Text>
            <Text style={styles.statVal}>{s.value}{s.unit === '%' ? '%' : <Text style={styles.statUnit}>{s.unit}</Text>}</Text>
          </View>
        ))}
      </View>

      {rz.recentForm !== null ? (
        <View style={styles.lineWrap}>
          <Text style={styles.kv}>최근 폼 <Text style={styles.kvV}>{rz.recentForm}</Text></Text>
          <Text style={styles.kv}>지난 시즌 출전 <Text style={styles.kvV}>{rz.matches}경기</Text></Text>
          <Text style={styles.kv}>국가대표 A매치 <Text style={styles.kvV}>{rz.caps}회</Text></Text>
        </View>
      ) : (
        <Muted style={{ fontSize: 11, marginTop: 6 }}>· 스카우터 등급 A 이상이면 최근 폼·출장·국가대표 경력이 공개됩니다.</Muted>
      )}

      {rz.injury !== null ? (
        <View style={styles.lineWrap}>
          {rz.awards && rz.awards.length > 0 ? <Text style={styles.kv}>수상 <Text style={[styles.kvV, { color: theme.gold }]}>{rz.awards.join(' · ')}</Text></Text> : null}
          <Text style={styles.kv}>부상 이력 <Text style={styles.kvV}>{rz.injury}</Text></Text>
          <Text style={styles.kv}>적응 전망 <Text style={styles.kvV}>{rz.adapt}</Text></Text>
          {rz.report ? rz.report.map((l, i) => <Text key={i} style={styles.reportLine}>· {l}</Text>) : null}
        </View>
      ) : (
        <Muted style={{ fontSize: 11, marginTop: 4 }}>· 스카우터 등급 S면 수상·부상 이력·적응 전망·상세 리포트까지 공개됩니다.</Muted>
      )}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  detail: { paddingHorizontal: 12, paddingBottom: 12, paddingTop: 2, borderTopWidth: 1, borderTopColor: theme.border },
  detailHead: { color: theme.muted, fontSize: 12, fontWeight: '800', marginBottom: 5, marginTop: 6 },
  statWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statChip: { borderWidth: 1, borderColor: theme.border, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 6, minWidth: 96 },
  statLabel: { color: theme.muted, fontSize: 11 },
  statVal: { color: theme.text, fontSize: 16, fontWeight: '800' },
  statUnit: { color: theme.muted, fontSize: 11, fontWeight: '600' },
  lineWrap: { marginTop: 8, gap: 3 },
  kv: { color: theme.muted, fontSize: 12 },
  kvV: { color: theme.text, fontWeight: '700' },
  reportLine: { color: theme.text, fontSize: 13, lineHeight: 19, marginTop: 2 },
}));
