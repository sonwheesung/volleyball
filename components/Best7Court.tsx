// 시즌 베스트7 — 코트 포메이션 명예 표시 (AWARDS_SYSTEM §6·SEASON_SYSTEM §5.5).
// 베스트7(S·OH·OH·OP·MB·MB·L)을 코트 위 7마커로: 구단색 틴트 + 우리 팀 선수 border 강조.
// ★ 정적 명예 포메이션 — 7명은 서로 다른 팀 올스타지 *함께 뛴 라인업 아님*. "최강 라인업/드림팀" 라벨·
//   랠리 애니 금지(가짜 드라마). "시즌 베스트7"으로만(실제 부문 수상자 배치=사실 나열).
// 시각 격상(2026-07-28, 테스터 "다른 상보다 빈약"): 금 크레스트 헤더 + SVG 코트(그라디언트 바닥·네트/포스트·
//   어택라인·중앙 스포트라이트·금 프레임)로 시상식 포스터급 무게를 준다. 벡터만(AwardIllustration과 동일 결) — 테마 대응·실선수 유지.
// SeasonAwards.best7 입력만 받아 현재(잠정)·과거(archive[].awards) 공용. 새 영속 필드 0.
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Line, Path, G } from 'react-native-svg';
import { theme } from './Screen';
import { themedStyles } from './theme';
import { teamColors } from '../lib/teamColor';
import { shortTeamName } from '../data/league';
import type { Best7Slot } from '../types';

const GOLD = '#F2A93B';
const GOLD_LT = '#FFE49B';

// 코트 위 7슬롯 배치(%, 네트=상단). 명예 포메이션이라 실제 로테이션이 아니라 읽기 좋은 3단 분산.
// ★ 겹침 방지 규칙(2026-07-11): 한 슬롯 블록 = 마커40 + 이름~15 + 팀~13 + 여백 ≈ 72px로,
//   spot 기준 상단 ~22px·하단 ~50px를 차지한다. 따라서 아래 행 마커가 위 행 팀 라벨을 가리지 않으려면
//   행 간 spot 세로 간격 ≥ 72px여야 한다. 코트 340px에서 행 간 27%(≈92px)로 확보.
//   구 300px·3행은 리베로 팀 라벨이 하단서 잘리고 S 라벨을 L 마커가 덮었음 → 코트 340px + 세터/리베로 27% 분리로 해소.
const SPOT: { left: number; top: number }[] = [
  { left: 50, top: 50 }, // 0 S  — 후위 중앙(세터)
  { left: 20, top: 23 }, // 1 OH — 전위 좌
  { left: 20, top: 50 }, // 2 OH — 후위 좌
  { left: 80, top: 23 }, // 3 OP — 전위 우
  { left: 50, top: 23 }, // 4 MB — 전위 중앙(네트)
  { left: 80, top: 50 }, // 5 MB — 후위 우
  { left: 50, top: 77 }, // 6 L  — 리베로: 후위 뒤 별도 최후열 중앙. S(50%)와 27% 간격 → 세터 팀 라벨 겹침 원천 제거
];

/** 금 월계관 + "7" 크레스트 — 시상식 벡터 일러스트(AwardIllustration과 동일 결). */
function Best7Crest({ size = 40 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="b7num" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={GOLD_LT} />
          <Stop offset="1" stopColor={GOLD} />
        </LinearGradient>
      </Defs>
      {/* 월계 좌우(잎) */}
      <G stroke={GOLD} strokeWidth={2.4} fill="none" strokeLinecap="round">
        <Path d="M34 84 C20 76 16 54 24 34" />
        <Path d="M66 84 C80 76 84 54 76 34" />
      </G>
      <G fill={GOLD} opacity={0.9}>
        <Path d="M25 40 q-7 -3 -10 3 q7 4 10 -3 z" />
        <Path d="M23 52 q-8 -2 -10 4 q7 3 10 -4 z" />
        <Path d="M25 64 q-8 -1 -9 5 q7 2 9 -5 z" />
        <Path d="M29 74 q-7 0 -8 6 q7 1 8 -6 z" />
        <Path d="M75 40 q7 -3 10 3 q-7 4 -10 -3 z" />
        <Path d="M77 52 q8 -2 10 4 q-7 3 -10 -4 z" />
        <Path d="M75 64 q8 -1 9 5 q-7 2 -9 -5 z" />
        <Path d="M71 74 q7 0 8 6 q-7 1 -8 -6 z" />
      </G>
      {/* 상단 별 */}
      <Path d="M50 8 l3 7 7.5 .6 -5.7 5 1.8 7.3 -6.6 -4 -6.6 4 1.8 -7.3 -5.7 -5 7.5 -.6 z" fill={GOLD_LT} />
      {/* 7 */}
      <Path d="M35 34 h30 v6 l-14 34 h-10 l14 -34 h-20 z" fill="url(#b7num)" />
    </Svg>
  );
}

