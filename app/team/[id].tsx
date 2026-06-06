import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { Button, Card, Muted, OvrBadge, PosTag, Row, Screen, Title, theme } from '../../components/Screen';
import { RosterList } from '../../components/RosterList';
import { getTeam, getTeamCoach, getTeamPlayers } from '../../data/league';
import { teamOverall } from '../../engine/overall';
import { useGameStore } from '../../store/useGameStore';

const STYLE_LABEL = { attack: '공격형', defense: '수비형', balanced: '밸런스' } as const;

export default function TeamDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const selectTeam = useGameStore((s) => s.selectTeam);
  const selectedTeamId = useGameStore((s) => s.selectedTeamId);

  const team = id ? getTeam(id) : undefined;
  if (!team) {
    return (
      <Screen title="구단 없음">
        <Muted>존재하지 않는 구단입니다.</Muted>
      </Screen>
    );
  }

  const players = getTeamPlayers(team.id);
  const coach = getTeamCoach(team.id);
  const ovr = teamOverall(players);
  const isCurrent = selectedTeamId === team.id;

  const onSelect = () => {
    selectTeam(team.id);
    router.replace('/(tabs)/schedule');
  };

  return (
    <Screen title={team.name}>
      <Card>
        <Row>
          <Muted>팀 종합 전력</Muted>
          <OvrBadge value={ovr} />
        </Row>
      </Card>

      {coach ? (
        <Card onPress={() => router.push(`/coach/${coach.id}`)}>
          <Row>
            <View style={{ flex: 1 }}>
              <Title>감독 · {coach.name}</Title>
              <Muted style={{ marginTop: 2 }}>
                {coach.age}세 · {STYLE_LABEL[coach.style]} · 카리스마 {coach.charisma}
              </Muted>
            </View>
            <Text style={{ color: theme.accent }}>상세 ›</Text>
          </Row>
        </Card>
      ) : null}

      <Title>선수단 ({players.length}명)</Title>
      <RosterList players={players} />

      <View style={{ height: 4 }} />
      {isCurrent ? (
        <Button label="현재 운영 중인 구단" onPress={() => router.replace('/(tabs)/schedule')} variant="ghost" />
      ) : (
        <Button label={`${team.name} 운영하기`} onPress={onSelect} />
      )}
    </Screen>
  );
}
