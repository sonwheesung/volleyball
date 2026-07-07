import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { Card, Muted, Row, Screen, STYLE_LABEL, Title, theme } from '../../components/Screen';
import { SpotlightOverlay, SpotlightTarget } from '../../components/Spotlight';
import { RosterList } from '../../components/RosterList';
import { getEvolvedTeamPlayers, getTeamCoach } from '../../data/league';
import { activeRoster } from '../../data/roster';
import { availableTeamPlayers } from '../../data/injury';
import { injuredOnDay, suspendedOnDay } from '../../data/dynamics';
import { buildLineup } from '../../engine/lineup';
import { conditionOf } from '../../data/owner';
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
  const injuredSet = injuredOnDay(currentDay);   // 그날 부상자 전체(팀 무관) — 마커 사유 구분용
  const suspendedSet = suspendedOnDay(currentDay); // 그날 출장 정지자
  // 구단주 레이어 데코 — 컨디션 점(●) + 결장(부상/정지 마커)/벤치 지시(🪑).
  // 불만(😟)은 목록에 안 띄운다(2026-06-30 사용자 요청) — 명단은 이름·기본 상태만, 감정은 상세에서.
  // 부상/정지 마커·🪑는 "왜 주전서 빠졌나"를 설명하는 출전 상태(주전 정렬과 직결).
  const decor = (p: (typeof players)[number]) => {
    const cond = conditionOf(teamId, p.id, currentDay);
    const benched = benchDirectives.some((b) => b.playerId === p.id);
    // 결장 사유별 마커(2026-07-04 사용자 요청): 부상/정지는 포지션 태그 같은 라벨 pill, 벤치 지시는 🪑.
    const injured = injuredSet.has(p.id);
    const suspended = suspendedSet.has(p.id);
    return {
      dotColor: cond.color,
      tag: injured ? { text: '부상', color: theme.bad } : suspended ? { text: '정지', color: theme.bad } : undefined,
      mood: !injured && !suspended && benched ? '🪑' : undefined, // 벤치 지시(부상/정지 아닐 때만)
    };
  };

  return (
    <Screen>
      {coach ? (
        <SpotlightTarget id="squad-coach">
          <Card accent={theme.violet} onPress={() => router.push(`/coach/${coach.id}`)}>
            <Row>
              <Text style={{ color: theme.text, fontWeight: '700' }}>
                감독 {coach.name} · {STYLE_LABEL[coach.style]} · 카리스마 {coach.charisma}
              </Text>
              <Text style={{ color: theme.muted }}>›</Text>
            </Row>
          </Card>
        </SpotlightTarget>
      ) : null}

      <SpotlightTarget id="squad-top">
        <Title>선수 ({players.length}명)</Title>
        <Muted>이름을 누르면 상세 스탯·면담을 볼 수 있습니다. ● 경기감각 · <Text style={{ color: theme.bad, fontWeight: '700' }}>부상·정지</Text> 결장 · 🪑 벤치 지시</Muted>
      </SpotlightTarget>
      <RosterList players={players} decor={decor} starterIds={starterIds} />
      <SpotlightOverlay screen="tab-squad" />
    </Screen>
  );
}
