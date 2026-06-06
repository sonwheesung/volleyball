import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, Muted, OvrBadge, Row, Screen, Title, theme } from '../../components/Screen';
import { SEASON, getEvolvedTeamPlayers, getTeam, getTeamCoach } from '../../data/league';
import { activeRoster, payroll as sumPayroll } from '../../data/roster';
import { computeStandings } from '../../data/standings';
import { teamOverall } from '../../engine/overall';
import { formatMoney } from '../../engine/salary';
import { teamScheduleEntries } from '../../engine/season';
import { useGameStore } from '../../store/useGameStore';

const STYLE_LABEL = { attack: '공격형', defense: '수비형', balanced: '밸런스' } as const;

export default function Dashboard() {
  const router = useRouter();
  const teamId = useGameStore((s) => s.selectedTeamId)!;
  const currentDay = useGameStore((s) => s.currentDay);
  const season = useGameStore((s) => s.season);
  const results = useGameStore((s) => s.results);
  const overrides = useGameStore((s) => s.contractOverrides);
  const released = useGameStore((s) => s.released);
  const resetSave = useGameStore((s) => s.resetSave);

  const team = getTeam(teamId);
  const basePlayers = getEvolvedTeamPlayers(teamId, currentDay);
  const roster = activeRoster(basePlayers, overrides, released);
  const coach = getTeamCoach(teamId);
  const ovr = teamOverall(basePlayers); // 전력은 전체 스쿼드 기준(경기 엔진과 일치)
  const payroll = sumPayroll(roster);   // 페이롤은 활성 계약 기준

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

  const standings = useMemo(() => computeStandings(currentDay), [currentDay, season]);
  const myRank = standings.findIndex((s) => s.teamId === teamId) + 1;

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
            <Muted>{season + 1}시즌 성적</Muted>
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

      <Card>
        <Row>
          <Muted>팀 총연봉</Muted>
          <Text style={{ color: payroll > team.budget ? theme.bad : theme.text, fontWeight: '800' }}>
            {formatMoney(payroll)} / {formatMoney(team.budget)}
          </Text>
        </Row>
      </Card>

      <Card onPress={() => router.push('/(tabs)/history')}>
        <Row>
          <Muted>리그 순위</Muted>
          <Text style={{ color: theme.text, fontWeight: '800' }}>
            {myRank > 0 ? `${myRank}위 / ${standings.length}` : '-'} ›
          </Text>
        </Row>
      </Card>

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
