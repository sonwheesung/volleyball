// 성장 리포트 모달 (TRAINING §성장리포트) — 출시 퀄 정보 위계(2026-07-06 2차 UX 다듬기).
// 시선 흐름(세로): 이름(주인공) → OVR 변화(이름 아래) → 이번 변화(강조) → 누적 성장(참고) → 노쇠(가장 연하게).
// 스탯은 이름 먼저·숫자만 강조(점프력 ▲1). 담백한 관전형 톤: 큰 연출 없이 위계로만. 엔진/공식/데이터/결정론 무변경.
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Popup } from './Popup';
import { Button, PosTag, theme } from './Screen';
import { PlayerAvatar } from './PlayerAvatar';
import { themedStyles } from './theme';
import type { PlayerGrowth, StatDelta } from '../data/growthReport';

const MAX_CARDS = 10; // 다일 점프·긴 로스터로 벽이 되지 않게 — 상위 성장선수만, 나머지는 한 줄로 축약

const growthScore = (p: PlayerGrowth): number =>
  (p.career ? p.career.deltaOvr * 100 : 0) + p.deltas.filter((d) => d.delta > 0).length;

const upsOf = (ds: StatDelta[]) => ds.filter((d) => d.delta > 0);
const sig = (ds: StatDelta[]) => ds.map((d) => `${d.label}${d.delta}`).join('|'); // 이번==누적 중복 판정

/** 스탯 목록 — 이름(흰색) 먼저, 숫자만 강조(초록). 큰 폭(+3↑)은 숫자를 소폭 더 굵게. */
function StatList({ ups, styles, sub }: { ups: StatDelta[]; styles: any; sub?: boolean }) {
  return (
    <Text style={sub ? styles.statLineSub : styles.statLine}>
      {ups.map((d, i) => (
        <Text key={i}>
          {i ? '     ' : ''}
          <Text style={sub ? styles.statNameSub : styles.statName}>{d.label} </Text>
          <Text style={sub ? styles.deltaSub : (d.delta >= 3 ? styles.deltaBig : styles.delta)}>▲{d.delta}</Text>
        </Text>
      ))}
    </Text>
  );
}

