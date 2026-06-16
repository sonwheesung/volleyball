// 전 구단 경기 결과 전용 화면 — 일정 화면 "전 구단 경기 결과 보기"에서 진입.
import { useMemo } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, Muted, Screen, theme } from '../components/Screen';
import { seasonResults } from '../data/standings';
import { shortTeamName as short } from '../data/league';
import { dateForDay, formatDate } from '../lib/calendar';
import { useGameStore } from '../store/useGameStore';

export default function Results() {
  const router = useRouter();
  const teamId = useGameStore((s) => s.selectedTeamId);
  const currentDay = useGameStore((s) => s.currentDay);
  const season = useGameStore((s) => s.season);
  const results = useMemo(
    () => seasonResults(currentDay).slice().sort((a, b) => b.dayIndex - a.dayIndex),
    [currentDay, season],
  );

  return (
    <Screen title="전 구단 경기 결과">
      {results.length === 0 ? (
        <Card><Muted>아직 치른 경기가 없습니다.</Muted></Card>
      ) : (
        results.map((r) => {
          const mine = r.homeTeamId === teamId || r.awayTeamId === teamId;
          const homeWin = r.homeSets > r.awaySets;
          return (
            <Pressable
              key={r.fixtureId}
              onPress={() => router.push(`/matchresult/${r.fixtureId}`)}
              style={({ pressed }) => [styles.match, mine && { borderColor: theme.accent }, pressed && { opacity: 0.6 }]}
            >
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
            </Pressable>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  match: { backgroundColor: theme.card, borderRadius: 10, padding: 10, marginBottom: 6, borderWidth: 1, borderColor: theme.border },
  date: { color: theme.muted, fontSize: 11, marginBottom: 4, textAlign: 'center' },
  matchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  mTeam: { flex: 1, color: theme.text, fontSize: 14, fontWeight: '600' },
  score: { color: theme.text, fontSize: 16, fontWeight: '800', minWidth: 50, textAlign: 'center' },
  win: { color: theme.good, fontWeight: '800' },
});
