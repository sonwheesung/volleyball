// 시즌 베스트7 — 코트 포메이션 명예 표시 (AWARDS_SYSTEM·SEASON_SYSTEM §5.5).
// 베스트7(S·OH·OH·OP·MB·MB·L)을 코트 위 7마커로: 구단색 틴트 + 우리 팀 선수 border 강조.
// ★ 정적 명예 포메이션 — 7명은 서로 다른 팀 올스타지 *함께 뛴 라인업 아님*. "최강 라인업/드림팀" 라벨·
//   랠리 애니 금지(가짜 드라마). "시즌 베스트7"으로만(실제 부문 수상자 배치=사실 나열).
// SeasonAwards.best7 입력만 받아 현재(잠정)·과거(archive[].awards) 공용. 새 영속 필드 0.
import { StyleSheet, Text, View } from 'react-native';
import { theme } from './Screen';
import { teamColors } from '../lib/teamColor';
import { shortTeamName } from '../data/league';
import type { Best7Slot } from '../types';

// 코트 위 7슬롯 배치(%, 네트=상단). 명예 포메이션이라 실제 로테이션이 아니라 읽기 좋은 분산.
const SPOT: { left: number; top: number }[] = [
  { left: 50, top: 56 }, // 0 S  — 중앙 후위(세터)
  { left: 20, top: 28 }, // 1 OH — 전위 좌
  { left: 20, top: 60 }, // 2 OH — 후위 좌
  { left: 80, top: 28 }, // 3 OP — 전위 우
  { left: 50, top: 24 }, // 4 MB — 전위 중앙(네트)
  { left: 80, top: 60 }, // 5 MB — 후위 우
  { left: 50, top: 76 }, // 6 L  — 후위 중앙 깊이(리베로). ※84%였으나 마커 아래 이름·팀명이 코트 하단(300px)에 잘려 76%로(UI_RULES)
];

export function Best7Court({
  best7, myTeamId, nameOf,
}: {
  best7: Best7Slot[];
  myTeamId: string | null;
  nameOf: (id: string) => string;
}) {
  return (
    <View style={styles.court}>
      {/* 네트(상단)·중앙선 — 코트 느낌만(정적) */}
      <View style={styles.net} />
      <View style={styles.midline} />
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
      <Text style={styles.tag}>시즌 베스트7</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  court: {
    height: 300, borderRadius: 16, overflow: 'hidden',
    backgroundColor: 'hsl(28, 30%, 22%)', // 코트 바닥 톤(우드)
    borderWidth: 1, borderColor: theme.border,
  },
  net: { position: 'absolute', top: '13%', left: 0, right: 0, height: 2, backgroundColor: 'rgba(255,255,255,0.5)' },
  midline: { position: 'absolute', top: '13%', bottom: 0, left: '50%', width: 1, backgroundColor: 'rgba(255,255,255,0.12)' },
  slot: { position: 'absolute', width: 84, marginLeft: -42, marginTop: -22, alignItems: 'center' },
  marker: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)',
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  markerMine: { borderWidth: 3, borderColor: theme.accent }, // 우리 팀 강조
  markerPos: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  name: { color: theme.text, fontSize: 11.5, fontWeight: '800', marginTop: 3, maxWidth: 84, textAlign: 'center' },
  nameMine: { color: theme.accent },
  team: { color: 'rgba(255,255,255,0.75)', fontSize: 10, fontWeight: '600', textAlign: 'center' },
  tag: { position: 'absolute', bottom: 6, right: 10, color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '800' },
});
