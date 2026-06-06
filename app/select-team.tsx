import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { Card, Muted, OvrBadge, Row, Screen, theme } from '../components/Screen';
import { LEAGUE, getTeamCoach, getTeamPlayers } from '../data/league';
import { teamOverall } from '../engine/overall';

export default function SelectTeam() {
  const router = useRouter();

  return (
    <Screen title="구단을 선택하세요">
      <Muted>운영할 구단을 고르세요. 카드를 누르면 선수단과 감독을 미리 볼 수 있습니다.</Muted>
      {LEAGUE.teams.map((t) => {
        const players = getTeamPlayers(t.id);
        const coach = getTeamCoach(t.id);
        const ovr = teamOverall(players);
        return (
          <Card key={t.id} onPress={() => router.push(`/team/${t.id}`)}>
            <Row>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>{t.name}</Text>
                <Muted style={{ marginTop: 2 }}>
                  감독 {coach?.name ?? '—'} · 선수 {players.length}명
                </Muted>
              </View>
              <View style={{ alignItems: 'center', gap: 2 }}>
                <OvrBadge value={ovr} />
                <Muted style={{ fontSize: 11 }}>팀 OVR</Muted>
              </View>
            </Row>
          </Card>
        );
      })}
    </Screen>
  );
}
