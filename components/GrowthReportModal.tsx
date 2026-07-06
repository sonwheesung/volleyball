// 성장 리포트 모달 (TRAINING §성장리포트) — "내가 이 선수를 이렇게 키웠다"를 체감시키는 게 목적.
// 주인공 = **입단 이후 커리어 누적**(입단 OVR→현재 + 스탯별 누적). 이번 구간 성장은 작게, 노쇠는 조용히(관전형 철학).
// 엔진 무변경: growthReport(diff 표시)만 확장. career는 debut 스냅샷(생성 시 1회 기록) 있는 선수만.
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Popup } from './Popup';
import { Button, PosTag, theme } from './Screen';
import { PlayerAvatar } from './PlayerAvatar';
import { themedStyles } from './theme';
import type { PlayerGrowth, StatDelta } from '../data/growthReport';

const MAX_CARDS = 10; // 다일 점프·긴 로스터로 벽이 되지 않게 — 상위 성장선수만, 나머지는 한 줄로 축약(리뷰 반영)

// 성장 크기(정렬 키) — 커리어 OVR 상승 우선, 없으면 이번 구간 상승 스탯 수
const growthScore = (p: PlayerGrowth): number =>
  (p.career ? p.career.deltaOvr * 100 : 0) + p.deltas.filter((d) => d.delta > 0).length;

const join = (ds: StatDelta[]): string => ds.map((d) => `${d.label} ${d.delta > 0 ? '+' : ''}${d.delta}`).join(' · ');

