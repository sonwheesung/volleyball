import { useRouter } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button, Card, IconLabel, Muted, OvrBadge, Row, Screen, Title, theme, themedStyles } from '../../components/Screen';
import { SpotlightOverlay, SpotlightTarget } from '../../components/Spotlight';
import { SEASON, LEAGUE, getTeam } from '../../data/league';
import { computeStandings, playedThroughDay, leagueDisplayDay } from '../../data/standings';
import { rivalOf } from '../../data/rivalry';
import { teamClinch } from '../../data/clinch';
import { availableTeamPlayers } from '../../data/injury';
import { buildMatchBox } from '../../data/matchBox';
import { SEASON_DAYS } from '../../engine/calendar';
import { isBigMatch } from '../../engine/owner';
import { planNextAction } from '../../engine/advance';
import { teamOverallRaw } from '../../engine/overall';
import { dateForDay, formatDate } from '../../lib/calendar';
import { DEV_TOOLS } from '../../data/flags';
import { useGameStore } from '../../store/useGameStore';

export default function Schedule() {
  const router = useRouter();
  const teamId = useGameStore((s) => s.selectedTeamId)!;
  const season = useGameStore((s) => s.season);
  const currentDay = useGameStore((s) => s.currentDay);
  const results = useGameStore((s) => s.results);
  const archive = useGameStore((s) => s.archive);
  const watchProgress = useGameStore((s) => s.watchProgress);
  const setDay = useGameStore((s) => s.setDay);
  const recordResult = useGameStore((s) => s.recordResult);

  const rival = rivalOf(teamId, archive, results, SEASON, LEAGUE.teams.map((t) => t.id));

  // "진행" 의사결정은 순수 오케스트레이터에 위임
  const action = planNextAction(SEASON, teamId, results);
  const nextFixture = action.kind === 'match' ? action.fixture : null;

  const totalMatches = SEASON.filter((f) => f.homeTeamId === teamId || f.awayTeamId === teamId).length;
  const playedCount = SEASON.filter(
    (f) => (f.homeTeamId === teamId || f.awayTeamId === teamId) && results[f.id],
  ).length;

  // 플레이오프 확정/탈락/경합 — 이미 치른 경기(currentDay)만 반영(스포일러 안전)
  // 시즌 초엔 숨긴다: 확정/탈락(정해진 사건)이거나, 시즌 60% 경과 후에만 표시(후반 레이스)
  const clinch = teamClinch(teamId, playedThroughDay(results)); // 치른 경기만 — 미관전 경기로 PO 확정 스포일 방지
  const playedFrac = totalMatches > 0 ? playedCount / totalMatches : 0;
  const showPlayoff = !!clinch && (clinch.state !== 'contention' || playedFrac >= 0.6);
  const clinchView = showPlayoff && clinch
    ? clinch.state === 'clinched'
      ? { text: `🎉 플레이오프 진출 확정 · 현재 ${clinch.rank}위`, color: theme.good }
      : clinch.state === 'eliminated'
        ? { text: `플레이오프 탈락 · 현재 ${clinch.rank}위`, color: theme.bad }
        : clinch.magic != null
          ? { text: `플레이오프 매직넘버 ${clinch.magic} · 현재 ${clinch.rank}위`, color: theme.accent }
          : { text: `플레이오프 경합 중 · 현재 ${clinch.rank}위`, color: theme.accent }
    : null;

  const onAdvance = () => {
    if (!nextFixture) {
      Alert.alert('시즌 종료', '정규리그 모든 일정을 마쳤습니다.');
      return;
    }
    setDay(nextFixture.dayIndex); // 경기일까지 진행(사이 기간은 자동 훈련/노쇠 재계산)
    router.push(`/match/${nextFixture.id}`);
  };

  // DEV 전용 — 내 팀 미치름 경기를 결정론 결과로 일괄 기록 + 시즌말로 진행(E2E 36탭 회피, EMULATOR_E2E C6).
  // 결과·뉴스·사건사고는 결정론 시뮬이 시즌 전체분을 생성하므로, 완료 후 뉴스 피드에서 중간 사건까지 검수 가능.
  const devCompleteSeason = () => {
    for (const f of SEASON) {
      if ((f.homeTeamId === teamId || f.awayTeamId === teamId) && !results[f.id]) {
        const { sim } = buildMatchBox(f.homeTeamId, f.awayTeamId, f.dayIndex, f.seed);
        recordResult({ fixtureId: f.id, homeSets: sim.homeSets, awaySets: sim.awaySets });
      }
    }
    setDay(SEASON_DAYS); // 시즌말일 → 순위·결과·시상 전체 공개
    Alert.alert('시즌 즉시 완료 (개발)', '정규리그 전 경기를 결정론 결과로 기록했습니다. "포스트시즌 →"으로 진행하세요.');
  };

  const preview = nextFixture
    ? (() => {
        const isHome = nextFixture.homeTeamId === teamId;
        const oppId = isHome ? nextFixture.awayTeamId : nextFixture.homeTeamId;
        // 프리뷰 전력 = 그 경기에 실제로 나설 출전 가능 명단(부상·결장 반영) — 경기/리플레이와 동일 소스(EC-UI-01 동류)
        const myOvr = teamOverallRaw(availableTeamPlayers(teamId, nextFixture.dayIndex));
        const oppOvr = teamOverallRaw(availableTeamPlayers(oppId, nextFixture.dayIndex));
        // 빅매치 판정(Phase 4): 순위 직결이 1순위 — 상위권 맞대결·종반 인접 순위전. 그 다음 접전/강팀
        const standings = computeStandings(leagueDisplayDay(currentDay)); // 리그 진행 기준(§3.2) — 구 day0 MAX는 전 시즌 선반영 스포일러였음
        const myRank = Math.max(1, standings.findIndex((r) => r.teamId === teamId) + 1);
        const oppRank = Math.max(1, standings.findIndex((r) => r.teamId === oppId) + 1);
        const big = isBigMatch(myRank, oppRank, nextFixture.dayIndex);
        const margin = Math.abs(myOvr - oppOvr);
        const late = totalMatches > 0 && playedCount / totalMatches >= 0.8;
        const isRival = rival?.teamId === oppId;
        // 라이벌전이 최우선 프레이밍(숙적은 순위 무관하게 기대됨)
        const reason = isRival ? `🔥 라이벌전 — 숙적 ${getTeam(oppId)?.name ?? ''}`
          : big ? `🔥 빅매치 — ${myRank}위 vs ${oppRank}위` : margin <= 3 ? '접전 예상' : oppOvr >= 76 ? '강팀 상대' : late ? '시즌 막바지' : null;
        const rivalNote = isRival && rival ? `최근 순위 경쟁 ${rival.adjacent}회 · 시즌 상대전적 ${rival.h2hW}승 ${rival.h2hL}패` : null;
        return { isHome, oppName: getTeam(oppId)?.name ?? '', myOvr, oppOvr, important: !!reason, reason, isRival, rivalNote };
      })()
    : null;

  return (
    <Screen title={`${season + 1}시즌 일정`}>
      <Card accent={theme.sky}>
        <Row>
          <IconLabel icon="calendar-outline" color={theme.sky}>정규리그 진행</IconLabel>
          <Text style={{ color: theme.text, fontWeight: '800' }}>
            {playedCount} / {totalMatches} 경기
          </Text>
        </Row>
      </Card>

      {clinchView ? (
        <Card accent={theme.accent}>
          <Row>
            <IconLabel icon="podium-outline" color={theme.accent}>플레이오프</IconLabel>
            <Text style={{ color: clinchView.color, fontWeight: '800' }}>{clinchView.text}</Text>
          </Row>
        </Card>
      ) : null}

      {nextFixture && preview ? (
        <SpotlightTarget id="sched-next">
        <Card accent={theme.sky}>
          <IconLabel icon="calendar-outline" color={theme.sky}>다음 경기 · {formatDate(dateForDay(nextFixture.dayIndex))}</IconLabel>
          {preview.important ? (
            // 긴 빅매치 배지는 날짜와 한 줄에 두면 카드 폭을 넘어 잘린다(UI-20) → 자기 줄로 내리고 좌측 정렬
            <View style={[styles.bigMatch, { alignSelf: 'flex-start', marginTop: 6 }]}>
              <Text style={styles.bigMatchText}>⭐ 중요 · {preview.reason}</Text>
            </View>
          ) : null}
          <Row>
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>
              {preview.isHome ? '홈' : '원정'} vs {preview.oppName}
            </Text>
          </Row>
          <Row>
            <View style={{ alignItems: 'center', gap: 2 }}>
              <Muted style={{ fontSize: 11 }}>우리</Muted>
              <OvrBadge value={preview.myOvr} />
            </View>
            <Text style={{ color: theme.muted, fontWeight: '800' }}>VS</Text>
            <View style={{ alignItems: 'center', gap: 2 }}>
              <Muted style={{ fontSize: 11 }}>상대</Muted>
              <OvrBadge value={preview.oppOvr} />
            </View>
          </Row>
          <Button
            label={nextFixture && watchProgress[nextFixture.id] !== undefined
              ? '이어보기 →'
              : preview.important ? '관전하러 가기 →' : '경기 시작'}
            onPress={onAdvance}
          />
          <Muted style={{ fontSize: 12 }}>
            {preview.isRival && preview.rivalNote
              ? `${preview.rivalNote} — 숙적과의 일전입니다. 직접 관전을 권합니다.`
              : preview.important
                ? '순위 직결 빅매치입니다 — 직접 관전을 권합니다(현장 운영은 감독 몫).'
                : '경기 사이 기간 동안 모든 선수가 자동으로 훈련합니다.'}
          </Muted>
        </Card>
        </SpotlightTarget>
      ) : (
        <Card accent={theme.accent}>
          <Title>시즌 종료</Title>
          <Muted>정규리그 일정을 모두 마쳤습니다. 포스트시즌(상위 3팀)을 치른 뒤 오프시즌으로
            넘어갑니다. (이후 나이 +1·성장/노쇠·계약 -1년)</Muted>
          <Button label="포스트시즌 →" onPress={() => router.push('/playoffs')} />
        </Card>
      )}

      <SpotlightTarget id="sched-calendar">
        <Button label="일정 보러 가기 (캘린더)" variant="ghost" onPress={() => router.push('/calendar')} />
      </SpotlightTarget>
      <SpotlightTarget id="sched-results">
        <Button label="전 구단 경기 결과 보기" variant="ghost" onPress={() => router.push('/results')} />
      </SpotlightTarget>
      {DEV_TOOLS ? (
        <>
          <Button label="🧪 시즌 즉시 완료 (개발용)" variant="ghost" onPress={devCompleteSeason} />
          <Button label="🧪 수비 위치 실험실 (개발용)" variant="ghost" onPress={() => router.push('/board-lab')} />
        </>
      ) : null}
      <SpotlightOverlay screen="tab-schedule" />
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  bigMatch: { backgroundColor: theme.warn + '26', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  bigMatchText: { color: theme.warn, fontSize: 12, fontWeight: '800' },
}));
