// 성장 리포트 모달 (TRAINING §성장리포트) — 상용 퀄 마감(2026-07-06 6차 최종).
// "지난 경기 이후 변화". 시선: 이름 → OVR 변화(79 → 80  ▲1) → 이번 변화(섹션) → 세부 스탯(2열 표).
// OVR: "79 → 80"은 한 Text(베이스라인 고정) + ▲1 분리(간격). 스탯: 2열 그리드·▲ 우측정렬. 엔진/데이터/공식 무변경.
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Popup } from './Popup';
import { Button, PosTag, theme } from './Screen';
import { PlayerAvatar } from './PlayerAvatar';
import { themedStyles } from './theme';
import type { PlayerGrowth, StatDelta } from '../data/growthReport';

const MAX_CARDS = 10; // 다일 점프·긴 로스터로 벽이 되지 않게 — 상위 성장선수만, 나머지는 한 줄로 축약

const growthScore = (p: PlayerGrowth): number =>
  (p.career ? p.career.deltaOvr * 100 : 0) + p.deltas.filter((d) => d.delta > 0).length;

// 성장량 큰 순 정렬(무엇이 가장 컸나 한눈에) — 표시 전용, 원본 불변
const upsOf = (ds: StatDelta[]) => ds.filter((d) => d.delta > 0).sort((a, b) => b.delta - a.delta);
const sig = (ds: StatDelta[]) => ds.map((d) => `${d.label}${d.delta}`).join('|'); // 이번==누적 중복 판정

