import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { Card, IconLabel, Muted, OvrBadge, Row, Screen, theme } from '../../components/Screen';
import { SpotlightOverlay, SpotlightTarget } from '../../components/Spotlight';
import { SoftUpdateBanner } from '../../components/SoftUpdateBanner';
import { evolveOnDay, getTeam } from '../../data/league';
import { seasonYear } from '../../data/seasonLabel';
import { capPayroll } from '../../data/roster';
import { computeStandings, displayCutoff, seasonResults } from '../../data/standings';
import { availableTeamPlayers } from '../../data/injury';
import { rosterIdsOnDay } from '../../data/dynamics';
import { buildNewsFeed, freshNews, newsKey } from '../../data/news';
import { teamOverallRaw } from '../../engine/overall';
import { formatMoney } from '../../engine/salary';
import { formatMoneyShort } from '../../data/money';
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
  const inSeasonTx = useGameStore((s) => s.inSeasonTx);

  const team = getTeam(teamId);
  const ovr = teamOverallRaw(availableTeamPlayers(teamId, currentDay)); // 전력은 그날 출전 가능 명단 기준(경기 엔진과 일치 — EC-UI-01, 부상·결장 반영)
  // 총연봉/캡 = 단일 규칙(capPayroll §7): 그날 명단(시즌 중 영입 포함·방출 제외)에 재계약 override·영입비(inSeasonCost) 반영.
  // 국내만(외인=1년 트라이아웃 별개 지갑, EC-CAP-01) — 시즌 중 FA 영입/재계약이 대시보드 총연봉에 진실되게 잡힌다(store 게이트와 동일 기준).
  const capIds = rosterIdsOnDay(teamId, currentDay);
  const inSeasonSigned = new Set(inSeasonTx.filter((t) => t.kind === 'sign' && t.teamId === teamId).map((t) => t.playerId));
  const isBetrayed = (id: string) => inSeasonTx.some((t) => t.kind === 'release' && t.teamId === teamId && t.playerId === id);
  const capPlayers = capIds.flatMap((id) => { const p = evolveOnDay(id, currentDay); return p ? [p] : []; });
  const payroll = capPayroll(capPlayers, overrides, inSeasonSigned, isBetrayed);
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
  const seasonDraftLog = useGameStore((s) => s.seasonDraftLog);
  const seasonForeignLog = useGameStore((s) => s.seasonForeignLog);
  const allNews = useMemo(
    () => freshNews(buildNewsFeed(archive, milestones, hallOfFame, season, expelledLog, benchDirectives, cutoff, teamId, transfers, retirements, seasonDraftLog, seasonForeignLog, currentDay), cutoff),
    [archive, milestones, hallOfFame, season, cutoff, currentDay, expelledLog, benchDirectives, teamId, transfers, retirements, seasonDraftLog, seasonForeignLog],
  );
  const unreadNews = useMemo(() => {
    const read = new Set(readNews);
    return allNews.filter((n) => !read.has(newsKey(n))).length;
  }, [allNews, readNews]);

  if (!team) return null;

  return (
    <Screen title={team.name} scroll={false}>
      <SoftUpdateBanner />
      {/* ~~"일정 보기 / 경기 진행" CTA 최상단 승격(UI polish)~~ → 제거(2026-07-07, 사용자 결정) —
          경기 진입은 하단 탭 "일정"이 담당(중복 CTA 정리, 홈=현황 요약 집중). 스포트라이트 앵커(dash-top
          이하)는 이 버튼 밖이었고 위치는 런타임 재측정(Spotlight measure)이라 영향 없음. */}
      {/* 팀 종합 전력 + 성적 */}
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
              {lastFinance ? ` (전 시즌 ${lastFinance.net >= 0 ? '+' : ''}${formatMoneyShort(lastFinance.net)})` : ''}
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
