import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { Button, Card, Muted, OvrBadge, PosTag, Row, Screen, STYLE_LABEL, Title, theme } from '../../components/Screen';
import { RosterList } from '../../components/RosterList';
import { getEvolvedTeamPlayers, getTeam, getTeamCoach, teamAssistants, teamScouts, teamScoutReveal } from '../../data/league';
import { teamOverallRaw } from '../../engine/overall';
import { SPECIALTY_KO } from '../../engine/staff';
import { useGameStore } from '../../store/useGameStore';

export default function TeamDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const selectTeam = useGameStore((s) => s.selectTeam);
  const selectedTeamId = useGameStore((s) => s.selectedTeamId);
  const currentDay = useGameStore((s) => s.currentDay);

  const team = id ? getTeam(id) : undefined;
  if (!team) {
    return (
      <Screen title="구단 없음">
        <Muted>존재하지 않는 구단입니다.</Muted>
      </Screen>
    );
  }

  const players = getEvolvedTeamPlayers(team.id, currentDay);
  const coach = getTeamCoach(team.id);
  const ovr = teamOverallRaw(players);
  const isCurrent = selectedTeamId === team.id;
  const asst = teamAssistants(team.id);
  const scouts = teamScouts(team.id);
  const reveal = teamScoutReveal(team.id);

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

      {/* 코칭 스태프 — AI 팀은 기본 스태프(코치2+스카우터1), 내 팀은 영입분 */}
      {(asst.length > 0 || scouts.length > 0) ? (
        <Card>
          <Title>코칭 스태프</Title>
          {asst.map((a) => (
            <View key={a.id} style={{ marginTop: 6 }}>
              <Row>
                <Muted>전문 코치 · {SPECIALTY_KO[a.specialty]}</Muted>
                <Muted>역량 {a.rating}</Muted>
              </Row>
            </View>
          ))}
          {scouts.map((s) => (
            <View key={s.id} style={{ marginTop: 6 }}>
              <Row>
                <Muted>스카우터 · 공개도 {Math.round(reveal * 100)}%</Muted>
                <Muted>스카우팅 {s.scouting}</Muted>
              </Row>
            </View>
          ))}
          {isCurrent ? (
            <Button label="스태프 계약 관리" variant="ghost" onPress={() => router.push('/staff')} />
          ) : null}
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