export function GrowthReportModal({ visible, report, onClose }: { visible: boolean; report: PlayerGrowth[]; onClose: () => void }) {
  const sorted = useMemo(() => [...report].sort((a, b) => growthScore(b) - growthScore(a)), [report]);
  const shown = sorted.slice(0, MAX_CARDS);
  const rest = sorted.length - shown.length;
  const grew = report.filter((p) => (p.career ? p.career.deltaOvr > 0 : p.deltas.some((d) => d.delta > 0))).length;
  const aged = report.filter((p) => p.deltas.some((d) => d.delta < 0)).length;
  const [expanded, setExpanded] = useState(false);

  return (
    <Popup visible={visible} onRequestClose={onClose}>
      <Text style={styles.title}>📈 선수단 성장 리포트</Text>
      <Text style={styles.sub}>지난 경기 이후 변화한 선수들</Text>

      {/* 헤더 — 성장 메인 / 노쇠 보조(부제↓8dp · 헤더↓16dp 카드) */}
      {(grew > 0 || aged > 0) ? (
        <View style={styles.summary}>
          {grew > 0 ? <Text style={styles.grew}>{grew}명 성장</Text> : null}
          {aged > 0 ? <Text style={styles.agedSum}>{aged}명 소폭 노쇠</Text> : null}
        </View>
      ) : null}

      <ScrollView style={{ maxHeight: 400 }} contentContainerStyle={{ gap: 14 }}>
        {shown.map((p) => {
          const ups = upsOf(p.deltas);
          const downs = p.deltas.filter((d) => d.delta < 0);
          const careerUps = upsOf(p.career?.statDeltas ?? []);
          const dupCareer = sig(careerUps) === sig(ups); // 이번==누적이면 누적 줄 생략(중복 제거)
          const dOvr = p.career?.deltaOvr ?? 0;
          return (
            <View key={p.id} style={styles.card}>
              {/* 이름(주인공) + 바로 아래 OVR 변화 */}
              <View style={styles.head}>
                <PlayerAvatar id={p.id} size={40} />
                <View style={styles.headCol}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                    <PosTag pos={p.position} solid />
                  </View>
                  {p.career ? (
                    <View style={styles.ovrRow}>
                      <Text style={styles.ovrFrom}>입단 {p.career.debutOvr} → </Text>
                      <Text style={styles.ovrTo}>{p.career.curOvr}</Text>
                      {dOvr !== 0 ? (
                        <Text style={[styles.ovrDelta, { color: dOvr > 0 ? theme.good : theme.bad }]}>
                          {'  '}{dOvr > 0 ? `▲${dOvr}` : `▼${-dOvr}`}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              </View>

              {/* 이번 변화 — 카드의 주 정보(라벨 청록 강조, 스탯명 흰색·숫자 초록) */}
              {ups.length ? (
                <View style={styles.section}>
                  <Text style={styles.lblNow}>이번 변화</Text>
                  <StatList ups={ups} styles={styles} />
                </View>
              ) : null}

              {/* 누적 성장 — 참고(저대비) */}
              {careerUps.length && !dupCareer ? (
                <View style={styles.section}>
                  <Text style={styles.lblSub}>누적 성장</Text>
                  <StatList ups={careerUps} styles={styles} sub />
                </View>
              ) : null}

              {/* 노쇠 — 가장 연하게(주인공 아님) */}
              {downs.length ? (
                <Text style={styles.down} numberOfLines={1}>▼ {downs.map((d) => `${d.label} ${d.delta}`).join('  ')}</Text>
              ) : null}
            </View>
          );
        })}

        {rest > 0 && !expanded ? (
          <Text style={styles.more} onPress={() => setExpanded(true)}>그 외 {rest}명도 성장했어요  ▾</Text>
        ) : null}
        {expanded ? sorted.slice(MAX_CARDS).map((p) => (
          <View key={p.id} style={styles.mini}>
            <Text style={styles.miniName} numberOfLines={1}>{p.name}</Text>
            {p.career ? (
              <Text style={[styles.miniDelta, { color: p.career.deltaOvr >= 0 ? theme.good : theme.bad }]}>
                입단 {p.career.debutOvr} → {p.career.curOvr}{p.career.deltaOvr !== 0 ? (p.career.deltaOvr > 0 ? `  ▲${p.career.deltaOvr}` : `  ▼${-p.career.deltaOvr}`) : ''}
              </Text>
            ) : null}
          </View>
        )) : null}
      </ScrollView>

      <View style={{ height: 20 }} />
      <Button label="확인" onPress={onClose} />
    </Popup>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  title: { color: theme.text, fontSize: 19, fontWeight: '900' },
  sub: { color: theme.muted, fontSize: 12.5, marginTop: 2 },
  // 헤더 — 성장 메인 / 노쇠 보조. 부제↓8 · 헤더↓16 카드
  summary: { marginTop: 8, marginBottom: 16 },
  grew: { color: theme.good, fontSize: 16, fontWeight: '900' },
  agedSum: { color: theme.muted, fontSize: 12, fontWeight: '600', marginTop: 2, opacity: 0.8 },
  // 카드 — 상단 여백↑, 밝은 테두리, 아주 약한 그림자(레이어감)
  card: {
    backgroundColor: theme.cardAlt, borderRadius: 13, paddingTop: 14, paddingBottom: 12, paddingHorizontal: 14, gap: 8,
    borderWidth: 1, borderColor: theme.muted + '3A',
    shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headCol: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: theme.text, fontSize: 17, fontWeight: '900', flexShrink: 1 }, // 이름 = 주인공
  // OVR 변화 — 이름 바로 아래(가까이)
  ovrRow: { flexDirection: 'row', alignItems: 'baseline' },
  ovrFrom: { color: theme.muted, fontSize: 12.5, fontWeight: '600' },
  ovrTo: { color: theme.text, fontSize: 18, fontWeight: '900' },
  ovrDelta: { fontSize: 15, fontWeight: '900' },
  // 이번 변화 — 주 정보
  section: { gap: 3 },
  lblNow: { color: theme.accent, fontSize: 11, fontWeight: '800', letterSpacing: 0.2 },
  statLine: { fontSize: 13, lineHeight: 22 },
  statName: { color: theme.text, fontSize: 13, fontWeight: '700' }, // 스탯명 흰색(먼저 읽힘)
  delta: { color: theme.good, fontSize: 13, fontWeight: '800' },   // 숫자만 강조
  deltaBig: { color: theme.good, fontSize: 13.5, fontWeight: '900' }, // 큰 폭 소폭 강조
  // 누적 성장 — 참고(저대비)
  lblSub: { color: theme.muted, fontSize: 10.5, fontWeight: '700', opacity: 0.85 },
  statLineSub: { fontSize: 12, lineHeight: 20 },
  statNameSub: { color: theme.muted, fontSize: 12, fontWeight: '600' },
  deltaSub: { color: theme.good, fontSize: 12, fontWeight: '700', opacity: 0.7 },
  // 노쇠 — 가장 연하게
  down: { color: theme.muted, fontSize: 11, fontWeight: '600', opacity: 0.5 },
  more: { color: theme.accent, fontSize: 13, fontWeight: '800', textAlign: 'center', paddingVertical: 8 },
  mini: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingVertical: 7, gap: 8 },
  miniName: { color: theme.text, fontSize: 13, fontWeight: '700', flexShrink: 1 },
  miniDelta: { fontSize: 12, fontWeight: '800' },
}));
