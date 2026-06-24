import { useRouter } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Muted, OvrBadge, Row, Screen, Title, theme } from '../../components/Screen';
import { SpotlightOverlay, SpotlightTarget } from '../../components/Spotlight';
import { SEASON, getTeam } from '../../data/league';
import { computeStandings, playedThroughDay, leagueDisplayDay } from '../../data/standings';
import { teamClinch } from '../../data/clinch';
import { availableTeamPlayers } from '../../data/injury';
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
  const watchProgress = useGameStore((s) => s.watchProgress);
  const setDay = useGameStore((s) => s.setDay);

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
        const reason = big ? `🔥 빅매치 — ${myRank}위 vs ${oppRank}위` : margin <= 3 ? '접전 예상' : oppOvr >= 76 ? '강팀 상대' : late ? '시즌 막바지' : null;
        return { isHome, oppName: getTeam(oppId)?.name ?? '', myOvr, oppOvr, important: !!reason, reason };
      })()
    : null;

  return (
    <Screen title={`${season + 1}시즌 일정`}>
      <Card>
        <Row>
          <Muted>정규리그 진행</Muted>
          <Text style={{ color: theme.text, fontWeight: '800' }}>
            {playedCount} / {totalMatches} 경기
          </Text>
        </Row>
      </Card>

      {clinchView ? (
        <Card>
          <Row>
            <Muted>플레이오프</Muted>
            <Text style={{ color: clinchView.color, fontWeight: '800' }}>{clinchView.text}</Text>
          </Row>
        </Card>
      ) : null}

      {nextFixture && preview ? (
        <SpotlightTarget id="sched-next">
        <Card>
          <Row>
            <Muted>다음 경기 · {formatDate(dateForDay(nextFixture.dayIndex))}</Muted>
            {preview.important ? (
              <View style={styles.bigMatch}>
                <Text style={styles.bigMatchText}>⭐ 중요 · {preview.reason}</Text>
              </View>
            ) : null}
          </Row>
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
            {preview.important
              ? '순위 직결 빅매치입니다 — 직접 관전을 권합니다(현장 운영은 감독 몫).'
              : '경기 사이 기간 동안 모든 선수가 자동으로 훈련합니다.'}
          </Muted>
        </Card>
        </SpotlightTarget>
      ) : (
        <Card>
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
        <Button label="🧪 수비 위치 실험실 (개발용)" variant="ghost" onPress={() => router.push('/board-lab')} />
      ) : null}
      <SpotlightOverlay screen="tab-schedule" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  bigMatch: { backgroundColor: theme.warn + '26', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  bigMatchText: { color: theme.warn, fontSize: 12, fontWeight: '800' },
});
