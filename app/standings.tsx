// 리그 순위표 전용 화면 — 대시보드 "리그 순위"에서 진입(순위만 본다).
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card, Screen, theme } from '../components/Screen';
import { computeStandings, playedThroughDay } from '../data/standings';
import { getTeam } from '../data/league';
import { useGameStore } from '../store/useGameStore';

export default function Standings() {
  const teamId = useGameStore((s) => s.selectedTeamId);
  const results = useGameStore((s) => s.results);
  const season = useGameStore((s) => s.season);
  // 실제로 치른 경기까지만 반영(대시보드 성적과 일치) — 미관전 경기 선반영 방지
  const standings = useMemo(() => computeStandings(playedThroughDay(results)), [results, season]);

  return (
    <Screen title={`${season + 1}시즌 순위`}>
      <Card>
        <View style={[styles.row, styles.head]}>
          <Text style={[styles.rank, styles.h]}>#</Text>
          <Text style={[styles.team, styles.h]}>팀</Text>
          <Text style={[styles.cell, styles.h]}>경기</Text>
          <Text style={[styles.cell, styles.h]}>승</Text>
          <Text style={[styles.cell, styles.h]}>패</Text>
          <Text style={[styles.cell, styles.h]}>득실</Text>
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
              <Text style={[styles.cell, styles.mine]}>{s.wins}</Text>
              <Text style={styles.cell}>{s.losses}</Text>
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

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
  head: { borderBottomWidth: 1, borderBottomColor: theme.border, marginBottom: 2, paddingBottom: 6 },
  h: { color: theme.muted, fontSize: 12, fontWeight: '700' },
  rank: { width: 24, color: theme.text, fontSize: 14, fontWeight: '700' },
  team: { flex: 1, color: theme.text, fontSize: 14, fontWeight: '600' },
  cell: { width: 40, textAlign: 'center', color: theme.text, fontSize: 14 },
  mine: { color: theme.accent, fontWeight: '800' },
});
