import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, IconLabel, Muted, OvrBadge, Row, Screen, theme } from '../../components/Screen';
import { SpotlightOverlay, SpotlightTarget } from '../../components/Spotlight';
import { SoftUpdateBanner } from '../../components/SoftUpdateBanner';
import { getEvolvedTeamPlayers, getTeam } from '../../data/league';
import { seasonYear } from '../../data/seasonLabel';
import { activeRoster, payroll as sumPayroll } from '../../data/roster';
import { computeStandings, displayCutoff, seasonResults } from '../../data/standings';
import { availableTeamPlayers } from '../../data/injury';
import { buildNewsFeed, freshNews, newsKey } from '../../data/news';
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
  const results = useGameStore((s) => s.results);
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

  // 성적·순위 모두 **결과 인지 표시 컷오프**(§3.3 — displayCutoff: 방금 관전 경기 포함·시즌말 전체 공개, 관전 중 경기 제외).
  const cutoff = displayCutoff(currentDay, results, teamId);
  const record = useMemo(() => {
    let w = 0;
    let l = 0;
    for (const r of seasonResults(cutoff)) {
      const isHome = r.homeTeamId === teamId, isAway = r.awayTeamId === teamId;
      if (!isHome && !isAway) continue;
      const myWin = isHome ? r.homeSets > r.awaySets : r.awaySets > r.homeSets;
      if (myWin) w++;
      else l++;
    }
    return { w, l };
  }, [teamId, cutoff, season]);

  const standings = useMemo(() => computeStandings(cutoff), [cutoff, season]);
  const myRank = standings.findIndex((s) => s.teamId === teamId) + 1;
  const milestones = useGameStore((s) => s.milestones);
  const hallOfFame = useGameStore((s) => s.hallOfFame);
  const expelledLog = useGameStore((s) => s.expelledLog);
  const readNews = useGameStore((s) => s.readNews);
  const benchDirectives = useGameStore((s) => s.benchDirectives);
  const transfers = useGameStore((s) => s.transfers);
  const retirements = useGameStore((s) => s.retirements);
  const allNews = useMemo(
    () => freshNews(buildNewsFeed(archive, milestones, hallOfFame, season, expelledLog, benchDirectives, cutoff, teamId, transfers, retirements), cutoff),
    [archive, milestones, hallOfFame, season, cutoff, expelledLog, benchDirectives, teamId, transfers, retirements],
  );
  const unreadNews = useMemo(() => {
    const read = new Set(readNews);
    return allNews.filter((n) => !read.has(newsKey(n))).length;
  }, [allNews, readNews]);

  if (!team) return null;

  return (
    <Screen title={team.name} scroll={false}>
      <SoftUpdateBanner />
      {/* 다음 경기 = 메인 진입점으로 승격(UI polish, 관전형 1순위). 홈엔 전용 "다음 경기" 카드(상대·전력비교)가
          없고 — 그 데이터는 일정 탭에서 계산 — 가장 가까운 next-match 요소인 "경기 진행" CTA를 최상단으로 올려
          가장 먼저 보이게 한다. 팀 종합 전력은 아래로 내려 보조(secondary). 새 데이터/기능 추가 없이 순서·강조만 변경. */}
      <Button label="일정 보기 / 경기 진행" onPress={() => router.push('/(tabs)/schedule')} />
      {/* 팀 종합 전력 + 성적 (보조) */}
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
              <Text style={{ color: theme.text, fontSize: 26, fontWeight: '700' }}>
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
            <Text style={{ color: payroll > LEAGUE_CAP ? theme.bad : theme.text, fontWeight: '700' }}>
              {formatMoney(payroll)} / {formatMoney(LEAGUE_CAP)}
            </Text>
          </Row>
          <Row>
            <IconLabel icon="wallet-outline" color={theme.warn}>운영 자금</IconLabel>
            <Text style={{ color: cash < 20000 ? theme.bad : theme.text, fontWeight: '700' }}>
              {formatMoney(cash)}
              {lastFinance ? ` (전 시즌 ${lastFinance.net >= 0 ? '+' : ''}${formatMoney(lastFinance.net)})` : ''}
            </Text>
          </Row>
          <Row>
            <IconLabel icon="heart-outline" color={theme.rose}>팬덤</IconLabel>
            <Text style={{ color: fanScore >= 60 ? theme.good : fanScore >= 35 ? theme.text : theme.bad, fontWeight: '700' }}>
              {fanbaseInfo.total.toLocaleString()}명 · 팬심 {fanScore}
            </Text>
          </Row>
        </Card>
      </SpotlightTarget>

      {/* 순위 — 누르면 순위표. 부상은 여기 표시하지 않는다(순위와 무관) — 선수단 탭 🚑 배지로만(2026-07-04 사용자 결정) */}
      <SpotlightTarget id="dash-standings">
        <Card accent={theme.accent} onPress={() => router.push('/standings')}>
          <Row>
            <IconLabel icon="podium-outline" color={theme.accent}>리그 순위</IconLabel>
            <Text style={{ color: theme.text, fontWeight: '700' }}>
              {myRank > 0 ? `${myRank}위 / ${standings.length}` : '-'}
              {' ›'}
            </Text>
          </Row>
        </Card>
      </SpotlightTarget>

      {/* 리그 뉴스 — 진입점만(내용은 뉴스 화면에서). 안읽음 수만 표시.
          카드+앵커는 **항상** 렌더한다: 온보딩(day 0)엔 뉴스가 없어도 dash.news 스포트라이트가 가리킬 대상이 있어야 한다.
          비었을 땐 안읽음 배지 대신 카드 안에 뮤트 안내(시즌이 흐르면 채워짐). onPress·앵커는 그대로. */}
      <SpotlightTarget id="dash-news">
        <Card accent={theme.violet} onPress={() => router.push('/news')}>
          {allNews.length > 0 ? (
            <Row>
              <IconLabel icon="newspaper-outline" color={theme.violet}>리그 뉴스</IconLabel>
              <Text style={{ color: theme.accent, fontWeight: '700' }}>
                {unreadNews > 0 ? `새 소식 ${unreadNews} ›` : '전체 보기 ›'}
              </Text>
            </Row>
          ) : (
            <>
              <IconLabel icon="newspaper-outline" color={theme.violet}>리그 뉴스</IconLabel>
              <Muted>아직 리그 소식이 없어요 — 시즌이 흐르면 기록·사건이 쌓입니다</Muted>
            </>
          )}
        </Card>
      </SpotlightTarget>

      <View style={{ flex: 1 }} />
      <SpotlightOverlay screen="tab-dashboard" />
    </Screen>
  );
}
