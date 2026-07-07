// 리그 순위표 전용 화면 — 대시보드 "리그 순위"에서 진입(순위만 본다).
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card, IconLabel, Loading, Screen, SCREEN_LOADING_MIN_MS, theme, themedStyles, useDeferredReady } from '../components/Screen';
import { computeStandings, leagueDisplayDay } from '../data/standings';
import { getTeam } from '../data/league';
import { seasonYear } from '../data/seasonLabel';
import { useGameStore } from '../store/useGameStore';

export default function Standings() {
  // 순위표는 무겁다(리그 전체 순위 재계산). 한 틱 미뤄 로딩부터 그린다.
  const ready = useDeferredReady(SCREEN_LOADING_MIN_MS);
  if (!ready) return <Loading title="순위" variant="list" />;
  return <StandingsInner />;
}

function StandingsInner() {
  const teamId = useGameStore((s) => s.selectedTeamId);
  const currentDay = useGameStore((s) => s.currentDay);
  const season = useGameStore((s) => s.season);
  // 리그 진행 기준(§3.2) — 현재 경기일 직전까지(관전 중 경기 제외, 스포일러 안전). 결과/대시보드/시즌리더와 동일 컷오프.
  const standings = useMemo(() => computeStandings(leagueDisplayDay(currentDay)), [currentDay, season]);

  return (
    <Screen title={`${seasonYear(season)} 순위`}>
      <Card accent={theme.accent}>
        <IconLabel icon="podium-outline" color={theme.accent}>리그 순위</IconLabel>
        <View style={[styles.row, styles.head]}>
          <Text style={[styles.rank, styles.h]}>#</Text>
          <Text style={[styles.team, styles.h]}>팀</Text>
          <Text style={[styles.cell, styles.h]}>경기</Text>
          <Text style={[styles.cell, styles.h]}>승</Text>
          <Text style={[styles.cell, styles.h]}>패</Text>
          <Text style={[styles.cell, styles.h]}>승점</Text>
          <Text style={[styles.cell, styles.h]}>세트±</Text>
        </View>
        {standings.map((s, i) => {
          const mine = s.teamId === teamId;
          return (
            <View key={s.teamId} style={styles.row}>
              <Text style={[styles.rank, mine && styles.mine]}>{i + 1}</Text>
              <Text style={[styles.team, mine && styles.mine]} numberOfLines={1}>
                {getTeam(s.teamId)?.name ?? s.teamId}
              </Text>
              <Text style={styles.cell}>{s.played}</Text>
              <Text style={styles.cell}>{s.wins}</Text>
              <Text style={styles.cell}>{s.losses}</Text>
              <Text style={[styles.cell, styles.pts, mine && styles.mine]}>{s.points}</Text>
              <Text style={[styles.cell, { color: s.setDiff >= 0 ? theme.good : theme.bad }]}>
                {s.setDiff > 0 ? '+' : ''}{s.setDiff}
              </Text>
            </View>
          );
        })}
      </Card>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
  head: { borderBottomWidth: 1, borderBottomColor: theme.border, marginBottom: 2, paddingBottom: 6 },
  h: { color: theme.muted, fontSize: 12, fontWeight: '700' },
  rank: { width: 24, color: theme.text, fontSize: 14, fontWeight: '700' },
  team: { flex: 1, color: theme.text, fontSize: 14, fontWeight: '600' },
  cell: { width: 40, textAlign: 'center', color: theme.text, fontSize: 14 },
  pts: { fontWeight: '800', color: theme.text }, // 승점 — 순위 결정 1순위라 강조
  mine: { color: theme.accent, fontWeight: '800' },
}));
