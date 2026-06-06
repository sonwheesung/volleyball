import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Calendar } from '../../components/Calendar';
import { Button, Card, Muted, OvrBadge, Row, Screen, Title, theme } from '../../components/Screen';
import { SEASON, getEvolvedTeamPlayers, getTeam } from '../../data/league';
import { seasonResults } from '../../data/standings';
import { planNextAction } from '../../engine/advance';
import { teamOverall } from '../../engine/overall';
import { teamScheduleEntries } from '../../engine/season';
import { dateForDay, formatDate } from '../../lib/calendar';
import { useGameStore } from '../../store/useGameStore';

const shortName = (id: string) => {
  const n = getTeam(id)?.name ?? '';
  const p = n.split(' ');
  return p.length > 1 ? p[1] : n;
};

export default function Schedule() {
  const router = useRouter();
  const teamId = useGameStore((s) => s.selectedTeamId)!;
  const season = useGameStore((s) => s.season);
  const currentDay = useGameStore((s) => s.currentDay);
  const results = useGameStore((s) => s.results);
  const setDay = useGameStore((s) => s.setDay);

  const entries = useMemo(() => teamScheduleEntries(SEASON, teamId), [teamId]);
  const leagueResults = useMemo(
    () => seasonResults(currentDay).slice().sort((a, b) => b.dayIndex - a.dayIndex),
    [currentDay, season],
  );

  // "진행" 의사결정은 순수 오케스트레이터에 위임
  const action = planNextAction(SEASON, teamId, results);
  const nextFixture = action.kind === 'match' ? action.fixture : null;

  const totalMatches = SEASON.filter((f) => f.homeTeamId === teamId || f.awayTeamId === teamId).length;
  const playedCount = SEASON.filter(
    (f) => (f.homeTeamId === teamId || f.awayTeamId === teamId) && results[f.id],
  ).length;
  const focusDayIndex = nextFixture?.dayIndex ?? 0;

  const onAdvance = () => {
    if (!nextFixture) {
      Alert.alert('시즌 종료', '정규리그 모든 일정을 마쳤습니다.');
      return;
    }
    setDay(nextFixture.dayIndex); // 경기일까지 진행(사이 기간은 자동 훈련/노쇠 재계산)
    router.push(`/match/${nextFixture.id}`);
  };

  const preview = nextFixture
    ? (() => {
        const isHome = nextFixture.homeTeamId === teamId;
        const oppId = isHome ? nextFixture.awayTeamId : nextFixture.homeTeamId;
        return {
          isHome,
          oppName: getTeam(oppId)?.name ?? '',
          myOvr: teamOverall(getEvolvedTeamPlayers(teamId, nextFixture.dayIndex)),
          oppOvr: teamOverall(getEvolvedTeamPlayers(oppId, nextFixture.dayIndex)),
        };
      })()
    : null;

  return (
    <Screen title={`${season + 1}시즌 일정`}>
      <Card>
        <Row>
          <Muted>정규리그 진행</Muted>
          <Text style={{ color: theme.text, fontWeight: '800' }}>
            {playedCount} / {totalMatches} 경기
          </Text>
        </Row>
      </Card>

      {nextFixture && preview ? (
        <Card>
          <Muted>다음 경기 · {formatDate(dateForDay(nextFixture.dayIndex))}</Muted>
          <Row>
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>
              {preview.isHome ? '홈' : '원정'} vs {preview.oppName}
            </Text>
          </Row>
          <Row>
            <View style={{ alignItems: 'center', gap: 2 }}>
              <Muted style={{ fontSize: 11 }}>우리</Muted>
              <OvrBadge value={preview.myOvr} />
            </View>
            <Text style={{ color: theme.muted, fontWeight: '800' }}>VS</Text>
            <View style={{ alignItems: 'center', gap: 2 }}>
              <Muted style={{ fontSize: 11 }}>상대</Muted>
              <OvrBadge value={preview.oppOvr} />
            </View>
          </Row>
          <Button label="경기 시작" onPress={onAdvance} />
          <Muted style={{ fontSize: 12 }}>경기 사이 기간 동안 모든 선수가 자동으로 훈련합니다.</Muted>
        </Card>
      ) : (
        <Card>
          <Title>시즌 종료</Title>
          <Muted>정규리그 일정을 모두 마쳤습니다. 포스트시즌(상위 3팀)을 치른 뒤 오프시즌으로
            넘어갑니다. (이후 나이 +1·성장/노쇠·계약 -1년)</Muted>
          <Button label="포스트시즌 →" onPress={() => router.push('/playoffs')} />
        </Card>
      )}

      <Calendar entries={entries} results={results} focusDayIndex={focusDayIndex} />

      <Card>
        <Muted>전 구단 경기 결과</Muted>
        {leagueResults.length === 0 ? (
          <Muted style={{ fontSize: 12 }}>아직 치른 경기가 없습니다.</Muted>
        ) : (
          <ScrollView style={{ maxHeight: 300 }} nestedScrollEnabled>
            {leagueResults.map((r) => {
              const d = dateForDay(r.dayIndex);
              const mine = r.homeTeamId === teamId || r.awayTeamId === teamId;
              const homeWin = r.homeSets > r.awaySets;
              return (
                <Pressable
                  key={r.fixtureId}
                  onPress={() => router.push(`/matchresult/${r.fixtureId}`)}
                  style={({ pressed }) => [styles.mrow, mine && styles.mineRow, pressed && { opacity: 0.6 }]}
                >
                  <Text style={styles.mdate}>{d.getMonth() + 1}/{d.getDate()}</Text>
                  <Text style={[styles.mteam, { textAlign: 'right' }, homeWin && styles.win]} numberOfLines={1}>
                    {shortName(r.homeTeamId)}
                  </Text>
                  <Text style={styles.mscore}>{r.homeSets}:{r.awaySets}</Text>
                  <Text style={[styles.mteam, !homeWin && styles.win]} numberOfLines={1}>
                    {shortName(r.awayTeamId)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  mrow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderRadius: 8, paddingHorizontal: 6 },
  mineRow: { backgroundColor: theme.accent + '14' },
  mdate: { width: 38, color: theme.muted, fontSize: 11 },
  mteam: { flex: 1, color: theme.text, fontSize: 13, fontWeight: '600' },
  mscore: { color: theme.text, fontSize: 14, fontWeight: '800', minWidth: 34, textAlign: 'center' },
  win: { color: theme.good, fontWeight: '800' },
});
