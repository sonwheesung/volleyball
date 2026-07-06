// 성장 리포트 모달 (TRAINING §성장리포트) — 출시 퀄 정보 위계(2026-07-06 UX 재설계).
// 시선 흐름: 이름(주인공) → OVR 변화 → 이번 변화(경기 직후 궁금한 것) → 누적 성장(참고).
// 담백한 관전형 톤: 초록 박스·큰 연출 없이 텍스트 위계로만. 엔진/공식/결정론 무변경(표시만).
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Popup } from './Popup';
import { Button, PosTag, theme } from './Screen';
import { PlayerAvatar } from './PlayerAvatar';
import { themedStyles } from './theme';
import type { PlayerGrowth, StatDelta } from '../data/growthReport';

const MAX_CARDS = 10; // 다일 점프·긴 로스터로 벽이 되지 않게 — 상위 성장선수만, 나머지는 한 줄로 축약

// 정렬 키 — 커리어 OVR 상승 우선, 없으면 이번 구간 상승 스탯 수
const growthScore = (p: PlayerGrowth): number =>
  (p.career ? p.career.deltaOvr * 100 : 0) + p.deltas.filter((d) => d.delta > 0).length;

const upsOf = (ds: StatDelta[]) => ds.filter((d) => d.delta > 0);
const sig = (ds: StatDelta[]) => ds.map((d) => `${d.label}${d.delta}`).join('|'); // 이번==누적 중복 판정

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
      <Text style={styles.sub}>지난 경기 이후 선수단의 성장과 변화</Text>

      {/* 헤더 — 성장 메인, 노쇠는 아래 작게(보조) */}
      {(grew > 0 || aged > 0) ? (
        <View style={styles.summary}>
          {grew > 0 ? <Text style={styles.grew}>{grew}명 성장</Text> : null}
          {aged > 0 ? <Text style={styles.agedSum}>{aged}명 소폭 노쇠</Text> : null}
        </View>
      ) : null}

      <ScrollView style={{ maxHeight: 396 }} contentContainerStyle={{ gap: 12 }}>
        {shown.map((p) => {
          const ups = upsOf(p.deltas);
          const downs = p.deltas.filter((d) => d.delta < 0);
          const careerUps = upsOf(p.career?.statDeltas ?? []);
          const dupCareer = sig(careerUps) === sig(ups); // 첫 리포트 등 이번==누적이면 누적 줄 생략(중복 제거)
          const dOvr = p.career?.deltaOvr ?? 0;
          return (
            <View key={p.id} style={styles.card}>
              {/* Row1 — 이름(주인공) + OVR 히어로 */}
              <View style={styles.head}>
                <PlayerAvatar id={p.id} size={30} />
                <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                <PosTag pos={p.position} solid compact />
                {p.career ? (
                  <View style={styles.hero}>
                    <Text style={styles.heroFrom}>입단 {p.career.debutOvr} → </Text>
                    <Text style={styles.heroTo}>{p.career.curOvr}</Text>
                    {dOvr !== 0 ? (
                      <Text style={[styles.heroDelta, { color: dOvr > 0 ? theme.good : theme.bad }]}>
                        {'  '}{dOvr > 0 ? `▲${dOvr}` : `▼${-dOvr}`}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>

              {/* Row2 — 이번 변화(주 정보: 경기 직후 궁금한 것) */}
              {ups.length ? (
                <Text style={styles.line} numberOfLines={2}>
                  <Text style={styles.lbl}>이번 변화  </Text>
                  {ups.map((d, i) => (
                    <Text key={i} style={d.delta >= 3 ? styles.upBig : styles.up}>{i ? '   ' : ''}▲{d.label} +{d.delta}</Text>
                  ))}
                </Text>
              ) : null}
              {downs.length ? (
                <Text style={styles.down} numberOfLines={1}>▼ {downs.map((d) => `${d.label} ${d.delta}`).join(' · ')}</Text>
              ) : null}

              {/* Row3 — 누적 성장(참고: 저대비·작게) */}
              {careerUps.length && !dupCareer ? (
                <Text style={styles.line} numberOfLines={2}>
                  <Text style={styles.lblSub}>누적 성장  </Text>
                  <Text style={styles.valSub}>{careerUps.map((d) => `${d.label} +${d.delta}`).join(' · ')}</Text>
                </Text>
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

      <View style={{ height: 16 }} />
      <Button label="확인" onPress={onClose} />
    </Popup>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  title: { color: theme.text, fontSize: 19, fontWeight: '900' },
  sub: { color: theme.muted, fontSize: 12.5, marginTop: 1 },
  // 헤더 — 성장 메인 / 노쇠 보조(아래 작게)
  summary: { marginTop: 12, marginBottom: 4 },
  grew: { color: theme.good, fontSize: 16, fontWeight: '900' },
  agedSum: { color: theme.muted, fontSize: 12, fontWeight: '600', marginTop: 2, opacity: 0.85 },
  // 카드 — 짧고 담백(8/12/16 리듬)
  card: { backgroundColor: theme.cardAlt, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, gap: 8, borderWidth: 1, borderColor: theme.border },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: theme.text, fontSize: 16, fontWeight: '900', flexShrink: 1 }, // 이름 = 주인공
  // OVR 히어로 — 카드 우측, 현재 OVR·델타가 먼저 읽히게 크게
  hero: { flexDirection: 'row', alignItems: 'baseline', marginLeft: 'auto' },
  heroFrom: { color: theme.muted, fontSize: 12, fontWeight: '600' },
  heroTo: { color: theme.text, fontSize: 20, fontWeight: '900' },
  heroDelta: { fontSize: 16, fontWeight: '900' },
  // 이번 변화 — 주 정보
  line: { fontSize: 12.5, lineHeight: 19 },
  lbl: { color: theme.muted, fontSize: 11, fontWeight: '800' },
  up: { color: theme.good, fontSize: 12.5, fontWeight: '700' },
  upBig: { color: theme.good, fontSize: 13, fontWeight: '900' }, // 큰 폭(+3↑) 소폭 강조(과하지 않게)
  down: { color: theme.muted, fontSize: 11.5, fontWeight: '600', opacity: 0.7 },
  // 누적 성장 — 참고(저대비)
  lblSub: { color: theme.muted, fontSize: 10.5, fontWeight: '700', opacity: 0.85 },
  valSub: { color: theme.muted, fontSize: 11.5, fontWeight: '600', opacity: 0.8 },
  more: { color: theme.accent, fontSize: 13, fontWeight: '800', textAlign: 'center', paddingVertical: 8 },
  mini: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingVertical: 7, gap: 8 },
  miniName: { color: theme.text, fontSize: 13, fontWeight: '700', flexShrink: 1 },
  miniDelta: { fontSize: 12, fontWeight: '800' },
}));
