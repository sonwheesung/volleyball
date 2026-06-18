import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, Muted, OvrBadge, Row, Screen, theme } from '../../components/Screen';
import { SEASON, getEvolvedTeamPlayers, getTeam } from '../../data/league';
import { activeRoster, payroll as sumPayroll } from '../../data/roster';
import { computeStandings } from '../../data/standings';
import { teamInjuriesOn } from '../../data/injury';
import { buildNewsFeed, newsKey } from '../../data/news';
import { teamOverallRaw } from '../../engine/overall';
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

  const team = getTeam(teamId);
  const basePlayers = getEvolvedTeamPlayers(teamId, currentDay);
  const roster = activeRoster(basePlayers, overrides, released);
  const ovr = teamOverallRaw(basePlayers); // 전력은 전체 스쿼드 기준(경기 엔진과 일치)
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
  const expelledLog = useGameStore((s) => s.expelledLog);
  const readNews = useGameStore((s) => s.readNews);
  const allNews = useMemo(
    () => buildNewsFeed(archive, milestones, hallOfFame, season, expelledLog),
    [archive, milestones, hallOfFame, season, currentDay, expelledLog],
  );
  const unreadNews = useMemo(() => {
    const read = new Set(readNews);
    return allNews.filter((n) => !read.has(newsKey(n))).length;
  }, [allNews, readNews]);

  if (!team) return null;

  return (
    <Screen title={team.name} scroll={false}>
      {/* 전력 + 성적 */}
      <Card>
        <Row>
          <View>
            <Muted>팀 종합 전력</Muted>
            <View style={{ height: 4 }} />
            <OvrBadge value={ovr} size={60} />
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Muted>{season + 1}시즌 성적</Muted>
            <Text style={{ color: theme.text, fontSize: 26, fontWeight: '900' }}>
              {record.w}승 {record.l}패
            </Text>
          </View>
        </Row>
      </Card>

      {/* 재정 — 한 장 요약(상세 내역은 기록 탭) */}
      <Card>
        <Row>
          <Muted>총연봉 / 캡</Muted>
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
        <Row>
          <Muted>팬덤</Muted>
          <Text style={{ color: fanScore >= 60 ? theme.good : fanScore >= 35 ? theme.text : theme.bad, fontWeight: '800' }}>
            {fanbaseInfo.total.toLocaleString()}명 · 팬심 {fanScore}
          </Text>
        </Row>
      </Card>

      {/* 순위 + 부상자 수(있으면) — 누르면 순위표만 */}
      <Card onPress={() => router.push('/standings')}>
        <Row>
          <Muted>리그 순위</Muted>
          <Text style={{ color: theme.text, fontWeight: '800' }}>
            {myRank > 0 ? `${myRank}위 / ${standings.length}` : '-'}
            {injuries.length > 0 ? <Text style={{ color: theme.bad }}>{`  · 🩹 ${injuries.length}`}</Text> : null}
            {' ›'}
          </Text>
        </Row>
      </Card>

      {/* 리그 뉴스 — 진입점만(내용은 뉴스 화면에서). 안읽음 수만 표시 */}
      {allNews.length > 0 ? (
        <Card onPress={() => router.push('/news')}>
          <Row>
            <Muted>📰 리그 뉴스</Muted>
            <Text style={{ color: theme.accent, fontWeight: '800' }}>
              {unreadNews > 0 ? `새 소식 ${unreadNews} ›` : '전체 보기 ›'}
            </Text>
          </Row>
        </Card>
      ) : null}

      <View style={{ flex: 1 }} />

      <Button label="일정 보기 / 경기 진행" onPress={() => router.push('/(tabs)/schedule')} />
      <Button label="설정" variant="ghost" onPress={() => router.push('/settings')} />
    </Screen>
  );
}