/** 스탯 목록 — 2열 그리드(표): 스탯명 흰색 왼쪽 · ▲숫자 초록 우측정렬(minWidth+textAlign로 컬럼 고정). */
function StatGrid({ ups, styles, sub }: { ups: StatDelta[]; styles: any; sub?: boolean }) {
  return (
    <View style={styles.statWrap}>
      {ups.map((d, i) => (
        <View key={i} style={styles.cell}>
          <Text style={sub ? styles.statNameSub : styles.statName} numberOfLines={1}>{d.label}</Text>
          <Text style={sub ? styles.deltaSub : (d.delta >= 3 ? styles.deltaBig : styles.delta)}>▲{d.delta}</Text>
        </View>
      ))}
    </View>
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
      <View style={styles.titleRow}>
        <Ionicons name="trending-up" size={19} color={theme.good} />
        <Text style={styles.title}>선수단 성장 리포트</Text>
      </View>
      <Text style={styles.sub}>지난 경기 이후 변화한 선수들</Text>

      {/* 헤더 — 성장 메인(크게) / 노쇠 보조(가장 연하게) */}
      {(grew > 0 || aged > 0) ? (
        <View style={styles.summary}>
          {grew > 0 ? <Text style={styles.grew}>{grew}명 성장</Text> : null}
          {aged > 0 ? <Text style={styles.agedSum}>{aged}명 소폭 노쇠</Text> : null}
        </View>
      ) : null}

      <ScrollView style={{ maxHeight: 400 }} contentContainerStyle={{ gap: 18 }}>
        {shown.map((p) => {
          const ups = upsOf(p.deltas);
          const downs = p.deltas.filter((d) => d.delta < 0);
          const careerUps = upsOf(p.career?.statDeltas ?? []);
          const dupCareer = sig(careerUps) === sig(ups); // 이번==누적이면 누적 줄 생략(중복 제거)
          const dOvr = p.career?.deltaOvr ?? 0;
          const flat = dOvr === 0; // OVR 변화 없음 → "유지"로 강조↓
          return (
            <View key={p.id} style={styles.card}>
              {/* 상단 — 이름(주인공) + OVR 변화. "79 → 80"은 한 Text(베이스라인), ▲1은 간격 두고 분리 */}
              <View style={styles.head}>
                <PlayerAvatar id={p.id} size={40} />
                <View style={styles.headCol}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                    <PosTag pos={p.position} solid />
                  </View>
                  {p.career ? (
                    <View style={styles.ovrRow}>
                      {flat ? (
                        <>
                          <Text style={styles.ovrFlat}>{p.career.curOvr}</Text>
                          <Text style={styles.ovrHold}>유지</Text>
                        </>
                      ) : (
                        <>
                          <Text style={styles.ovrMain}>
                            <Text style={styles.ovrFrom}>{p.career.debutOvr} → </Text>
                            <Text style={styles.ovrTo}>{p.career.curOvr}</Text>
                          </Text>
                          <Text style={[styles.ovrDelta, { color: dOvr > 0 ? theme.good : theme.bad }]}>{dOvr > 0 ? `▲${dOvr}` : `▼${-dOvr}`}</Text>
                        </>
                      )}
                    </View>
                  ) : null}
                </View>
              </View>

              {/* 이번 변화 — 섹션 제목(얇은 바) + 성장량 큰 순 2열 그리드 */}
              {ups.length ? (
                <View style={styles.section}>
                  <View style={styles.secHead}>
                    <View style={styles.secBar} />
                    <Text style={styles.lblNow}>이번 변화</Text>
                  </View>
                  <StatGrid ups={ups} styles={styles} />
                </View>
              ) : null}

              {/* 누적 성장 — 참고(저대비) */}
              {careerUps.length && !dupCareer ? (
                <View style={styles.section}>
                  <Text style={styles.lblSub}>누적 성장</Text>
                  <StatGrid ups={careerUps} styles={styles} sub />
                </View>
              ) : null}

              {/* 노쇠 — 가장 연하게 */}
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
              <Text style={[styles.miniDelta, { color: p.career.deltaOvr > 0 ? theme.good : p.career.deltaOvr < 0 ? theme.bad : theme.muted }]}>
                {p.career.deltaOvr === 0
                  ? `${p.career.curOvr}  유지`
                  : `${p.career.debutOvr} → ${p.career.curOvr}${p.career.deltaOvr > 0 ? `  ▲${p.career.deltaOvr}` : `  ▼${-p.career.deltaOvr}`}`}
              </Text>
            ) : null}
          </View>
        )) : null}
      </ScrollView>

      <View style={{ height: 32 }} />
      <Button label="확인" onPress={onClose} />
    </Popup>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  title: { color: theme.text, fontSize: 19, fontWeight: '900' },
  sub: { color: theme.muted, fontSize: 12.5, marginTop: 2 },
  // 헤더 — 성장 메인(크게) / 노쇠 보조(가장 연하게)
  summary: { marginTop: 4, marginBottom: 14 },
  grew: { color: theme.good, fontSize: 17, fontWeight: '900' },
  agedSum: { color: theme.muted, fontSize: 10, fontWeight: '600', marginTop: 2, opacity: 0.3 },
  // 카드 — 상하 padding 축소(컴팩트), 살짝 떠 보이는 그림자
  card: {
    backgroundColor: theme.cardAlt, borderRadius: 13, paddingTop: 10, paddingBottom: 8, paddingLeft: 14, paddingRight: 16, gap: 8,
    borderWidth: 1, borderColor: theme.muted + '4D',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 5,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headCol: { flex: 1, gap: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: theme.text, fontSize: 18, fontWeight: '900', flexShrink: 1 }, // 이름 = 주인공(더 크게)
  // OVR 변화 — 베이스라인 정렬 행. "79 → 80" 한 Text + ▲1 간격 두고 분리
  ovrRow: { flexDirection: 'row', alignItems: 'baseline' },
  ovrMain: { color: theme.text },
  ovrFrom: { color: theme.muted, fontSize: 13, fontWeight: '600' },
  ovrTo: { color: theme.text, fontSize: 24, fontWeight: '900' },
  ovrDelta: { fontSize: 18, fontWeight: '900', marginLeft: 10 }, // 결과 정보 — 간격 두고 분리
  ovrFlat: { color: theme.muted, fontSize: 15, fontWeight: '700', opacity: 0.55 }, // 변화 없으면 연하게
  ovrHold: { color: theme.muted, fontSize: 11.5, fontWeight: '600', opacity: 0.3, marginLeft: 7 },
  // 이번 변화 — 섹션 제목(제목↔스탯 4)
  section: { gap: 4 },
  secHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  secBar: { width: 2.5, height: 10, borderRadius: 2, backgroundColor: theme.accent },
  lblNow: { color: theme.accent, fontSize: 13, fontWeight: '900', letterSpacing: 0.2 },
  // 스탯 2열 그리드 — 컬럼 시작 고정(50%)·▲ 우측정렬(minWidth+textAlign)
  statWrap: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 },
  cell: { width: '50%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingRight: 16 },
  statName: { color: theme.text, fontSize: 13, fontWeight: '700', flexShrink: 1 },
  delta: { color: theme.good, fontSize: 13.5, fontWeight: '900', minWidth: 26, textAlign: 'right' },
  deltaBig: { color: theme.good, fontSize: 14.5, fontWeight: '900', minWidth: 26, textAlign: 'right' },
  // 누적 성장 — 참고(저대비)
  lblSub: { color: theme.muted, fontSize: 10.5, fontWeight: '700', opacity: 0.85 },
  statNameSub: { color: theme.muted, fontSize: 12, fontWeight: '600', flexShrink: 1 },
  deltaSub: { color: theme.good, fontSize: 12, fontWeight: '700', opacity: 0.7, minWidth: 24, textAlign: 'right' },
  // 노쇠 — 가장 연하게
  down: { color: theme.muted, fontSize: 11, fontWeight: '600', opacity: 0.45 },
  more: { color: theme.accent, fontSize: 13, fontWeight: '800', textAlign: 'center', paddingVertical: 8 },
  mini: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingVertical: 7, gap: 8 },
  miniName: { color: theme.text, fontSize: 13, fontWeight: '700', flexShrink: 1 },
  miniDelta: { fontSize: 12, fontWeight: '800' },
}));
