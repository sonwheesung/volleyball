import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { Card, Muted, Row, Screen, STYLE_LABEL, Title, theme } from '../../components/Screen';
import { RosterList } from '../../components/RosterList';
import { getEvolvedTeamPlayers, getTeamCoach } from '../../data/league';
import { activeRoster } from '../../data/roster';
import { availableTeamPlayers } from '../../data/injury';
import { buildLineup } from '../../engine/lineup';
import { discontentNow, conditionOf } from '../../data/owner';
import { useGameStore } from '../../store/useGameStore';

export default function Squad() {
  const router = useRouter();
  const teamId = useGameStore((s) => s.selectedTeamId)!;
  const currentDay = useGameStore((s) => s.currentDay);
  const overrides = useGameStore((s) => s.contractOverrides);
  const released = useGameStore((s) => s.released);
  const players = activeRoster(getEvolvedTeamPlayers(teamId, currentDay), overrides, released);
  const coach = getTeamCoach(teamId);
  const benchDirectives = useGameStore((s) => s.benchDirectives);
  // 주전(그날 실제 출전 라인업 6인+리베로) — 선수단 정렬을 "주전 먼저, 그 안에서 포지션순"으로(사용자 요청).
  const starterIds = (() => {
    const avail = availableTeamPlayers(teamId, currentDay);
    if (!avail.length) return new Set<string>();
    const lu = buildLineup(avail);
    return new Set<string>([...lu.six.map((x) => x.id), ...(lu.libero ? [lu.libero.id] : [])]);
  })();
  // 구단주 레이어 데코 — 컨디션 점(●) + 불만(😟)/벤치 지시(🪑)
  const decor = (p: (typeof players)[number]) => {
    const cond = conditionOf(teamId, p.id, currentDay);
    const { topic } = discontentNow(p, teamId, currentDay);
    const benched = benchDirectives.some((b) => b.playerId === p.id);
    return {
      dotColor: cond.color,
      mood: benched ? '🪑' : topic ? '😟' : undefined,
    };
  };

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
      <Muted>이름을 누르면 상세 스탯·면담을 볼 수 있습니다. ● 경기감각 · 😟 불만 · 🪑 벤치 지시</Muted>
      <RosterList players={players} decor={decor} starterIds={starterIds} />
    </Screen>
  );
}
