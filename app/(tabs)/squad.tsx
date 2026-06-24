import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { Card, Muted, Row, Screen, STYLE_LABEL, Title, theme } from '../../components/Screen';
import { SpotlightOverlay, SpotlightTarget } from '../../components/Spotlight';
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
  // availIds = 그날 출전 가능 명단(부상·정지 제외). 부상 선수는 주전이 될 수 없어 벤치로 내려가는데,
  // 이유 표시가 없어 "왜 리베로가 주전서 빠졌지?"로 혼동(사용자 보고) → 🚑 결장 마크로 사유 노출.
  const { starterIds, availIds } = (() => {
    const avail = availableTeamPlayers(teamId, currentDay);
    if (!avail.length) return { starterIds: new Set<string>(), availIds: new Set<string>() };
    const lu = buildLineup(avail);
    return {
      starterIds: new Set<string>([...lu.six.map((x) => x.id), ...(lu.libero ? [lu.libero.id] : [])]),
      availIds: new Set<string>(avail.map((x) => x.id)),
    };
  })();
  // 구단주 레이어 데코 — 컨디션 점(●) + 결장(🚑)/벤치 지시(🪑)/불만(😟)
  const decor = (p: (typeof players)[number]) => {
    const cond = conditionOf(teamId, p.id, currentDay);
    const { topic } = discontentNow(p, teamId, currentDay);
    const benched = benchDirectives.some((b) => b.playerId === p.id);
    const out = !availIds.has(p.id); // 출전 명단 외(부상·정지) — 주전 불가 사유
    return {
      dotColor: cond.color,
      mood: out ? '🚑' : benched ? '🪑' : topic ? '😟' : undefined,
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

      <SpotlightTarget id="squad-top">
        <Title>선수 ({players.length}명)</Title>
        <Muted>이름을 누르면 상세 스탯·면담을 볼 수 있습니다. ● 경기감각 · 🚑 결장(부상·정지) · 🪑 벤치 지시 · 😟 불만</Muted>
      </SpotlightTarget>
      <RosterList players={players} decor={decor} starterIds={starterIds} />
      <SpotlightOverlay screen="tab-squad" />
    </Screen>
  );
}
