import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card, Muted, Screen, Title, theme } from '../../components/Screen';
import { getTeam } from '../../data/league';
import { computeStandings, seasonResults } from '../../data/standings';
import { dateForDay, formatDate } from '../../lib/calendar';
import { useGameStore } from '../../store/useGameStore';

const short = (teamId: string) => {
  const n = getTeam(teamId)?.name ?? '';
  const parts = n.split(' ');
  return parts.length > 1 ? parts[1] : n;
};

export default function History() {
  const teamId = useGameStore((s) => s.selectedTeamId);
  const season = useGameStore((s) => s.season);
  const currentDay = useGameStore((s) => s.currentDay);

  const standings = useMemo(() => computeStandings(currentDay), [currentDay, season]);
  const results = useMemo(
    () => seasonResults(currentDay).slice().sort((a, b) => b.dayIndex - a.dayIndex),
    [currentDay, season],
  );

  return (
    <Screen title={`${season + 1}시즌 기록`}>
      <Title>순위표</Title>
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

      <Title>경기 결과 (전 구단)</Title>
      {results.length === 0 ? (
        <Card><Muted>아직 치른 경기가 없습니다.</Muted></Card>
      ) : (
        results.map((r) => {
          const mine = r.homeTeamId === teamId || r.awayTeamId === teamId;
          const homeWin = r.homeSets > r.awaySets;
          return (
            <View key={r.fixtureId} style={[styles.match, mine && { borderColor: theme.accent, borderWidth: 1 }]}>
              <Text style={styles.date}>{formatDate(dateForDay(r.dayIndex))}</Text>
              <View style={styles.matchRow}>
                <Text style={[styles.mTeam, { textAlign: 'right' }, homeWin && styles.win]} numberOfLines={1}>
                  {short(r.homeTeamId)}
                </Text>
                <Text style={styles.score}>{r.homeSets} : {r.awaySets}</Text>
                <Text style={[styles.mTeam, !homeWin && styles.win]} numberOfLines={1}>
                  {short(r.awayTeamId)}
                </Text>
              </View>
            </View>
          );
        })
      )}
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
  match: { backgroundColor: theme.card, borderRadius: 10, padding: 10, marginBottom: 6 },
  date: { color: theme.muted, fontSize: 11, marginBottom: 4, textAlign: 'center' },
  matchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  mTeam: { flex: 1, color: theme.text, fontSize: 14, fontWeight: '600' },
  score: { color: theme.text, fontSize: 16, fontWeight: '800', minWidth: 50, textAlign: 'center' },
  win: { color: theme.good, fontWeight: '800' },
});
