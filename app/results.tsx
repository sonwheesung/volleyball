// 전 구단 경기 결과 전용 화면 — 일정 화면 "전 구단 경기 결과 보기"에서 진입.
// 일(day) 단위로 묶어 표시: 날짜 헤더 1회 + 그날 경기들을 한 카드 안에 행으로(스캔 쉬움).
import { useMemo } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { EmptyState, IconLabel, Screen, theme, themedStyles } from '../components/Screen';
import { seasonResults, leagueDisplayDay, type ResultRow } from '../data/standings';
import { shortTeamName as short } from '../data/league';
import { dateForDay, formatDate } from '../lib/calendar';
import { useGameStore } from '../store/useGameStore';

export default function Results() {
  const router = useRouter();
  const teamId = useGameStore((s) => s.selectedTeamId);
  const currentDay = useGameStore((s) => s.currentDay);
  const season = useGameStore((s) => s.season);

  // **리그 진행 기준**(§3.2 — 순위·대시보드·시즌리더와 동일 컷오프 `leagueDisplayDay`): 리그가 친 경기를 전부
  // 표시(관전 안 한 것도 — 이미 지나간 경기). 현재 경기일은 관전 중이라 제외(스포일러 안전). 시작 시 빈 상태.
  const days = useMemo(() => {
    const sorted = seasonResults(leagueDisplayDay(currentDay)).slice().sort((a, b) => b.dayIndex - a.dayIndex);
    const groups: { dayIndex: number; rows: ResultRow[] }[] = [];
    for (const r of sorted) {
      const last = groups[groups.length - 1];
      if (last && last.dayIndex === r.dayIndex) last.rows.push(r);
      else groups.push({ dayIndex: r.dayIndex, rows: [r] });
    }
    return groups;
  }, [currentDay, season]);

  if (days.length === 0) {
    return (
      <Screen title="전 구단 경기 결과" scroll={false}>
        <EmptyState message="아직 치른 경기가 없습니다." />
      </Screen>
    );
  }

  return (
    <Screen title="전 구단 경기 결과">
      {days.map((g) => (
          <View key={g.dayIndex} style={styles.daySection}>
            <View style={styles.dayHeader}>
              <IconLabel icon="calendar-outline" color={theme.sky}>{formatDate(dateForDay(g.dayIndex))}</IconLabel>
            </View>
            <View style={styles.dayCard}>
              {g.rows.map((r, i) => {
                const mine = r.homeTeamId === teamId || r.awayTeamId === teamId;
                const homeWin = r.homeSets > r.awaySets;
                return (
                  <Pressable
                    key={r.fixtureId}
                    onPress={() => router.push(`/matchresult/${r.fixtureId}`)}
                    style={({ pressed }) => [
                      styles.matchRow,
                      i > 0 && styles.divider,
                      mine && styles.mineRow,
                      pressed && { opacity: 0.6 },
                    ]}
                  >
                    <Text style={[styles.mTeam, { textAlign: 'right' }, homeWin && styles.win]} numberOfLines={1}>
                      {short(r.homeTeamId)}
                    </Text>
                    <Text style={styles.score}>{r.homeSets} : {r.awaySets}</Text>
                    <Text style={[styles.mTeam, !homeWin && styles.win]} numberOfLines={1}>
                      {short(r.awayTeamId)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  daySection: { marginBottom: 12 },
  dayHeader: { marginBottom: 5, marginLeft: 4 },
  dayCard: { backgroundColor: theme.card, borderRadius: 10, borderWidth: 1, borderColor: theme.border, borderLeftWidth: 4, borderLeftColor: theme.sky, overflow: 'hidden' },
  matchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12 },
  divider: { borderTopWidth: 1, borderTopColor: theme.border },
  mineRow: { backgroundColor: theme.accent + '14' },
  mTeam: { flex: 1, color: theme.text, fontSize: 14, fontWeight: '600' },
  score: { color: theme.text, fontSize: 16, fontWeight: '800', minWidth: 50, textAlign: 'center' },
  win: { color: theme.good, fontWeight: '800' },
}));
