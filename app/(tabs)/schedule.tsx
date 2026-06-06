import { useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Alert, Text, View } from 'react-native';
import { Calendar } from '../../components/Calendar';
import { Button, Card, Muted, OvrBadge, Row, Screen, Title, theme } from '../../components/Screen';
import { SEASON, getTeam, getTeamPlayers } from '../../data/league';
import { teamOverall } from '../../engine/overall';
import { teamScheduleEntries } from '../../engine/season';
import { dateForDay, formatDate } from '../../lib/calendar';
import { useGameStore } from '../../store/useGameStore';
import type { ScheduleEntry } from '../../types';

export default function Schedule() {
  const router = useRouter();
  const teamId = useGameStore((s) => s.selectedTeamId)!;
  const progressIndex = useGameStore((s) => s.progressIndex);
  const results = useGameStore((s) => s.results);
  const setProgress = useGameStore((s) => s.setProgress);

  const entries = useMemo(() => teamScheduleEntries(SEASON, teamId), [teamId]);

  // 다음에 처리할 항목 (이미 치른 경기는 건너뜀)
  const resolveNext = (): { entry: ScheduleEntry; index: number } | null => {
    let i = progressIndex;
    while (i < entries.length) {
      const e = entries[i];
      if (e.kind === 'match' && results[e.fixture.id]) {
        i++;
        continue;
      }
      return { entry: e, index: i };
    }
    return null;
  };

  const nextItem = resolveNext();

  // 치른 경기에 포인터가 머물러 있으면 다음으로 당겨놓기(진행도 동기화)
  useEffect(() => {
    if (nextItem && nextItem.index !== progressIndex) setProgress(nextItem.index);
  }, [nextItem?.index, progressIndex, setProgress]);

  const playedCount = entries.filter((e) => e.kind === 'match' && results[e.fixture.id]).length;
  const totalMatches = entries.filter((e) => e.kind === 'match').length;

  const focusDayIndex = nextItem?.entry.dayIndex ?? entries[entries.length - 1]?.dayIndex ?? 0;

  const onAdvance = () => {
    const nx = resolveNext();
    if (!nx) {
      Alert.alert('시즌 종료', '정규리그 모든 일정을 마쳤습니다.');
      return;
    }
    if (nx.entry.kind === 'event') {
      setProgress(nx.index + 1);
      return;
    }
    // 경기 → 경기 화면으로
    setProgress(nx.index);
    router.push(`/match/${nx.entry.fixture.id}`);
  };

  // 다음 경기 프리뷰용
  let preview: { oppName: string; isHome: boolean; myOvr: number; oppOvr: number } | null = null;
  if (nextItem?.entry.kind === 'match') {
    const m = nextItem.entry;
    preview = {
      oppName: getTeam(m.opponentId)?.name ?? '',
      isHome: m.isHome,
      myOvr: teamOverall(getTeamPlayers(teamId)),
      oppOvr: teamOverall(getTeamPlayers(m.opponentId)),
    };
  }

  return (
    <Screen title="시즌 일정">
      <Card>
        <Row>
          <Muted>정규리그 진행</Muted>
          <Text style={{ color: theme.text, fontWeight: '800' }}>
            {playedCount} / {totalMatches} 경기
          </Text>
        </Row>
      </Card>

      {nextItem ? (
        <Card>
          <Muted>다음 일정 · {formatDate(dateForDay(nextItem.entry.dayIndex))}</Muted>
          {nextItem.entry.kind === 'match' && preview ? (
            <>
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
            </>
          ) : (
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>
              {(nextItem.entry as Extract<ScheduleEntry, { kind: 'event' }>).title}
            </Text>
          )}
          <Button
            label={nextItem.entry.kind === 'match' ? '경기 시작' : '진행'}
            onPress={onAdvance}
          />
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
