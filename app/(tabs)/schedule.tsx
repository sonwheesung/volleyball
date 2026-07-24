import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { showAlert } from '../../components/AppDialog';
import { Button, Card, IconLabel, Loading, Muted, OvrBadge, Row, Screen, SCREEN_LOADING_MIN_MS, Title, theme, themedStyles, useDeferredReady } from '../../components/Screen';
import { SpotlightOverlay, SpotlightTarget } from '../../components/Spotlight';
import { GrowthReportModal } from '../../components/GrowthReportModal';
import { growthTrigger, type PlayerGrowth } from '../../data/growthReport';
import { SEASON, LEAGUE, getTeam } from '../../data/league';
import { computeStandings, playedThroughDay, displayCutoff } from '../../data/standings';
import { rivalOf } from '../../data/rivalry';
import { seasonYear } from '../../data/seasonLabel';
import { teamClinch } from '../../data/clinch';
import { availableTeamPlayers } from '../../data/injury';
import { buildMatchBox } from '../../data/matchBox';
import { interventionsFor } from '../../data/dynamics';
import { buildPlayoffs, type Matchup } from '../../data/playoffs';
import { postseasonReveal, nextPoGame } from '../../data/postseason';
import { offseasonHubSteps, offseasonUntouched, type HubStep } from '../../data/offseasonHub';
import { SEASON_DAYS } from '../../engine/calendar';
import { isBigMatch } from '../../engine/owner';
import { planNextAction } from '../../engine/advance';
import { teamOverallRaw } from '../../engine/overall';
import { dateForDay, formatDate } from '../../lib/calendar';
import { useSeasonStartEntry } from '../../lib/seasonStart';
import { DEV_TOOLS } from '../../data/flags';
import { useGameStore } from '../../store/useGameStore';

/** 오프시즌 허브 목록(SEASON_SYSTEM §5.6 · UI-50) — 권장 순서 번호 + [보기]. 잠금·진입 차단 없음.
 *  ✅는 **데이터로 진짜 판정되는 단계**(전지훈련 campDoneSeason)만 — 앞단은 전부 미리보기라 완료 개념이 없다. */
function HubRow({ step, onPress }: { step: HubStep; onPress: () => void }) {
  const tint = (theme as unknown as Record<string, string>)[step.accent] ?? theme.accent;
  return (
    <Pressable onPress={onPress} style={styles.hubRow} accessibilityRole="button" accessibilityLabel={`${step.n}. ${step.label}`}>
      <Text style={[styles.hubNo, { color: tint }]}>{step.n}</Text>
      <View style={{ flex: 1 }}>
        <View style={styles.hubTitleRow}>
          <Text style={styles.hubLabel} numberOfLines={1}>{step.label}</Text>
          {step.done ? <Text style={styles.hubDone}>완료</Text> : null}
        </View>
        <Text style={styles.hubDesc} numberOfLines={2}>{step.desc}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.muted} />
    </Pressable>
  );
}

export default function Schedule() {
  // 일정은 무겁다(순위·전력 프리뷰·클린치·라이벌 재계산). 한 틱 미뤄 로딩부터 그린다.
  const ready = useDeferredReady(SCREEN_LOADING_MIN_MS);
  if (!ready) return <Loading title="일정" variant="list" />;
  return <ScheduleInner />;
}

