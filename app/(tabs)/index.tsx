import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, Muted, OvrBadge, Row, Screen, STYLE_LABEL, Title, theme } from '../../components/Screen';
import { SEASON, getEvolvedTeamPlayers, getPlayer, getTeam, getTeamCoach } from '../../data/league';
import { activeRoster, payroll as sumPayroll } from '../../data/roster';
import { computeStandings } from '../../data/standings';
import { teamInjuriesOn } from '../../data/injury';
import { buildNewsFeed } from '../../data/news';
import { currentSeasonAwards } from '../../data/awards';
import { SEVERITY_KO } from '../../engine/injury';
import { teamOverall } from '../../engine/overall';
import { formatMoney } from '../../engine/salary';
import { teamFanbaseNow } from '../../data/owner';
import { LEAGUE_CAP } from '../../engine/cap';
import { teamScheduleEntries } from '../../engine/season';
import { useGameStore } from '../../store/useGameStore';

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
  const fanScore = useGameStore((s) => s.fanScore); // 팬심(직전 시즌 정산)
  const archive = useGameStore((s) => s.archive);
  const cash = useGameStore((s) => s.cash);         // 운영 자금(FINANCE)
  const lastFinance = useGameStore((s) => s.lastFinance);
  const fanbaseInfo = useMemo(
    () => teamFanbaseNow(teamId, currentDay, fanScore, archive),
    [teamId, currentDay, fanScore, archive, season],
  );

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
  const injuries = useMemo(() => teamInjuriesOn(teamId, currentDay), [teamId, currentDay, season]);
  const milestones = useGameStore((s) => s.milestones);
  const hallOfFame = useGameStore((s) => s.hallOfFame);
  const news = useMemo(
    () => buildNewsFeed(archive, milestones, hallOfFame, season).slice(0, 5),
    [archive, milestones, hallOfFame, season, currentDay],
  );
  const latestRoundMvp = useMemo(() => {
    const r = currentSeasonAwards(season, currentDay).roundMvps;
    for (let i = r.length - 1; i >= 0; i--) if (r[i]) return r[i];
    return null;
  }, [season, currentDay]);

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
          <Muted>팀 총연봉 / 캡</Muted>
          <Text style={{ color: payroll > LEAGUE_CAP ? theme.bad : theme.text, fontWeight: '800' }}>
            {formatMoney(payroll)} / {formatMoney(LEAGUE_CAP)}
          </Text>
        </Row>
        <Row>
          <Muted>운영 자금</Muted>
          <Text style={{ color: cash < 20000 ? theme.bad : theme.text, fontWeight: '800' }}>
            {formatMoney(cash)}
            {lastFinance ? ` (전 시즌 ${lastFinance.net >= 0 ? '+' : ''}${formatMoney(lastFinance.net)})` : ''}
          </Text>
        </Row>
        {lastFinance ? (
          <Muted style={{ fontSize: 11 }}>
            전 시즌: 모기업 {formatMoney(lastFinance.sponsor + lastFinance.bonus)}
            {lastFinance.bonus > 0 ? ` (보너스 ${formatMoney(lastFinance.bonus)})` : ''}
            · 관중 {formatMoney(lastFinance.gate)} (평균 {lastFinance.attendance.toLocaleString()}명)
            · 굿즈 {formatMoney(lastFinance.merch)} · 지출 {formatMoney(lastFinance.expense)}
            {lastFinance.bailout ? ' · ⚠ 모기업 적자 보전' : ''}
          </Muted>
        ) : null}
        <Row>
          <Muted>팬덤</Muted>
          <Text style={{ color: fanScore >= 60 ? theme.good : fanScore >= 35 ? theme.text : theme.bad, fontWeight: '800' }}>
            {fanbaseInfo.total.toLocaleString()}명 · 팬심 {fanScore}
          </Text>
        </Row>
        <Muted style={{ fontSize: 11 }}>
          팀팬 {fanbaseInfo.teamFans.toLocaleString()} + 선수팬 {fanbaseInfo.playerFansNet.toLocaleString()}
          (겹침 제외{fanbaseInfo.top[0] ? ` · 최다 ${fanbaseInfo.top[0].name} ${fanbaseInfo.top[0].fans.toLocaleString()}명` : ''})
        </Muted>
      </Card>

      <Card onPress={() => router.push('/(tabs)/history')}>
        <Row>
          <Muted>리그 순위</Muted>
          <Text style={{ color: theme.text, fontWeight: '800' }}>
            {myRank > 0 ? `${myRank}위 / ${standings.length}` : '-'} ›
          </Text>
        </Row>
      </Card>

      {injuries.length > 0 ? (
        <Card>
          <Muted style={{ marginBottom: 4 }}>🩹 부상자 명단</Muted>
          {injuries.map((s) => {
            const p = getPlayer(s.playerId);
            const back = s.to >= Number.MAX_SAFE_INTEGER
              ? '시즌아웃'
              : `복귀까지 ~${Math.max(1, Math.ceil((s.to - currentDay) / 4))}경기`;
            return (
              <Row key={s.playerId}>
                <Text style={{ color: theme.text, fontWeight: '700' }}>{p?.name ?? s.playerId}</Text>
                <Text style={{ color: s.severity === 'season' ? theme.bad : theme.muted, fontSize: 12 }}>
                  {SEVERITY_KO[s.severity]} · {back}
                </Text>
              </Row>
            );
          })}
        </Card>
      ) : null}

      {latestRoundMvp ? (
        <Card>
          <Row>
            <Muted>이번 시즌 라운드 MVP</Muted>
            <Text style={{ color: theme.text, fontWeight: '800' }}>
              {getPlayer(latestRoundMvp.playerId)?.name ?? ''} ({getTeam(latestRoundMvp.teamId)?.name?.split(' ').slice(-1)[0] ?? ''})
            </Text>
          </Row>
        </Card>
      ) : null}

      {news.length > 0 ? (
        <Card onPress={() => router.push('/(tabs)/history')}>
          <Row>
            <Muted style={{ marginBottom: 4 }}>📰 리그 뉴스</Muted>
            <Text style={{ color: theme.accent }}>전체 ›</Text>
          </Row>
          {news.map((n, i) => (
            <Text
              key={i}
              numberOfLines={1}
              style={{
                color: n.teamId === teamId ? theme.accent : n.big ? theme.warn : theme.text,
                fontSize: 13, fontWeight: n.big ? '800' : '600', paddingVertical: 2,
              }}
            >
              {n.big ? '★ ' : '· '}{n.headline}
            </Text>
          ))}
        </Card>
      ) : null}

      <Button label="일정 보기 / 경기 진행" onPress={() => router.push('/(tabs)/schedule')} />
      <Button label="테스트 경기 (결과 미적용)" variant="ghost" onPress={() => router.push('/exhibition')} />
      <Button label="보드 위치 검증 (개발)" variant="ghost" onPress={() => router.push('/debug-court')} />
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