export function GrowthReportModal({ visible, report, onClose }: { visible: boolean; report: PlayerGrowth[]; onClose: () => void }) {
  const sorted = useMemo(() => [...report].sort((a, b) => growthScore(b) - growthScore(a)), [report]);
  const shown = sorted.slice(0, MAX_CARDS);
  const rest = sorted.length - shown.length;
  const grewCount = report.filter((p) => (p.career ? p.career.deltaOvr > 0 : p.deltas.some((d) => d.delta > 0))).length;
  const agedCount = report.filter((p) => p.deltas.some((d) => d.delta < 0)).length;
  const [expanded, setExpanded] = useState(false);

  return (
    <Popup visible={visible} onRequestClose={onClose}>
      <Text style={styles.title}>📈 선수단 성장 리포트</Text>
      <Text style={styles.sub}>지난 경기 이후 선수단의 성장과 변화</Text>
      {grewCount > 0 ? (
        <Text style={styles.summary}>
          <Text style={{ color: theme.good, fontWeight: '900' }}>{grewCount}명</Text> 성장
          {agedCount > 0 ? <Text style={styles.summaryAged}>{'   ·   '}{agedCount}명 소폭 노쇠</Text> : null}
        </Text>
      ) : null}

      <ScrollView style={{ maxHeight: 400 }} contentContainerStyle={{ gap: 10 }}>
        {shown.map((p) => {
          const careerUps = p.career?.statDeltas.filter((d) => d.delta > 0) ?? [];
          const intervalUps = p.deltas.filter((d) => d.delta > 0);
          const intervalDowns = p.deltas.filter((d) => d.delta < 0);
          return (
            <View key={p.id} style={styles.row}>
              <View style={styles.head}>
                <PlayerAvatar id={p.id} size={34} />
                <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                <PosTag pos={p.position} solid compact />
                {p.career ? (
                  <View style={styles.hero}>
                    <Text style={styles.heroFrom}>입단 {p.career.debutOvr}</Text>
                    <Text style={styles.heroArrow}>→</Text>
                    <Text style={styles.heroTo}>{p.career.curOvr}</Text>
                    <Text style={[styles.heroDelta, { color: p.career.deltaOvr >= 0 ? theme.good : theme.bad }]}>
                      {p.career.deltaOvr >= 0 ? `▲${p.career.deltaOvr}` : `▼${-p.career.deltaOvr}`}
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* 입단 이후 누적 성장(주인공) — 성장 스탯만 강조 */}
              {careerUps.length ? (
                <View style={styles.careerBox}>
                  <Text style={styles.careerLabel}>입단 이후</Text>
                  <Text style={styles.careerStats} numberOfLines={2}>{join(careerUps)}</Text>
                </View>
              ) : null}

              {/* 이번 구간 성장 — 작게 */}
              {intervalUps.length ? (
                <Text style={styles.interval} numberOfLines={2}>
                  <Text style={styles.intervalTag}>이번  </Text>
                  {intervalUps.map((d, i) => (
                    <Text key={i} style={{ color: theme.good }}>{i ? '  ' : ''}▲ {d.label} +{d.delta}</Text>
                  ))}
                </Text>
              ) : null}

              {/* 노쇠 — 조용하게(작은 회색, 구분선 아래) */}
              {intervalDowns.length ? (
                <Text style={styles.aged} numberOfLines={2}>
                  ▼ {intervalDowns.map((d) => `${d.label} ${d.delta}`).join(' · ')}
                </Text>
              ) : null}
            </View>
          );
        })}

        {rest > 0 && !expanded ? (
          <Text style={styles.more} onPress={() => setExpanded(true)}>그 외 {rest}명도 성장했어요  ▾</Text>
        ) : null}
        {expanded ? sorted.slice(MAX_CARDS).map((p) => (
          <View key={p.id} style={styles.miniRow}>
            <Text style={styles.miniName} numberOfLines={1}>{p.name}</Text>
            {p.career ? (
              <Text style={[styles.miniDelta, { color: p.career.deltaOvr >= 0 ? theme.good : theme.bad }]}>
                입단 {p.career.debutOvr}→{p.career.curOvr} {p.career.deltaOvr >= 0 ? `▲${p.career.deltaOvr}` : `▼${-p.career.deltaOvr}`}
              </Text>
            ) : <Text style={styles.miniDelta}>{join(p.deltas.filter((d) => d.delta > 0))}</Text>}
          </View>
        )) : null}
      </ScrollView>
      <Button label="확인" onPress={onClose} />
    </Popup>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  title: { color: theme.text, fontSize: 19, fontWeight: '900' },
  sub: { color: theme.muted, fontSize: 13, marginTop: -2 },
  summary: { color: theme.text, fontSize: 13.5, fontWeight: '700', marginTop: 6, marginBottom: 2 },
  summaryAged: { color: theme.muted, fontSize: 12, fontWeight: '600' },
  row: { backgroundColor: theme.cardAlt, borderRadius: 12, padding: 12, gap: 6, borderWidth: 1, borderColor: theme.border },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: theme.text, fontSize: 15, fontWeight: '800', flexShrink: 1 },
  // 커리어 OVR 히어로(입단→현재) — 카드 우측, 델타가 주인공
  hero: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto' },
  heroFrom: { color: theme.muted, fontSize: 12, fontWeight: '700' },
  heroArrow: { color: theme.muted, fontSize: 12 },
  heroTo: { color: theme.text, fontSize: 16, fontWeight: '900' },
  heroDelta: { fontSize: 15, fontWeight: '900', marginLeft: 2 },
  // 입단 이후 누적 성장 — 강조 박스
  careerBox: { backgroundColor: theme.good + '14', borderRadius: 8, borderWidth: 1, borderColor: theme.good + '3A', paddingHorizontal: 10, paddingVertical: 7, gap: 1 },
  careerLabel: { color: theme.good, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.3 },
  careerStats: { color: theme.text, fontSize: 13.5, fontWeight: '800' },
  interval: { fontSize: 12, fontWeight: '700' },
  intervalTag: { color: theme.muted, fontSize: 11, fontWeight: '700' },
  aged: { color: theme.muted, fontSize: 11.5, fontWeight: '600', opacity: 0.75, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 5 },
  more: { color: theme.accent, fontSize: 13, fontWeight: '800', textAlign: 'center', paddingVertical: 8 },
  miniRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingVertical: 6, gap: 8 },
  miniName: { color: theme.text, fontSize: 13, fontWeight: '700', flexShrink: 1 },
  miniDelta: { fontSize: 12, fontWeight: '800' },
}));
