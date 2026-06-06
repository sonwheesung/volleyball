import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Alert, Text, View } from 'react-native';
import { Calendar } from '../../components/Calendar';
import { Button, Card, Muted, OvrBadge, Row, Screen, Title, theme } from '../../components/Screen';
import { SEASON, getEvolvedTeamPlayers, getTeam } from '../../data/league';
import { teamOverall } from '../../engine/overall';
import { teamScheduleEntries } from '../../engine/season';
import { dateForDay, formatDate } from '../../lib/calendar';
import { useGameStore } from '../../store/useGameStore';
import type { ScheduleEntry } from '../../types';

type MatchEntry = Extract<ScheduleEntry, { kind: 'match' }>;

export default function Schedule() {
  const router = useRouter();
  const teamId = useGameStore((s) => s.selectedTeamId)!;
  const currentDay = useGameStore((s) => s.currentDay);
  const results = useGameStore((s) => s.results);
  const setDay = useGameStore((s) => s.setDay);

  const entries = useMemo(() => teamScheduleEntries(SEASON, teamId), [teamId]);
  const matches = useMemo(
    () => entries.filter((e): e is MatchEntry => e.kind === 'match'),
    [entries],
  );

  // 다음에 치를 경기 (아직 결과 없는 가장 이른 경기)
  const nextMatch = matches.find((m) => !results[m.fixture.id]);

  const playedCount = matches.filter((m) => results[m.fixture.id]).length;
  const focusDayIndex = nextMatch?.dayIndex ?? matches[matches.length - 1]?.dayIndex ?? 0;

  const onAdvance = () => {
    if (!nextMatch) {
      Alert.alert('시즌 종료', '정규리그 모든 일정을 마쳤습니다.');
      return;
    }
    // 경기일까지 진행(사이 기간은 자동 훈련으로 처리됨) → 경기 화면
    setDay(nextMatch.dayIndex);
    router.push(`/match/${nextMatch.fixture.id}`);
  };

  const preview = nextMatch
    ? {
        oppName: getTeam(nextMatch.opponentId)?.name ?? '',
        isHome: nextMatch.isHome,
        myOvr: teamOverall(getEvolvedTeamPlayers(teamId, nextMatch.dayIndex)),
        oppOvr: teamOverall(getEvolvedTeamPlayers(nextMatch.opponentId, nextMatch.dayIndex)),
      }
    : null;

  return (
    <Screen title="시즌 일정">
      <Card>
        <Row>
          <Muted>정규리그 진행</Muted>
          <Text style={{ color: theme.text, fontWeight: '800' }}>
            {playedCount} / {matches.length} 경기
          </Text>
        </Row>
      </Card>

      {nextMatch && preview ? (
        <Card>
          <Muted>다음 경기 · {formatDate(dateForDay(nextMatch.dayIndex))}</Muted>
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
          <Muted style={{ fontSize: 12 }}>
            경기 사이 기간 동안 모든 선수가 자동으로 훈련합니다.
          </Muted>
        </Card>
      ) : (
        <Card>
          <Title>시즌 종료</Title>
          <Muted>정규리그 일정을 모두 마쳤습니다.</Muted>
        </Card>
      )}

      <Calendar entries={entries} results={results} focusDayIndex={focusDayIndex} />
    </Screen>
  );
}
