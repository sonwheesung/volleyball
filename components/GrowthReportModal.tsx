// 성장 리포트 모달 (TRAINING §성장리포트 — 2026-07-11 재정정: 구간 변화 전용, 누적은 선수 상세로 이동).
// 시선: 이름 → 이번 변화(구간 from→to, 주인공) → 노쇠(조용히). 누적(career) 블록 제거(매 리포트 반복 노출 피로 해소).
// 요약·정렬은 구간 기준. 엔진/데이터/공식 무변경.
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Popup } from './Popup';
import { Button, PosTag, theme } from './Screen';
import { PlayerAvatar } from './PlayerAvatar';
import { themedStyles } from './theme';
import type { PlayerGrowth, StatDelta } from '../data/growthReport';

const MAX_CARDS = 10; // 다일 점프·긴 로스터로 벽이 되지 않게 — 상위 성장선수만, 나머지는 한 줄로 축약

// 정렬·요약 = 구간(이번 변화) 기준: 성장 스탯 수(주) + 총 성장폭(부, 동점 타이브레이크). 누적(career)은 미반영.
const growthScore = (p: PlayerGrowth): number => {
  const ups = p.deltas.filter((d) => d.delta > 0);
  return ups.length * 1000 + ups.reduce((n, d) => n + d.delta, 0);
};

// 성장량 큰 순 정렬(무엇이 가장 컸나 한눈에) — 표시 전용, 원본 불변
const upsOf = (ds: StatDelta[]) => ds.filter((d) => d.delta > 0).sort((a, b) => b.delta - a.delta);

/** 스탯 목록 — 2열 그리드(표): 스탯명 왼쪽 · "77 → 78" from→to 값 우측정렬. */
function StatGrid({ ups, styles }: { ups: StatDelta[]; styles: any }) {
  return (
    <View style={styles.statWrap}>
      {ups.map((d, i) => (
        <View key={i} style={styles.cell}>
          <Text style={styles.statName} numberOfLines={1}>{d.label}</Text>
          <Text style={styles.fromTo} numberOfLines={1}>
            <Text style={styles.ftFrom}>{d.from} → </Text>
            <Text style={d.delta >= 3 ? styles.ftToBig : styles.ftTo}>{d.to}</Text>
          </Text>
        </View>
      ))}
    </View>
  );
}

export function GrowthReportModal({ visible, report, onClose }: { visible: boolean; report: PlayerGrowth[]; onClose: () => void }) {
  const sorted = useMemo(() => [...report].sort((a, b) => growthScore(b) - growthScore(a)), [report]);
  const shown = sorted.slice(0, MAX_CARDS);
  const rest = sorted.length - shown.length;
  const grew = report.filter((p) => p.deltas.some((d) => d.delta > 0)).length; // 구간 기준
  const aged = report.filter((p) => p.deltas.some((d) => d.delta < 0)).length;
  const [expanded, setExpanded] = useState(false);

  return (
    <Popup visible={visible} onRequestClose={onClose}>
      <View style={styles.titleRow}>
        <Ionicons name="trending-up" size={19} color={theme.good} />
        <Text style={styles.title}>선수단 성장 리포트</Text>
      </View>
      <Text style={styles.sub}>지난 경기 이후 훈련으로 성장한 선수들</Text>

      {/* 헤더 — 성장 메인(크게) / 노쇠 보조(가장 연하게) · 모두 구간 기준 */}
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
          return (
            <View key={p.id} style={styles.card}>
              {/* 상단 — 이름 + 포지션(OVR 히어로 없음) */}
              <View style={styles.head}>
                <PlayerAvatar id={p.id} size={40} />
                <View style={styles.nameRow}>
                  <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                  <PosTag pos={p.position} solid />
                </View>
              </View>

              {/* 이번 변화 — 섹션 제목(얇은 바) + 구간 from→to 2열 그리드(주인공) */}
              {ups.length ? (
                <View style={styles.section}>
                  <View style={styles.secHead}>
                    <View style={styles.secBar} />
                    <Text style={styles.lblNow}>이번 변화</Text>
                  </View>
                  <StatGrid ups={ups} styles={styles} />
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
        {expanded ? sorted.slice(MAX_CARDS).map((p) => {
          const top = upsOf(p.deltas)[0]; // 구간 최대 성장 스탯
          return (
            <View key={p.id} style={styles.mini}>
              <Text style={styles.miniName} numberOfLines={1}>{p.name}</Text>
              {top ? (
                <Text style={styles.miniDelta} numberOfLines={1}>{top.label} {top.from} → {top.to}</Text>
              ) : null}
            </View>
          );
        }) : null}
      </ScrollView>

      <View style={{ height: 38 }} />
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
  agedSum: { color: theme.muted, fontSize: 10, fontWeight: '600', marginTop: 2, opacity: 0.25 },
  // 카드 — 상하 패딩 동일(고급감)·부드러운 그림자
  card: {
    backgroundColor: theme.cardAlt, borderRadius: 13, paddingVertical: 11, paddingLeft: 14, paddingRight: 16, gap: 10,
    borderWidth: 1, borderColor: theme.muted + '4D',
    shadowColor: '#000', shadowOpacity: 0.38, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 7,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  name: { color: theme.text, fontSize: 18, fontWeight: '900', lineHeight: 22, flexShrink: 1 }, // 이름 = 주인공
  // 이번 변화 — 섹션 제목(제목↔스탯 8)
  section: { gap: 8 },
  secHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  secBar: { width: 2.5, height: 10, borderRadius: 2, backgroundColor: theme.accent },
  lblNow: { color: theme.accent, fontSize: 13, fontWeight: '900', letterSpacing: 0.2 },
  // 스탯 2열 그리드 — 스탯명 고정폭(왼쪽) + 값 우측정렬(오른쪽 끝) = 표
  statWrap: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 },
  cell: { width: '50%', flexDirection: 'row', alignItems: 'baseline', paddingRight: 14 },
  statName: { color: theme.text, fontSize: 13, fontWeight: '700', width: 74 }, // 고정폭 컬럼(왼쪽 정렬)
  // 이번 변화 값 — "77 → 78" from→to(우측 끝 정렬)
  fromTo: { flex: 1, textAlign: 'right' },
  ftFrom: { color: theme.muted, fontSize: 12.5, fontWeight: '600' },
  ftTo: { color: theme.good, fontSize: 13.5, fontWeight: '900' },
  ftToBig: { color: theme.good, fontSize: 14.5, fontWeight: '900' }, // 큰 폭 더 눈에
  // 노쇠 — 가장 연하게
  down: { color: theme.muted, fontSize: 11, fontWeight: '600', opacity: 0.45 },
  more: { color: theme.accent, fontSize: 13, fontWeight: '800', textAlign: 'center', paddingVertical: 8 },
  mini: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingVertical: 7, gap: 8 },
  miniName: { color: theme.text, fontSize: 13, fontWeight: '700', flexShrink: 1 },
  miniDelta: { color: theme.good, fontSize: 12, fontWeight: '800' },
}));
