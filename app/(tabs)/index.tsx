import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, IconLabel, Muted, OvrBadge, Row, Screen, theme } from '../../components/Screen';
import { SpotlightOverlay, SpotlightTarget } from '../../components/Spotlight';
import { SoftUpdateBanner } from '../../components/SoftUpdateBanner';
import { getEvolvedTeamPlayers, getTeam } from '../../data/league';
import { seasonYear } from '../../data/seasonLabel';
import { activeRoster, payroll as sumPayroll } from '../../data/roster';
import { computeStandings, leagueDisplayDay, seasonResults } from '../../data/standings';
import { teamInjuriesOn, availableTeamPlayers } from '../../data/injury';
import { buildNewsFeed, newsKey } from '../../data/news';
import { teamOverallRaw } from '../../engine/overall';
import { formatMoney } from '../../engine/salary';
import { teamFanbaseNow } from '../../data/owner';
import { LEAGUE_CAP } from '../../engine/cap';
import { useGameStore } from '../../store/useGameStore';

export default function Dashboard() {
  const router = useRouter();
  const teamId = useGameStore((s) => s.selectedTeamId)!;
  const currentDay = useGameStore((s) => s.currentDay);
  const season = useGameStore((s) => s.season);
  const overrides = useGameStore((s) => s.contractOverrides);
  const released = useGameStore((s) => s.released);

  const team = getTeam(teamId);
  const basePlayers = getEvolvedTeamPlayers(teamId, currentDay);
  const roster = activeRoster(basePlayers, overrides, released);
  const ovr = teamOverallRaw(availableTeamPlayers(teamId, currentDay)); // 전력은 그날 출전 가능 명단 기준(경기 엔진과 일치 — EC-UI-01, 부상·결장 반영)
  // 샐러리캡은 **국내 선수만** 적용(외인은 1년 트라이아웃 별개 지갑 — FOREIGN_SYSTEM 2장, roster.ts domesticPayroll).
  // 외인 연봉을 포함해 국내 전용 캡과 비교하면 멀쩡한 팀도 빨강(허위 초과)이 된다(EC-CAP-01, 2026-06-30). 계약관리 화면과 동일 기준.
  const payroll = sumPayroll(roster.filter((p) => !p.isForeign));
  const fanScore = useGameStore((s) => s.fanScore); // 팬심(직전 시즌 정산)
  const archive = useGameStore((s) => s.archive);
  const cash = useGameStore((s) => s.cash);         // 운영 자금(FINANCE)
  const lastFinance = useGameStore((s) => s.lastFinance);
  const fanbaseInfo = useMemo(
    () => teamFanbaseNow(teamId, currentDay, fanScore, archive),
    [teamId, currentDay, fanScore, archive, season],
  );

  // 성적·순위 모두 **리그 진행 기준**(§3.2 — leagueDisplayDay: 현재 경기일 직전까지, 관전 중 경기 제외).
  // 구버전은 성적=results(관전)·순위=playedThroughDay라 자동진행 리그와 어긋났다. 이제 결과/시즌리더와 동일 컷오프.
  const record = useMemo(() => {
    let w = 0;
    let l = 0;
    for (const r of seasonResults(leagueDisplayDay(currentDay))) {
      const isHome = r.homeTeamId === teamId, isAway = r.awayTeamId === teamId;
      if (!isHome && !isAway) continue;
      const myWin = isHome ? r.homeSets > r.awaySets : r.awaySets > r.homeSets;
      if (myWin) w++;
      else l++;
    }
    return { w, l };
  }, [teamId, currentDay, season]);

  const standings = useMemo(() => computeStandings(leagueDisplayDay(currentDay)), [currentDay, season]);
  const myRank = standings.findIndex((s) => s.teamId === teamId) + 1;
  const injuries = useMemo(() => teamInjuriesOn(teamId, currentDay), [teamId, currentDay, season]);
  const milestones = useGameStore((s) => s.milestones);
  const hallOfFame = useGameStore((s) => s.hallOfFame);
  const expelledLog = useGameStore((s) => s.expelledLog);
  const readNews = useGameStore((s) => s.readNews);
  const benchDirectives = useGameStore((s) => s.benchDirectives);
  const transfers = useGameStore((s) => s.transfers);
  const retirements = useGameStore((s) => s.retirements);
  const allNews = useMemo(
    () => buildNewsFeed(archive, milestones, hallOfFame, season, expelledLog, benchDirectives, leagueDisplayDay(currentDay), teamId, transfers, retirements),
    [archive, milestones, hallOfFame, season, currentDay, expelledLog, benchDirectives, teamId, transfers],
  );
  const unreadNews = useMemo(() => {
    const read = new Set(readNews);
    return allNews.filter((n) => !read.has(newsKey(n))).length;
  }, [allNews, readNews]);

  if (!team) return null;

  return (
    <Screen title={team.name} scroll={false}>
      <SoftUpdateBanner />
      {/* 전력 + 성적 */}
      <SpotlightTarget id="dash-top">
        <Card accent={theme.elite} flat>
          <Row>
            <View>
              <IconLabel icon="barbell-outline" color={theme.elite}>팀 종합 전력</IconLabel>
              <View style={{ height: 4 }} />
              <OvrBadge value={ovr} size={60} />
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Muted>{seasonYear(season)} 성적</Muted>
              <Text style={{ color: theme.text, fontSize: 26, fontWeight: '900' }}>
                {record.w}승 {record.l}패
              </Text>
            </View>
          </Row>
        </Card>
      </SpotlightTarget>

      {/* 재정 — 한 장 요약(상세 기록은 마이페이지 → 기록) */}
      <SpotlightTarget id="dash-finance">
        <Card accent={theme.warn} flat>
          <Row>
            <IconLabel icon="card-outline" color={theme.warn}>총연봉 / 캡</IconLabel>
            <Text style={{ color: payroll > LEAGUE_CAP ? theme.bad : theme.text, fontWeight: '800' }}>
              {formatMoney(payroll)} / {formatMoney(LEAGUE_CAP)}
            </Text>
          </Row>
          <Row>
            <IconLabel icon="wallet-outline" color={theme.warn}>운영 자금</IconLabel>
            <Text style={{ color: cash < 20000 ? theme.bad : theme.text, fontWeight: '800' }}>
              {formatMoney(cash)}
              {lastFinance ? ` (전 시즌 ${lastFinance.net >= 0 ? '+' : ''}${formatMoney(lastFinance.net)})` : ''}
            </Text>
          </Row>
          <Row>
            <IconLabel icon="heart-outline" color={theme.rose}>팬덤</IconLabel>
            <Text style={{ color: fanScore >= 60 ? theme.good : fanScore >= 35 ? theme.text : theme.bad, fontWeight: '800' }}>
              {fanbaseInfo.total.toLocaleString()}명 · 팬심 {fanScore}
            </Text>
          </Row>
        </Card>
      </SpotlightTarget>

      {/* 순위 + 부상자 수(있으면) — 누르면 순위표만 */}
      <SpotlightTarget id="dash-standings">
        <Card accent={theme.accent} onPress={() => router.push('/standings')}>
          <Row>
            <IconLabel icon="podium-outline" color={theme.accent}>리그 순위</IconLabel>
            <Text style={{ color: theme.text, fontWeight: '800' }}>
              {myRank > 0 ? `${myRank}위 / ${standings.length}` : '-'}
              {injuries.length > 0 ? <Text style={{ color: theme.bad }}>{`  · 🩹 ${injuries.length}`}</Text> : null}
              {' ›'}
            </Text>
          </Row>
        </Card>
      </SpotlightTarget>

      {/* 리그 뉴스 — 진입점만(내용은 뉴스 화면에서). 안읽음 수만 표시 */}
      {allNews.length > 0 ? (
        <SpotlightTarget id="dash-news">
          <Card accent={theme.violet} onPress={() => router.push('/news')}>
            <Row>
              <IconLabel icon="newspaper-outline" color={theme.violet}>리그 뉴스</IconLabel>
              <Text style={{ color: theme.accent, fontWeight: '800' }}>
                {unreadNews > 0 ? `새 소식 ${unreadNews} ›` : '전체 보기 ›'}
              </Text>
            </Row>
          </Card>
        </SpotlightTarget>
      ) : null}

      <View style={{ flex: 1 }} />

      <Button label="일정 보기 / 경기 진행" onPress={() => router.push('/(tabs)/schedule')} />
      <SpotlightOverlay screen="tab-dashboard" />
    </Screen>
  );
}