function ScheduleInner() {
  const router = useRouter();
  const teamId = useGameStore((s) => s.selectedTeamId)!;
  const season = useGameStore((s) => s.season);
  const currentDay = useGameStore((s) => s.currentDay);
  const campDoneSeason = useGameStore((s) => s.campDoneSeason);
  const results = useGameStore((s) => s.results);
  const archive = useGameStore((s) => s.archive);
  const watchProgress = useGameStore((s) => s.watchProgress);
  const setDay = useGameStore((s) => s.setDay);
  const recordResult = useGameStore((s) => s.recordResult);
  const finishCamp = useGameStore((s) => s.finishCamp);
  // 새 시즌 시작(endSeason) 진입점 — 드래프트·라이브와 **같은 훅**을 공유해 광고 이중 노출을 막는다(UI-50 ⑤).
  const seasonStart = useSeasonStartEntry();

  // 성장 리포트(TRAINING §성장리포트) — 일정 화면에 포커스될 때(경기 관전 후 복귀 포함) 마지막으로 본 날부터
  // 지금까지 내 팀 스탯 변화를 diff로 모달. 변화 없으면 조용히 통과. 엔진 무변경(결정론 재계산 diff).
  // 게이트(growthTrigger, 2026-07-08): onAdvance가 경기 진입 직전 currentDay를 올려두므로, 1세트만 보고
  //   "이어보기"로 이탈(경기 미기록)하면 미완 경기에 모달이 떴다 → "직전 경기가 실제로 완료됐을 때만" 표시·bump.
  const [growth, setGrowth] = useState<PlayerGrowth[]>([]);
  useFocusEffect(useCallback(() => {
    const s = useGameStore.getState();
    const t = growthTrigger(SEASON, s.selectedTeamId ?? '', s.results, s.lastGrowthDay, s.currentDay); // 모달=구간 변화 전용(누적은 선수 상세로 이동, 2026-07-11 재정정)
    if (t.bumpTo != null) s.setLastGrowthDay(t.bumpTo); // 보류(null)면 lastGrowthDay 그대로 — 다음 완료 때 그 구간 표시
    if (t.show) setGrowth(t.report);
  }, []));

  // "진행" 의사결정은 순수 오케스트레이터에 위임
  const action = planNextAction(SEASON, teamId, results);
  const nextFixture = action.kind === 'match' ? action.fixture : null;

  // 라이벌은 **다음 경기 프리뷰에서만** 쓰인다 — 다음 경기가 없는 국면(오프시즌·포스트시즌)엔 계산하지 않는다.
  //   (실측 2026-07-24: 오프시즌 rivalOf ≈0.3ms로 비용은 미미하지만, 안 쓰는 계산을 매 렌더 도는 건 제거.)
  const rival = nextFixture ? rivalOf(teamId, archive, results, SEASON, LEAGUE.teams.map((t) => t.id)) : null;

  // ── 포스트시즌 달력 편입(§5) — 정규 완료(seasonOver)면 플옵 진행/브라켓을 일정 화면에서 소비. ──
  const postseason = useMemo(() => {
    if (action.kind !== 'seasonOver') return null;
    const p = buildPlayoffs(season);
    return { p, reveal: postseasonReveal(p, currentDay), next: nextPoGame(p, currentDay, teamId) };
  }, [action.kind, season, currentDay, teamId]);
  // 세리머니 마커(§5.3, 영속 0 파생) — recordChampion은 **시상식(champion-ceremony) 진입 시** 적립.
  //   archive[season].championId 존재 = 시상식을 봤다(세이브 A안 마이그레이션 구세이브 포함 — 재관전 강요 금지)
  //   → 그때부터 "시즌 결산" 버튼. 없으면 "시상식 보러가기"(결승 확정 후). 앱 재시작에도 파생 유지(archive 영속).
  const ceremonyDone = archive.some((a) => a.season === season && !!a.championId);
  const name = (id: string) => getTeam(id)?.name ?? id;

  const totalMatches = SEASON.filter((f) => f.homeTeamId === teamId || f.awayTeamId === teamId).length;
  const playedCount = SEASON.filter(
    (f) => (f.homeTeamId === teamId || f.awayTeamId === teamId) && results[f.id],
  ).length;

  // 플레이오프 확정/탈락/경합 — 이미 치른 경기(currentDay)만 반영(스포일러 안전)
  // 시즌 초엔 숨긴다: 확정/탈락(정해진 사건)이거나, 시즌 60% 경과 후에만 표시(후반 레이스)
  //   clinchView는 `!postseason`일 때만 렌더되므로, 포스트시즌(오프시즌 앞단 포함)엔 아예 계산하지 않는다(죽은 계산 제거).
  const clinch = postseason ? undefined : teamClinch(teamId, playedThroughDay(results)); // 치른 경기만 — 미관전 경기로 PO 확정 스포일 방지
  const playedFrac = totalMatches > 0 ? playedCount / totalMatches : 0;
  const showPlayoff = !!clinch && (clinch.state !== 'contention' || playedFrac >= 0.6);
  const clinchView = showPlayoff && clinch
    ? clinch.state === 'clinched'
      ? { text: `🎉 포스트시즌 진출 확정 · 현재 ${clinch.rank}위`, color: theme.good }
      : clinch.state === 'eliminated'
        ? { text: `포스트시즌 탈락 · 현재 ${clinch.rank}위`, color: theme.bad }
        : clinch.magic != null
          ? { text: `포스트시즌 매직넘버 ${clinch.magic} · 현재 ${clinch.rank}위`, color: theme.accent }
          : { text: `포스트시즌 경합 중 · 현재 ${clinch.rank}위`, color: theme.accent }
    : null;

  const onAdvance = () => {
    if (!nextFixture) {
      showAlert('시즌 종료', '정규리그 모든 일정을 마쳤습니다.');
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
        const { sim } = buildMatchBox(f.homeTeamId, f.awayTeamId, f.dayIndex, f.seed, interventionsFor(f.id));
        recordResult({ fixtureId: f.id, homeSets: sim.homeSets, awaySets: sim.awaySets });
      }
    }
    setDay(SEASON_DAYS); // 시즌말일 → 순위·결과·시상 전체 공개
    showAlert('시즌 즉시 완료 (개발)', '정규리그 전 경기를 결정론 결과로 기록했습니다. "포스트시즌 →"으로 진행하세요.');
  };

  const preview = nextFixture
    ? (() => {
        const isHome = nextFixture.homeTeamId === teamId;
        const oppId = isHome ? nextFixture.awayTeamId : nextFixture.homeTeamId;
        // 프리뷰 전력 = 그 경기에 실제로 나설 출전 가능 명단(부상·결장 반영) — 경기/리플레이와 동일 소스(EC-UI-01 동류)
        const myOvr = teamOverallRaw(availableTeamPlayers(teamId, nextFixture.dayIndex));
        const oppOvr = teamOverallRaw(availableTeamPlayers(oppId, nextFixture.dayIndex));
        // 빅매치 판정(Phase 4): 순위 직결이 1순위 — 상위권 맞대결·종반 인접 순위전. 그 다음 접전/강팀
        const standings = computeStandings(displayCutoff(currentDay, results, teamId)); // 결과 인지 표시 컷오프(§3.3)
        const myRank = Math.max(1, standings.findIndex((r) => r.teamId === teamId) + 1);
        const oppRank = Math.max(1, standings.findIndex((r) => r.teamId === oppId) + 1);
        const big = isBigMatch(myRank, oppRank, nextFixture.dayIndex);
        const margin = Math.abs(myOvr - oppOvr);
        const late = totalMatches > 0 && playedCount / totalMatches >= 0.8;
        const isRival = rival?.teamId === oppId;
        // 라이벌전이 최우선 프레이밍(숙적은 순위 무관하게 기대됨)
        const reason = isRival ? `🔥 라이벌전, 숙적 ${getTeam(oppId)?.name ?? ''}`
          : big ? `🔥 빅매치, ${myRank}위 vs ${oppRank}위` : margin <= 3 ? '접전 예상' : oppOvr >= 76 ? '강팀 상대' : late ? '시즌 막바지' : null;
        const rivalNote = isRival && rival ? `최근 순위 경쟁 ${rival.adjacent}회 · 시즌 상대전적 ${rival.h2hW}승 ${rival.h2hL}패` : null;
        return { isHome, oppName: getTeam(oppId)?.name ?? '', myOvr, oppOvr, important: !!reason, reason, isRival, rivalNote };
      })()
    : null;

  // 오프시즌 게이트(2026-07-04 사용자 요청): currentDay 0 + 이번 시즌 전지훈련 미완료 → **오프시즌 허브만** 노출하고
  // 다음 경기(개막전)는 숨긴다. 개막은 허브의 "개막전으로"(finishCamp) 또는 캠프 화면의 "마치고 개막전으로"로 연다.
  //   ~~반드시 캠프를 거쳐야~~ → 정정(2026-07-24, §5.6): 캠프를 강제로 거치게 하면 캠프 화면이 죽었을 때 개막이 막힌다
  //   (완료 게이트 = 새 소프트락, UI-50 ②). 허브에서 바로 개막할 수 있고, 안 했으면 확인만 묻는다.
  const offseason = currentDay === 0 && campDoneSeason !== season;
  const campDone = campDoneSeason === season;

  // ── 오프시즌 허브(§5.6) ──
  // 앞단 = endSeason 전(시상식까지 본 seasonOver 국면), 뒷단 = endSeason 후(day0). **목록도 최종 버튼도 다르다**.
  const preSteps = useMemo(() => offseasonHubSteps('pre'), []);
  const postSteps = useMemo(() => offseasonHubSteps('post', campDone), [campDone]);
  const openStep = (route: string) => router.push(route as never);

  // 앞단 최종 버튼 — 광고 → season-start → endSeason. **완료 게이트 없음**(항상 노출).
  //   "아무 결정도 안 함"은 방문 마커가 아니라 **결정 데이터의 부재**로 판정(레버가 전부 비어 있음) → 그때만 확인.
  const onStartNewSeason = () => {
    const s = useGameStore.getState();
    if (offseasonUntouched(s)) {
      showAlert('이대로 새 시즌을 시작할까요?',
        '외국인·아시아쿼터·FA·드래프트에서 아직 아무 결정도 하지 않았습니다.\n그대로 시작하면 감독·스카우트가 대신 결정합니다.',
        [{ text: '더 둘러보기', style: 'cancel' }, { text: '이대로 시작', onPress: () => { void seasonStart.start(); } }]);
      return;
    }
    void seasonStart.start();
  };

  // 뒷단 최종 버튼 — 전지훈련 미완료면 확인 후 개막(캠프 화면을 거치지 않아도 개막 가능 = 소프트락 봉인).
  const onOpenSeason = () => {
    if (campDone) { finishCamp(); return; }
    showAlert('전지훈련 없이 개막할까요?',
      '이번 오프시즌 전지훈련을 아직 마치지 않았습니다.\n개막하면 이번 시즌에는 전지훈련을 보낼 수 없어요.',
      [{ text: '전지훈련 보러 가기', style: 'cancel', onPress: () => router.navigate('/training-camp') },
       { text: '이대로 개막', onPress: () => finishCamp() }]);
  };

  return (
    <Screen title={`${seasonYear(season)} 일정 · ${season + 1}번째 시즌`} insetBottom={false}>
      {/* 포스트시즌 구간(§5.1.2)엔 스테일 정규 정보(진행 164/164·clinch)를 숨겨 브라켓/다음경기를 최상단으로. */}
      {postseason ? null : (
        <Card accent={theme.sky} flat>
          <Row>
            <IconLabel icon="calendar-outline" color={theme.sky}>정규리그 진행</IconLabel>
            <Text style={{ color: theme.text, fontWeight: '700' }}>
              {playedCount} / {totalMatches} 경기
            </Text>
          </Row>
        </Card>
      )}

      {/* 오프시즌 허브 · 뒷단(§5.6.2) — 헌액 · 전지훈련 + [개막전으로]. 잠금 없음: 어느 항목이든 언제나 열린다.
          스포트라이트 앵커 sched-next는 오프시즌엔 이 카드가 담당(2026-07-05 불일치 수정분 승계). */}
      {offseason ? (
        <SpotlightTarget id="sched-next">
          <Card accent={theme.good} flat>
            <IconLabel icon="snow-outline" color={theme.good}>오프시즌 준비 · 개막까지</IconLabel>
            <Muted style={{ fontSize: 12, marginTop: 2, marginBottom: 4 }}>
              권장 순서입니다. 순서와 관계없이 언제든 열 수 있고, 건너뛰어도 개막할 수 있어요.
            </Muted>
            {postSteps.map((s) => (
              // navigate(≠push): 스택에 이미 그 화면이 있으면 재사용 — 중복 인스턴스가 쌓여 "마쳐도 또 나오는" 반복 노출 방지(2026-07-11)
              <HubRow key={s.key} step={s} onPress={() => router.navigate(s.route as never)} />
            ))}
            <Button label="개막전으로 →" onPress={onOpenSeason} />
          </Card>
        </SpotlightTarget>
      ) : null}

      {clinchView && !postseason ? (
        <Card accent={theme.accent} flat>
          <Row>
            <IconLabel icon="podium-outline" color={theme.accent}>포스트시즌</IconLabel>
            <Text style={{ color: clinchView.color, fontWeight: '700' }}>{clinchView.text}</Text>
          </Row>
        </Card>
      ) : null}

      {offseason ? null : nextFixture && preview ? (
        <SpotlightTarget id="sched-next">
        <Card accent={theme.sky} flat>
          <IconLabel icon="calendar-outline" color={theme.sky}>다음 경기 · {formatDate(dateForDay(nextFixture.dayIndex, season))}</IconLabel>
          {preview.important ? (
            // 긴 빅매치 배지는 날짜와 한 줄에 두면 카드 폭을 넘어 잘린다(UI-20) → 자기 줄로 내리고 좌측 정렬
            <View style={[styles.bigMatch, { alignSelf: 'flex-start', marginTop: 6 }]}>
              <Text style={styles.bigMatchText}>⭐ 중요 · {preview.reason}</Text>
            </View>
          ) : null}
          <Row>
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>
              {preview.isHome ? '홈' : '원정'} vs {preview.oppName}
            </Text>
          </Row>
          <Row>
            <View style={{ alignItems: 'center', gap: 2 }}>
              <Muted style={{ fontSize: 11 }}>우리</Muted>
              <OvrBadge value={preview.myOvr} />
            </View>
            <Text style={{ color: theme.muted, fontSize: 17, fontWeight: '700' }}>VS</Text>
            <View style={{ alignItems: 'center', gap: 2 }}>
              <Muted style={{ fontSize: 11 }}>상대</Muted>
              <OvrBadge value={preview.oppOvr} />
            </View>
          </Row>
          <Button
            compact
            label={nextFixture && watchProgress[nextFixture.id] !== undefined
              ? '이어보기 →'
              : preview.important ? '관전하러 가기 →' : '경기 시작'}
            onPress={onAdvance}
          />
        </Card>
        </SpotlightTarget>
      ) : postseason ? (
        // 포스트시즌 달력 편입(§5) — 진출 3팀 브라켓 + 치른(공개) 시리즈 + 다음 경기(내 팀=보드 경유/타 팀=결과 확인).
        (() => {
          const { p, reveal, next } = postseason;
          const seriesCard = (title: string, m: Matchup | null, revealed: number) => {
            if (!m || revealed === 0) return null;
            const games = m.series.games.slice(0, revealed);
            const hiW = games.filter((g) => g.hiSets > g.loSets).length;
            const loW = games.filter((g) => g.loSets > g.hiSets).length;
            return (
              <Card accent={theme.gold} key={title} flat>
                <IconLabel icon="trophy-outline" color={theme.gold}>{title}</IconLabel>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
                  <Text style={[{ flex: 1, textAlign: 'right', color: theme.text, fontWeight: '700' }, m.hiId === teamId && { color: theme.accent }]} numberOfLines={1}>{name(m.hiId)}</Text>
                  <Text style={{ color: theme.text, fontSize: 18, fontWeight: '900', minWidth: 52, textAlign: 'center' }}>{hiW} : {loW}</Text>
                  <Text style={[{ flex: 1, color: theme.text, fontWeight: '700' }, m.loId === teamId && { color: theme.accent }]} numberOfLines={1}>{name(m.loId)}</Text>
                </View>
                <Text style={{ color: theme.muted, fontSize: 12, textAlign: 'center', marginTop: 4 }}>{games.map((g) => `${g.hiSets}-${g.loSets}`).join('  ')}</Text>
              </Card>
            );
          };
          return (
            <>
              <Card accent={theme.accent} flat>
                <IconLabel icon="podium-outline" color={theme.accent}>포스트시즌 · 진출 3팀</IconLabel>
                {p.seeds.map((id, i) => (
                  <Text key={id} style={[{ color: theme.text, fontSize: 15, fontWeight: '600', marginTop: 2 }, id === teamId && { color: theme.accent }]}>
                    {i + 1}위 {name(id)}{i === 0 ? ' (챔프전 직행)' : ''}
                  </Text>
                ))}
              </Card>
              {seriesCard('플레이오프 (2위 vs 3위 · 3전2선승)', p.po, reveal.poRevealed)}
              {seriesCard('챔피언결정전 (5전3선승)', p.final, reveal.finalRevealed)}
              {next ? (
                <Card accent={theme.sky} flat>
                  <IconLabel icon="calendar-outline" color={theme.sky}>
                    {next.round === 'po' ? '플레이오프' : '챔피언결정전'} {next.g + 1}차전 · {formatDate(dateForDay(next.day, season))}
                  </IconLabel>
                  <Row><Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>{name(next.hiId)} vs {name(next.loId)}</Text></Row>
                  {next.mine ? (
                    <Button label="관전하러 가기 →" onPress={() => router.push(`/match/playoff?po=${next.round}&g=${next.g}&season=${season}`)} />
                  ) : (
                    // 타 구단 경기 = 결과 확인만(자동 진행). setDay로 슬롯 도달 → 위 시리즈 카드에 결과 공개.
                    // + 탭 지점 직접 피드백(2026-07-12 무피드백 전수조사): 결과가 위쪽 카드에만 조용히 반영돼 "됐나?" 소지 → 스코어 alert.
                    //   결과(hiSets/loSets)는 결정론 파생이라 이미 확정값. 버튼이 "결과 확인"이라 스포일러 정책과 무충돌(사용자가 명시적으로 여는 것).
                    <Button label="결과 확인 →" onPress={() => {
                      setDay(next.day);
                      const mm = next.round === 'po' ? p.po : p.final;
                      const g = mm?.series.games[next.g];
                      if (g) showAlert('경기 결과', `${name(next.hiId)} ${g.hiSets} : ${g.loSets} ${name(next.loId)}\n${name(g.hiSets > g.loSets ? next.hiId : next.loId)} 승리`);
                    }} />
                  )}
                </Card>
              ) : reveal.championRevealed ? (
                // 세리머니 3단(§5.3): ①시상식(champion→awards, recordChampion은 시상식 진입 시) → 일정 복귀 → ②오프시즌 허브.
                <>
                  <Card accent={theme.gold} flat>
                    <Title>🏆 우승, {name(p.championId ?? '')}</Title>
                    {!ceremonyDone ? (
                      <>
                        <Muted>포스트시즌이 끝났습니다. 시상식을 관람한 뒤 오프시즌으로 넘어갑니다.</Muted>
                        <Button label="시상식 보러가기 →" onPress={() => router.push('/champion-ceremony')} />
                      </>
                    ) : (
                      <Muted>시상식이 끝났습니다. 아래에서 오프시즌 업무를 보고 새 시즌을 시작하세요.</Muted>
                    )}
                  </Card>
                  {/* 오프시즌 허브 · 앞단(§5.6.2) — 결산·외국인·아시아쿼터·FA·드래프트 + [새 시즌 시작하기].
                      ~~단일 체인(결산 → 트라이아웃 → … → 드래프트)~~ → 정정(2026-07-24): 한 화면이 죽으면 오프시즌에서
                      못 빠져나오는 소프트락이 됐다(FA 렌더 크래시 a04c0bc). 전 단계를 허브에서 나란히 연다. */}
                  {ceremonyDone ? (
                    <Card accent={theme.accent} flat>
                      <IconLabel icon="snow-outline" color={theme.accent}>오프시즌 업무 · 다음 시즌 준비</IconLabel>
                      <Muted style={{ fontSize: 12, marginTop: 2, marginBottom: 4 }}>
                        권장 순서입니다. 순서와 관계없이 언제든 열 수 있고, 건너뛴 자리는 감독·스카우트가 대신 결정합니다.
                        {season === 0 ? ' 처음이라면 1번부터 차례로 둘러보세요.' : ''}
                      </Muted>
                      {preSteps.map((s) => <HubRow key={s.key} step={s} onPress={() => openStep(s.route)} />)}
                      {/* 미리보기 신뢰(§5.6.3 ⑥): 외국인·아시아쿼터 결정이 FA 예산을 바꾼다 — 정적 주의 문구로 안내(무거운 프리뷰 금지) */}
                      <Muted style={{ fontSize: 11.5, marginTop: 6 }}>
                        외국인·아시아쿼터 결정을 바꾸면 FA에 쓸 운영 자금이 달라집니다. 마지막에 FA 센터를 한 번 더 확인하세요.
                      </Muted>
                      <Button
                        label={seasonStart.starting ? '시즌 준비 중…' : '새 시즌 시작하기 →'}
                        disabled={seasonStart.starting}
                        onPress={onStartNewSeason}
                      />
                    </Card>
                  ) : null}
                </>
              ) : null}
            </>
          );
        })()
      ) : (
        <Card accent={theme.accent} flat>
          <Title>시즌 종료</Title>
          <Muted>정규리그 일정을 모두 마쳤습니다.</Muted>
        </Card>
      )}

      <SpotlightTarget id="sched-calendar">
        <Button label="우리 팀 일정 보기" variant="ghost" onPress={() => router.push('/calendar')} />
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
      <GrowthReportModal visible={growth.length > 0} report={growth} onClose={() => setGrowth([])} />
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  bigMatch: { backgroundColor: theme.warn + '26', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  bigMatchText: { color: theme.warn, fontSize: 12, fontWeight: '700' },
  // 오프시즌 허브 목록(§5.6) — 번호 + 제목/설명 + 화살표. 잠금 아이콘 없음(진입 차단 0).
  hubRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: theme.border },
  hubNo: { width: 20, textAlign: 'center', fontSize: 15, fontWeight: '900' },
  hubTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hubLabel: { color: theme.text, fontSize: 15, fontWeight: '800', flexShrink: 1 },
  hubDone: { color: theme.good, fontSize: 11, fontWeight: '800' },
  hubDesc: { color: theme.muted, fontSize: 12, marginTop: 1 },
}));
