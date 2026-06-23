import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Muted, OvrBadge, theme } from '../../components/Screen';
import { MatchCourt } from '../../components/MatchCourt';
import { LiveBoxModal } from '../../components/LiveBoxModal';
import { Popup } from '../../components/Popup';
import { BroadcastBanner } from '../../components/BroadcastBanner';
import { buildMatchBanners } from '../../data/broadcast';
import { getFixture, getTeam } from '../../data/league';
import { buildMatchBox } from '../../data/matchBox';
import { DEV_TOOLS } from '../../data/flags';
import { teamOverallRaw } from '../../engine/overall';
import { useGameStore } from '../../store/useGameStore';

export default function MatchBoard() {
  const { id, sandbox, home: homeParam, away: awayParam, seed: seedParam } = useLocalSearchParams<{
    id: string; sandbox?: string; home?: string; away?: string; seed?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const selectedTeamId = useGameStore((s) => s.selectedTeamId);
  const currentDay = useGameStore((s) => s.currentDay);
  const recordResult = useGameStore((s) => s.recordResult);
  const watchProgress = useGameStore((s) => s.watchProgress);
  const saveWatchProgress = useGameStore((s) => s.saveWatchProgress);
  const clearWatchProgress = useGameStore((s) => s.clearWatchProgress);
  const recorded = useRef(false);
  const progressRef = useRef(0); // MatchCourt가 보고하는 현재 랠리 인덱스(이어보기 저장용)
  // 관전이 끝나기 전엔 경기 결과(세트 스코어·승패)를 숨긴다 — 결정론 시뮬이라 미리 계산돼 있어도 스포일러 금지
  const [finished, setFinished] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false); // 관전 중 나가기 확인
  const [statsOpen, setStatsOpen] = useState(false); // 스코어박스 팝업 — 열리면 경기 일시정지(paused), 닫으면 재개
  // 관전 점수(헤더 표시) — MatchCourt가 진행에 맞춰 올려준다(별도 스코어보드 영역 제거). ptIdx=현재 점수가 반영된 득점 인덱스(타임라인 조회용)
  const [score, setScore] = useState({ h: 0, a: 0, homeSets: 0, awaySets: 0, setNo: 1, ptIdx: -1 });
  const handleScore = useCallback((s: { h: number; a: number; homeSets: number; awaySets: number; setNo: number; ptIdx: number }) => setScore(s), []);

  const isSandbox = sandbox === '1';
  const fixture = id && !isSandbox ? getFixture(id) : undefined;

  const data = useMemo(() => {
    let home, away, dayIndex: number, seed: number;
    if (isSandbox) {
      home = homeParam ? getTeam(homeParam) : undefined;
      away = awayParam ? getTeam(awayParam) : undefined;
      if (!home || !away) return null;
      dayIndex = currentDay;
      seed = Number(seedParam) || 1;
    } else {
      if (!fixture) return null;
      home = getTeam(fixture.homeTeamId);
      away = getTeam(fixture.awayTeamId);
      if (!home || !away) return null;
      dayIndex = fixture.dayIndex;
      seed = fixture.seed;
    }
    // 박스스코어 단일 소스 — 경기 상세(matchresult)와 동일 명단(부상·정지·벤치 + 휴식 #3)·시뮬·박스.
    // 둘 다 buildMatchBox만 호출 → 같은 기록 보장(드리프트 차단). boxTimeline=실시간 스코어박스용.
    const { homeSquad, awaySquad, sim, boxTimeline } = buildMatchBox(home.id, away.id, dayIndex, seed);
    return {
      home, away, homeSquad, awaySquad, seed, sim, boxTimeline,
      homeOvr: teamOverallRaw(homeSquad), awayOvr: teamOverallRaw(awaySquad),
    };
  }, [fixture, isSandbox, homeParam, awayParam, seedParam, currentDay, selectedTeamId]);

  const onFinished = useCallback(() => {
    setFinished(true); // 관전 종료 — 이제부터 결과 공개
    if (isSandbox || !data || !fixture || recorded.current) return;
    recorded.current = true;
    recordResult({ fixtureId: fixture.id, homeSets: data.sim.homeSets, awaySets: data.sim.awaySets });
    clearWatchProgress(fixture.id); // 끝까지 봤으니 이어보기 위치 삭제
  }, [isSandbox, data, fixture, recordResult, clearWatchProgress]);

  const onProgress = useCallback((i: number) => { progressRef.current = i; }, []);

  // 이어보기: 관전 위치를 저장하고 나간다(결과 미확정 — 다음에 이 지점부터 다시 본다)
  const handleResume = useCallback(() => {
    if (!isSandbox && fixture) saveWatchProgress(fixture.id, progressRef.current);
    setConfirmExit(false);
    router.back();
  }, [isSandbox, fixture, saveWatchProgress, router]);

  // 결과 확정 = 결정론 결과를 바로 적립(끝까지 본 것과 동일). 이어보기 위치는 삭제.
  const handleExit = useCallback(() => {
    if (!isSandbox && data && fixture && !recorded.current) {
      recorded.current = true;
      recordResult({ fixtureId: fixture.id, homeSets: data.sim.homeSets, awaySets: data.sim.awaySets });
    }
    if (!isSandbox && fixture) clearWatchProgress(fixture.id);
    setConfirmExit(false);
    router.back();
  }, [isSandbox, data, fixture, recordResult, clearWatchProgress, router]);

  // 나가기 요청 — 관전 중(미종료)이면 확인 모달(이어보기/확정 선택), 종료/샌드박스면 즉시 이탈
  const requestExit = useCallback(() => {
    if (finished || isSandbox) handleExit();
    else setConfirmExit(true);
  }, [finished, isSandbox, handleExit]);

  // Android 하드웨어 백 가로채기 — 관전 중엔 확인 모달을 띄운다(결과가 바로 확정되므로)
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (finished || isSandbox || confirmExit) return false; // 기본 동작(나가기) 허용
      setConfirmExit(true);
      return true; // 가로채기
    });
    return () => sub.remove();
  }, [finished, isSandbox, confirmExit]);

  if (isSandbox && !DEV_TOOLS) return <Redirect href="/(tabs)/" />; // 테스트 경기 모드 — 실전 빌드 차단(딥링크 방어)
  if (!data) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 16 }]}>
        <Muted>존재하지 않는 경기입니다.</Muted>
        <Button label="나가기" onPress={() => router.back()} />
      </View>
    );
  }

  const mineSide = selectedTeamId === data.home.id ? 'home' : selectedTeamId === data.away.id ? 'away' : null;

  // 중계 현수막 — 관전 종료 후에만 빌드(스포일러 정책: 결과-결정 사건 누출 0). 샌드박스 제외.
  const banners = useMemo(
    () => (finished && !isSandbox && fixture ? buildMatchBanners(data.home.id, data.away.id, fixture.dayIndex, mineSide) : []),
    [finished, isSandbox, fixture, data.home.id, data.away.id, mineSide],
  );

  return (
    <>
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 16 }]}
    >
      {isSandbox ? <Text style={styles.sandboxTag}>테스트 경기 · 결과 미적용</Text> : null}

      <View style={styles.header}>
        <View style={styles.teamHead}>
          <Text style={styles.sideLabel}>홈</Text>
          <Text style={[styles.teamName, mineSide === 'home' && { color: theme.accent }]} numberOfLines={1}>
            {data.home.name}
          </Text>
          <OvrBadge value={data.homeOvr} />
        </View>
        <View style={styles.scoreMid}>
          <Text style={styles.setNoTxt}>{finished ? '종료' : `${score.setNo}세트`}</Text>
          <Text style={styles.scoreNum}>{score.h} : {score.a}</Text>
          <Text style={styles.setWins}>{score.homeSets} - {score.awaySets} 세트</Text>
        </View>
        <View style={[styles.teamHead, { alignItems: 'flex-end' }]}>
          <Text style={[styles.sideLabel, { textAlign: 'right' }]}>원정</Text>
          <Text style={[styles.teamName, { textAlign: 'right' }, mineSide === 'away' && { color: theme.accent }]} numberOfLines={1}>
            {data.away.name}
          </Text>
          <OvrBadge value={data.awayOvr} />
        </View>
      </View>

      <View style={{ position: 'relative' }}>
        <MatchCourt
          sim={data.sim}
          home={data.homeSquad}
          away={data.awaySquad}
          seed={data.seed}
          mineSide={mineSide}
          startIdx={fixture ? watchProgress[fixture.id] : undefined}
          onProgress={onProgress}
          onFinished={onFinished}
          onScore={handleScore}
          paused={statsOpen}
        />
        {banners.length > 0 ? <BroadcastBanner banners={banners} /> : null}
      </View>

      {/* 세트 스코어 — 관전이 끝난 뒤에만 공개(스포일러 방지) */}
      {finished ? (
        <View style={styles.setScores}>
          {data.sim.setScores.map((s, i) => (
            <View key={i} style={styles.setChip}>
              <Text style={styles.setChipLabel}>{i + 1}세트</Text>
              <Text style={styles.setChipScore}>{s.home}:{s.away}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={{ height: 4 }} />
      <View style={styles.btnRow}>
        <View style={{ flex: 1 }}>
          <Button label="📊 스코어박스" variant="ghost" onPress={() => setStatsOpen(true)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="나가기" onPress={requestExit} />
        </View>
      </View>
      </ScrollView>

      {/* 관전 중 나가기 확인 — 나가면 결정론 결과가 바로 확정된다. 밖 영역 탭으로 안 닫힘(Popup) */}
      <Popup visible={confirmExit} onRequestClose={() => setConfirmExit(false)}>
        <Text style={styles.modalTitle}>경기를 나갈까요?</Text>
        <Text style={styles.modalBody}>
          지금까지 본 위치를 저장합니다.{'\n'}다음에 이 지점부터 이어서 볼 수 있어요.
        </Text>
        <Pressable style={[styles.mBtnWide, styles.mPrimary]} onPress={handleResume}>
          <Text style={styles.mPrimaryText}>나중에 이어보기</Text>
        </Pressable>
        <Pressable style={styles.mTextBtn} onPress={() => setConfirmExit(false)}>
          <Text style={styles.mTextBtnTxt}>계속 관전</Text>
        </Pressable>
      </Popup>

      {/* 스코어박스 — 지금까지 본 점수까지의 누적 박스(boxTimeline). 열리면 경기 일시정지, 닫으면 재개. 스포일러 아님(현재 점수까지만) */}
      <LiveBoxModal
        visible={statsOpen}
        onClose={() => setStatsOpen(false)}
        home={data.homeSquad}
        away={data.awaySquad}
        homeName={data.home.name}
        awayName={data.away.name}
        box={
          data.boxTimeline.length === 0
            ? undefined
            : finished
              ? data.boxTimeline[data.boxTimeline.length - 1]
              : score.ptIdx >= 0
                ? data.boxTimeline[Math.min(score.ptIdx, data.boxTimeline.length - 1)]
                : undefined
        }
        mineSide={mineSide}
      />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  content: { paddingHorizontal: 16, gap: 12 },
  sandboxTag: { color: theme.warn, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 14, padding: 14,
  },
  teamHead: { flex: 1, gap: 4 },
  teamName: { color: theme.text, fontSize: 16, fontWeight: '800' },
  teamOvr: { color: theme.muted, fontSize: 12 },
  sideLabel: { color: theme.muted, fontSize: 11, fontWeight: '700' },
  scoreMid: { alignItems: 'center', minWidth: 86 },
  setNoTxt: { color: theme.accent, fontSize: 11, fontWeight: '700' },
  scoreNum: { color: theme.text, fontSize: 26, fontWeight: '900', marginVertical: 1 },
  setWins: { color: theme.muted, fontSize: 11, fontWeight: '700' },
  setScores: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  btnRow: { flexDirection: 'row', gap: 8 },
  setChip: { backgroundColor: theme.card, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, alignItems: 'center', borderWidth: 1, borderColor: theme.border },
  setChipLabel: { color: theme.muted, fontSize: 10 },
  setChipScore: { color: theme.text, fontSize: 14, fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: '#15202B80', alignItems: 'center', justifyContent: 'center', padding: 28 },
  modal: { backgroundColor: theme.card, borderRadius: 18, padding: 22, gap: 12, alignSelf: 'stretch' },
  modalTitle: { color: theme.text, fontSize: 18, fontWeight: '900', textAlign: 'center' },
  modalBody: { color: theme.muted, fontSize: 13.5, lineHeight: 20, textAlign: 'center' },
  mBtnWide: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  mPrimary: { backgroundColor: theme.accent },
  mPrimaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  mTextBtn: { alignItems: 'center', paddingVertical: 6, marginTop: 2 },
  mTextBtnTxt: { color: theme.muted, fontSize: 14, fontWeight: '700' },
});
