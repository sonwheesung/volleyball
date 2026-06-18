import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { Card, Muted, OvrBadge, Row, Screen, theme } from '../components/Screen';
import { IdentityChip, RecentRanks } from '../components/ClubIdentity';
import { LEAGUE, getTeamCoach, getTeamPlayers } from '../data/league';
import { clubIdentity } from '../data/clubIdentity';
import { teamOverallRaw } from '../engine/overall';

export default function SelectTeam() {
  const router = useRouter();

  return (
    <Screen title="구단을 선택하세요">
      <Muted>구단마다 역사와 색깔이 다릅니다. 카드를 누르면 선수단과 감독을 미리 볼 수 있습니다.</Muted>
      {LEAGUE.teams.map((t) => {
        const players = getTeamPlayers(t.id);
        const coach = getTeamCoach(t.id);
        const ovr = teamOverallRaw(players);
        const identity = clubIdentity(t.id);
        return (
          <Card key={t.id} onPress={() => router.push(`/team/${t.id}`)}>
            <Row>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>{t.name}</Text>
                {identity ? <IdentityChip identity={identity} /> : null}
              </View>
              <View style={{ alignItems: 'center', gap: 2 }}>
                <OvrBadge value={ovr} />
                <Muted style={{ fontSize: 11 }}>팀 OVR</Muted>
              </View>
            </Row>
            {identity ? (
              <View style={{ marginTop: 8, gap: 6 }}>
                <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 18 }}>{identity.blurb}</Text>
                <Row>
                  <RecentRanks ranks={identity.recentRanks} teamCount={LEAGUE.teams.length} />
                  <Muted style={{ fontSize: 11 }}>감독 {coach?.name ?? '—'} · {players.length}명</Muted>
                </Row>
              </View>
            ) : (
              <Muted style={{ marginTop: 6, fontSize: 12 }}>감독 {coach?.name ?? '—'} · 선수 {players.length}명</Muted>
            )}
          </Card>
        );
      })}
    </Screen>
  );
}