export function Best7Court({
  best7, myTeamId, nameOf,
}: {
  best7: Best7Slot[];
  myTeamId: string | null;
  nameOf: (id: string) => string;
}) {
  return (
    <View>
      {/* 금 크레스트 헤더 — 시상식 무게(포스터급). "시즌 베스트7"만(드림팀/최강라인업 금지) */}
      <View style={styles.header}>
        <Best7Crest size={44} />
        <View style={styles.headText}>
          <Text style={styles.kicker}>SEASON</Text>
          <Text style={styles.title}>베스트 7</Text>
        </View>
        <View style={styles.headText}>
          <Text style={[styles.kicker, { textAlign: 'right' }]}>포지션별</Text>
          <Text style={[styles.subhead, { textAlign: 'right' }]}>시즌 최고</Text>
        </View>
      </View>

      <View style={styles.court}>
        {/* SVG 코트 배경 — 깊이 그라디언트·네트/포스트·어택라인·중앙 스포트라이트(정적, 랠리 애니 없음) */}
        <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="hsl(28,34%,16%)" />
              <Stop offset="1" stopColor="hsl(28,30%,27%)" />
            </LinearGradient>
            <RadialGradient id="spot" cx="50%" cy="44%" r="60%">
              <Stop offset="0" stopColor="rgba(255,227,155,0.17)" />
              <Stop offset="0.7" stopColor="rgba(255,227,155,0.04)" />
              <Stop offset="1" stopColor="rgba(255,227,155,0)" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100" height="100" fill="url(#floor)" />
          <Rect x="0" y="0" width="100" height="100" fill="url(#spot)" />
          {/* 어택라인(전위/후위 3m) + 중앙선 */}
          <Line x1="0" y1="35" x2="100" y2="35" stroke="rgba(255,255,255,0.10)" strokeWidth={0.5} />
          <Line x1="0" y1="64" x2="100" y2="64" stroke="rgba(255,255,255,0.10)" strokeWidth={0.5} />
          <Line x1="50" y1="13" x2="50" y2="100" stroke="rgba(255,255,255,0.09)" strokeWidth={0.4} />
          {/* 네트: 밴드 + 상단 테이프 + 좌우 포스트 */}
          <Rect x="0" y="11.4" width="100" height="3.2" fill="rgba(255,255,255,0.06)" />
          <Line x1="0" y1="13" x2="100" y2="13" stroke="rgba(255,255,255,0.55)" strokeWidth={0.6} />
          <Rect x="1.2" y="8.5" width="1.1" height="9.5" rx={0.4} fill="rgba(255,255,255,0.5)" />
          <Rect x="97.7" y="8.5" width="1.1" height="9.5" rx={0.4} fill="rgba(255,255,255,0.5)" />
          {/* 금 내부 프레임 */}
          <Rect x="0.6" y="0.6" width="98.8" height="98.8" rx={2} fill="none" stroke="rgba(242,169,59,0.30)" strokeWidth={0.7} />
        </Svg>

        {best7.map((s, i) => {
          const spot = SPOT[i] ?? SPOT[0];
          const w = s.winner;
          const mine = !!w && !!myTeamId && w.teamId === myTeamId;
          const tc = w ? teamColors(w.teamId) : null;
          return (
            <View key={`${s.pos}-${i}`} style={[styles.slot, { left: `${spot.left}%`, top: `${spot.top}%` }]}>
              <View style={[
                styles.marker,
                { backgroundColor: tc ? tc.primary : theme.cardAlt },
                mine ? styles.markerMine : null,
              ]}>
                <Text style={styles.markerPos}>{s.pos}</Text>
              </View>
              {w ? (
                <>
                  <Text style={[styles.name, mine && styles.nameMine]} numberOfLines={1}>{nameOf(w.playerId)}</Text>
                  <Text style={styles.team} numberOfLines={1}>{shortTeamName(w.teamId)}</Text>
                </>
              ) : (
                <Text style={styles.team}>—</Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10,
    paddingHorizontal: 2,
  },
  headText: { flex: 1 },
  kicker: { color: GOLD, fontSize: 10, fontWeight: '800', letterSpacing: 2, opacity: 0.85 },
  title: { color: GOLD_LT, fontSize: 21, fontWeight: '900', letterSpacing: -0.3, marginTop: -1 },
  subhead: { color: theme.muted, fontSize: 13, fontWeight: '700', marginTop: 1 },
  court: {
    height: 340, borderRadius: 16, overflow: 'hidden', // 3행(전위/후위/리베로) 라벨 잘림 방지 위해 300→340(2026-07-11)
    borderWidth: 1.5, borderColor: 'rgba(242,169,59,0.45)', // 금 프레임(시상식 무게)
  },
  slot: { position: 'absolute', width: 84, marginLeft: -42, marginTop: -22, alignItems: 'center' },
  marker: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)',
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  markerMine: { borderWidth: 3, borderColor: theme.accent }, // 우리 팀 강조
  markerPos: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  name: { color: '#F2F5FA', fontSize: 11.5, fontWeight: '800', marginTop: 3, maxWidth: 84, textAlign: 'center' },
  nameMine: { color: theme.accent },
  team: { color: 'rgba(255,255,255,0.75)', fontSize: 10, fontWeight: '600', textAlign: 'center' },
}));
