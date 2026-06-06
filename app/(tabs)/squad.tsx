import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { Card, Muted, Row, Screen, Title, theme } from '../../components/Screen';
import { RosterList } from '../../components/RosterList';
import { getEvolvedTeamPlayers, getTeamCoach } from '../../data/league';
import { activeRoster } from '../../data/roster';
import { useGameStore } from '../../store/useGameStore';

const STYLE_LABEL = { attack: '공격형', defense: '수비형', balanced: '밸런스' } as const;

export default function Squad() {
  const router = useRouter();
  const teamId = useGameStore((s) => s.selectedTeamId)!;
  const currentDay = useGameStore((s) => s.currentDay);
  const overrides = useGameStore((s) => s.contractOverrides);
  const released = useGameStore((s) => s.released);
  const players = activeRoster(getEvolvedTeamPlayers(teamId, currentDay), overrides, released);
  const coach = getTeamCoach(teamId);

  return (
    <Screen title="선수단">
      {coach ? (
        <Card onPress={() => router.push(`/coach/${coach.id}`)}>
          <Row>
            <Text style={{ color: theme.text, fontWeight: '700' }}>
              감독 {coach.name} · {STYLE_LABEL[coach.style]} · 카리스마 {coach.charisma}
            </Text>
            <Text style={{ color: theme.accent }}>›</Text>
          </Row>
        </Card>
      ) : null}

      <Title>선수 ({players.length}명)</Title>
      <Muted>이름을 누르면 상세 스탯을 볼 수 있습니다.</Muted>
      <RosterList players={players} />
    </Screen>
  );
}
