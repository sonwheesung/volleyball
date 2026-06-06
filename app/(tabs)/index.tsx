import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, Muted, OvrBadge, Row, Screen, Title, theme } from '../../components/Screen';
import { SEASON, getTeam, getTeamCoach, getTeamPlayers } from '../../data/league';
import { teamOverall } from '../../engine/overall';
import { teamScheduleEntries } from '../../engine/season';
import { useGameStore } from '../../store/useGameStore';

const STYLE_LABEL = { attack: '공격형', defense: '수비형', balanced: '밸런스' } as const;

export default function Dashboard() {
  const router = useRouter();
  const teamId = useGameStore((s) => s.selectedTeamId)!;
  const results = useGameStore((s) => s.results);
  const resetSave = useGameStore((s) => s.resetSave);

  const team = getTeam(teamId);
  const players = getTeamPlayers(teamId);
  const coach = getTeamCoach(teamId);
  const ovr = teamOverall(players);

  const record = useMemo(() => {
    const entries = teamScheduleEntries(SEASON, teamId);
    let w = 0;
    let l = 0;
    for (const e of entries) {
      if (e.kind !== 'match') continue;
      const r = results[e.fixture.id];
      if (!r) continue;
      const myWin = e.isHome ? r.homeSets > r.awaySets : r.awaySets > r.homeSets;
      if (myWin) w++;
      else l++;
    }
    return { w, l };
  }, [teamId, results]);

  if (!team) return null;

  return (
    <Screen title={team.name}>
      <Card>
        <Row>
          <View>
            <Muted>팀 종합 전력</Muted>
            <View style={{ height: 4 }} />
            <OvrBadge value={ovr} />
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Muted>정규리그 성적</Muted>
            <Text style={{ color: theme.text, fontSize: 26, fontWeight: '900' }}>
              {record.w}승 {record.l}패
            </Text>
          </View>
        </Row>
      </Card>

      {coach ? (
        <Card onPress={() => router.push(`/coach/${coach.id}`)}>
          <Row>
            <Text style={{ color: theme.text, fontWeight: '700' }}>
              감독 {coach.name} · {STYLE_LABEL[coach.style]}
            </Text>
            <Text style={{ color: theme.accent }}>›</Text>
          </Row>
        </Card>
      ) : null}

      <Button label="일정 보기 / 경기 진행" onPress={() => router.push('/(tabs)/schedule')} />
      <Button label="선수단 보기" variant="ghost" onPress={() => router.push('/(tabs)/squad')} />

      <View style={{ height: 8 }} />
      <Button
        label="구단 변경 (세이브 초기화)"
        variant="ghost"
        onPress={() => {
          resetSave();
          router.replace('/select-team');
        }}
      />
    </Screen>
  );
}
