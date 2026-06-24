// 전 구단 경기 결과 전용 화면 — 일정 화면 "전 구단 경기 결과 보기"에서 진입.
// 일(day) 단위로 묶어 표시: 날짜 헤더 1회 + 그날 경기들을 한 카드 안에 행으로(스캔 쉬움).
import { useMemo } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { EmptyState, Screen, theme } from '../components/Screen';
import { seasonResults, type ResultRow } from '../data/standings';
import { shortTeamName as short } from '../data/league';
import { dateForDay, formatDate } from '../lib/calendar';
import { useGameStore } from '../store/useGameStore';

export default function Results() {
  const router = useRouter();
  const teamId = useGameStore((s) => s.selectedTeamId);
  const results = useGameStore((s) => s.results);
  const currentDay = useGameStore((s) => s.currentDay);
  const season = useGameStore((s) => s.season);

  // **리그 진행 기준**(통산·순위 화면과 동일): currentDay까지 리그가 치른 경기를 전부 표시(관전 안 한 것도 —
  // 이미 지나간 경기). 단 **현재 경기일의 미관전 경기는 스포일러 방지로 제외** → 지난 경기일 전부 +
  // 내가 관전 완료한 경기(results). 구버전은 관전한 경기만 봐서 자동진행한 리그 기록과 어긋났다(2026-06-24 사용자 보고).
  const days = useMemo(() => {
    const sorted = seasonResults(currentDay)
      .filter((r) => r.dayIndex < currentDay || results[r.fixtureId])
      .slice().sort((a, b) => b.dayIndex - a.dayIndex);
    const groups: { dayIndex: number; rows: ResultRow[] }[] = [];
    for (const r of sorted) {
      const last = groups[groups.length - 1];
      if (last && last.dayIndex === r.dayIndex) last.rows.push(r);
      else groups.push({ dayIndex: r.dayIndex, rows: [r] });
    }
    return groups;
  }, [results, season]);

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
            <Text style={styles.dayHeader}>{formatDate(dateForDay(g.dayIndex))}</Text>
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

const styles = StyleSheet.create({
  daySection: { marginBottom: 12 },
  dayHeader: { color: theme.muted, fontSize: 12, fontWeight: '700', marginBottom: 5, marginLeft: 4 },
  dayCard: { backgroundColor: theme.card, borderRadius: 10, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' },
  matchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12 },
  divider: { borderTopWidth: 1, borderTopColor: theme.border },
  mineRow: { backgroundColor: theme.accent + '14' },
  mTeam: { flex: 1, color: theme.text, fontSize: 14, fontWeight: '600' },
  score: { color: theme.text, fontSize: 16, fontWeight: '800', minWidth: 50, textAlign: 'center' },
  win: { color: theme.good, fontWeight: '800' },
});
