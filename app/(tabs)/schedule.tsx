import { useRouter } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Muted, OvrBadge, Row, Screen, Title, theme } from '../../components/Screen';
import { SEASON, getEvolvedTeamPlayers, getTeam } from '../../data/league';
import { computeStandings } from '../../data/standings';
import { isBigMatch } from '../../engine/owner';
import { planNextAction } from '../../engine/advance';
import { teamOverall } from '../../engine/overall';
import { dateForDay, formatDate } from '../../lib/calendar';
import { useGameStore } from '../../store/useGameStore';

export default function Schedule() {
  const router = useRouter();
  const teamId = useGameStore((s) => s.selectedTeamId)!;
  const season = useGameStore((s) => s.season);
  const currentDay = useGameStore((s) => s.currentDay);
  const results = useGameStore((s) => s.results);
  const setDay = useGameStore((s) => s.setDay);

  // "진행" 의사결정은 순수 오케스트레이터에 위임
  const action = planNextAction(SEASON, teamId, results);
  const nextFixture = action.kind === 'match' ? action.fixture : null;

  const totalMatches = SEASON.filter((f) => f.homeTeamId === teamId || f.awayTeamId === teamId).length;
  const playedCount = SEASON.filter(
    (f) => (f.homeTeamId === teamId || f.awayTeamId === teamId) && results[f.id],
  ).length;

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
        const myOvr = teamOverall(getEvolvedTeamPlayers(teamId, nextFixture.dayIndex));
        const oppOvr = teamOverall(getEvolvedTeamPlayers(oppId, nextFixture.dayIndex));
        // 빅매치 판정(Phase 4): 순위 직결이 1순위 — 상위권 맞대결·종반 인접 순위전. 그 다음 접전/강팀
        const standings = computeStandings(currentDay > 0 ? currentDay : Number.MAX_SAFE_INTEGER);
        const myRank = Math.max(1, standings.findIndex((r) => r.teamId === teamId) + 1);
        const oppRank = Math.max(1, standings.findIndex((r) => r.teamId === oppId) + 1);
        const big = isBigMatch(myRank, oppRank, nextFixture.dayIndex);
        const margin = Math.abs(myOvr - oppOvr);
        const late = totalMatches > 0 && playedCount / totalMatches >= 0.8;
        const reason = big ? `🔥 빅매치 — ${myRank}위 vs ${oppRank}위` : margin <= 3 ? '접전 예상' : oppOvr >= 76 ? '강팀 상대' : late ? '시즌 막바지' : null;
        return { isHome, oppName: getTeam(oppId)?.name ?? '', myOvr, oppOvr, important: !!reason, reason };
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
          <Row>
            <Muted>다음 경기 · {formatDate(dateForDay(nextFixture.dayIndex))}</Muted>
            {preview.important ? (
              <View style={styles.bigMatch}>
                <Text style={styles.bigMatchText}>⭐ 중요 · {preview.reason}</Text>
              </View>
            ) : null}
          </Row>
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
          <Button label={preview.important ? '관전하러 가기 →' : '경기 시작'} onPress={onAdvance} />
          <Muted style={{ fontSize: 12 }}>
            {preview.important
              ? '경기 보드에서 작전 방침(핀치 서버·블로킹·수비)을 조정할 수 있습니다.'
              : '경기 사이 기간 동안 모든 선수가 자동으로 훈련합니다.'}
          </Muted>
        </Card>
      ) : (
        <Card>
          <Title>시즌 종료</Title>
          <Muted>정규리그 일정을 모두 마쳤습니다. 포스트시즌(상위 3팀)을 치른 뒤 오프시즌으로
            넘어갑니다. (이후 나이 +1·성장/노쇠·계약 -1년)</Muted>
          <Button label="포스트시즌 →" onPress={() => router.push('/playoffs')} />
        </Card>
      )}

      <Button label="일정 보러 가기 (캘린더)" variant="ghost" onPress={() => router.push('/calendar')} />
      <Button label="전 구단 경기 결과 보기" variant="ghost" onPress={() => router.push('/results')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  bigMatch: { backgroundColor: theme.warn + '26', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  bigMatchText: { color: theme.warn, fontSize: 12, fontWeight: '800' },
});
