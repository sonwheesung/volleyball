import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import { Button, Muted, theme, themedStyles } from '../../components/Screen';
import { emblemFor } from '../../data/emblems';
import { MatchCourt } from '../../components/MatchCourt';
import { LiveBoxModal } from '../../components/LiveBoxModal';
import { Popup } from '../../components/Popup';
import { useToastQueue, ToastHost } from '../../components/Toast';
import { POS_COLOR } from '../../components/posTokens';
import { BroadcastBanner } from '../../components/BroadcastBanner';
import { buildMatchBanners, type Banner } from '../../data/broadcast';
import { reconstructRallies, buildLiveBanners, applySubsToSix } from '../../components/courtDirector';
import { getFixture, getTeam, shortTeamName, coachInfoOf } from '../../data/league';
import { buildMatchBox } from '../../data/matchBox';
import { interventionsFor } from '../../data/dynamics';
import { ivBudget as selIvBudget, ivExclusions, benchCandidates, outCandidates, pendingSubEntries, type IvExclusions, type IvCoord } from '../../data/matchInterventionView';
import { buildLineup } from '../../engine/lineup';
import { SUBS_PER_SET, TIMEOUTS_PER_SET, isSetOver } from '../../engine/match';
import { serverIndex } from '../../engine/rotation';
import { overallRaw, displayOvr } from '../../engine/overall';
import { deriveRatings } from '../../engine/ratings';
import type { MatchIntervention } from '../../engine/simMatch';
import type { Side, Player } from '../../types';
import { buildPlayoffs, poSeedBase, finalSeedBase } from '../../data/playoffs';
import { buildPlayoffBox, type PoRound } from '../../data/postseason';
import { PO_SLOTS, FINAL_SLOTS } from '../../engine/calendar';
import { DEV_TOOLS } from '../../data/flags';
import { SpotlightOverlay, SpotlightTarget } from '../../components/Spotlight';
import { tipsForScreen } from '../../data/tutorialSteps';
import { useGameStore } from '../../store/useGameStore';

// 주기적 이어보기 체크포인트 — 크래시/강제종료(백그라운드 이벤트 없이 죽는 경우)까지 커버.
// 5초마다, 위치 변화 시에만 저장(풀세이브 쓰기 최소화). 튜닝값
const WATCH_SAVE_INTERVAL_MS = 5000;

export default function MatchBoard() {
  const { id, sandbox, home: homeParam, away: awayParam, seed: seedParam, po: poParam, g: gParam, season: seasonParam } = useLocalSearchParams<{
    id: string; sandbox?: string; home?: string; away?: string; seed?: string; po?: string; g?: string; season?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // 경기 관전 중 화면 자동 꺼짐 방지(관전형 1순위 = 보는 경험). 화면 이탈(언마운트) 시 훅이 자동 해제.
  useKeepAwake();
  const selectedTeamId = useGameStore((s) => s.selectedTeamId);
  const currentDay = useGameStore((s) => s.currentDay);
  const recordResult = useGameStore((s) => s.recordResult);
  const recordIntervention = useGameStore((s) => s.recordIntervention);
  const setDay = useGameStore((s) => s.setDay);
  // 이 경기의 개입 로그 구독 — 바뀌면 data(sim) 재계산 → 프리픽스 불변으로 현재 지점부터 이어재생(§2·§4)
  const myIv = useGameStore((s) => s.interventions[id && sandbox !== '1' ? id : '']);
  // ── 포스트시즌 보드(달력 편입 §5.1) — po=round(po|final)·g=게임인덱스·season. 있으면 플옵 재생 모드. ──
  //   결과를 results에 안 씀(신규 영속 0) — 종료 시 setDay(슬롯day)로 currentDay 전진 = "치른 경기" 파생.
  const isPlayoff = (poParam === 'po' || poParam === 'final') && gParam != null && seasonParam != null;
  const poRound = poParam as PoRound;
  const poG = Number(gParam);
  const poSeason = Number(seasonParam);
  const poSlotDay = isPlayoff ? (poRound === 'po' ? PO_SLOTS[poG] : FINAL_SLOTS[poG]) : undefined;
  const watchProgress = useGameStore((s) => s.watchProgress);
  const saveWatchProgress = useGameStore((s) => s.saveWatchProgress);
  const clearWatchProgress = useGameStore((s) => s.clearWatchProgress);
  // 경기 보드 스포트라이트가 아직 미완(미본 스텝 존재)인가 — 있으면 재생 일시정지(구 showTip 팝업 대체, 2026-07-14).
  //   결정론 무영향: 재생 프레임만 멈추고 엔진 시뮬은 불변. 샌드박스는 오버레이를 안 그리므로(아래 !isSandbox) 여기서도
  //   제외 — 안 그러면 탭해 넘길 오버레이가 없는데 paused가 영영 true(구 showTip의 sandbox!=='1' 예외 승계).
  const tutorialActive = useGameStore((s) => sandbox !== '1' && tipsForScreen('match').some((t) => !(s.seenTips?.[t.id])));
  const recorded = useRef(false);
  const progressRef = useRef(0); // MatchCourt가 보고하는 현재 랠리 인덱스(이어보기 저장용)
  const lastSavedRef = useRef(0); // 마지막으로 저장한 인덱스 — 위치 미변화 시 중복 풀세이브 쓰기 스킵
  // 관전이 끝나기 전엔 경기 결과(세트 스코어·승패)를 숨긴다 — 결정론 시뮬이라 미리 계산돼 있어도 스포일러 금지
  const [finished, setFinished] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false); // 관전 중 나가기 확인
  const [statsOpen, setStatsOpen] = useState(false); // 스코어박스 팝업 — 열리면 경기 일시정지(paused), 닫으면 재개
  // ── 경기 개입(MATCH_INTERVENTION_SYSTEM §3·§4) — 내 팀 경기 opt-in. 열리면 재생 일시정지(paused에 OR). ──
  const [interveneOpen, setInterveneOpen] = useState(false);
  const [ivStep, setIvStep] = useState<'menu' | 'pickOut' | 'pickIn' | 'confirm'>('menu'); // 개입 시트 단계
  const [pendingOut, setPendingOut] = useState<string | null>(null);            // 뺄 선수(교체 out) 선택 보관
  const [pendingIn, setPendingIn] = useState<string | null>(null);              // 넣을 선수(교체 in) 선택 보관 — 확인 단계용
  const [ivSubKind, setIvSubKind] = useState<'manual' | 'pinch'>('manual');     // 교체 종류: 세트 끝까지 / 서브 교체(서브권 잃으면 자동 복귀)
  const [ivError, setIvError] = useState<string | null>(null);                  // 적용 불가 안내(드라이런 실패)
  // 타임아웃 커밋을 좌표로 MatchCourt에 명시 신호 — seek 추론(index)이 어긋나 모달을 놓치던 것 대신 좌표 매칭으로 확실히 표시(§3 #3)
  const [toSignal, setToSignal] = useState<{ seq: number; setNo: number; h: number; a: number } | null>(null);
  const { toasts, push: pushToast } = useToastQueue();                          // 성공 피드백(비모달, 관전형)
  // 관전 점수(헤더 표시) — MatchCourt가 진행에 맞춰 올려준다(별도 스코어보드 영역 제거). ptIdx=현재 점수가 반영된 득점 인덱스(타임라인 조회용)
  const [score, setScore] = useState({ h: 0, a: 0, homeSets: 0, awaySets: 0, setNo: 1, ptIdx: -1 });
  const handleScore = useCallback((s: { h: number; a: number; homeSets: number; awaySets: number; setNo: number; ptIdx: number }) => setScore(s), []);

  const isSandbox = sandbox === '1';
  const fixture = id && !isSandbox ? getFixture(id) : undefined;

  const data = useMemo(() => {
    let home, away, dayIndex: number, seed: number;
    if (isPlayoff) {
      // 포스트시즌 재생 — buildPlayoffBox가 playSeries와 입력 바이트 공유(§5.1). hi=홈.
      const p = buildPlayoffs(poSeason);
      const m = poRound === 'po' ? p.po : p.final;
      if (!m || poG < 0 || poG >= m.series.games.length) return null;
      home = getTeam(m.hiId);
      away = getTeam(m.loId);
      if (!home || !away) return null;
      const box = buildPlayoffBox(poSeason, poRound, poG, p);
      seed = (poRound === 'po' ? poSeedBase(poSeason) : finalSeedBase(poSeason)) + poG * 1009;
      return { home, away, homeSquad: box.homeSquad, awaySquad: box.awaySquad, seed, sim: box.sim, boxTimeline: box.boxTimeline };
    }
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
    // 개입 로그(§2.2): 정규시즌 fixture만 주입(샌드박스=fixtureId 없음, 플옵은 위 분기에서 이미 return — 2단계 범위 밖).
    const { homeSquad, awaySquad, sim, boxTimeline } = buildMatchBox(home.id, away.id, dayIndex, seed, isSandbox ? [] : interventionsFor(fixture!.id));
    return {
      home, away, homeSquad, awaySquad, seed, sim, boxTimeline,
    };
  }, [fixture, isSandbox, isPlayoff, poSeason, poRound, poG, homeParam, awayParam, seedParam, currentDay, selectedTeamId, myIv]);

  const onFinished = useCallback(() => {
    setFinished(true); // 관전 종료 — 이제부터 결과 공개
    if (isPlayoff) { // 플옵: results에 안 쓰고 currentDay를 슬롯day로 전진(치른 경기 파생, §5.1)
      if (!recorded.current && poSlotDay != null) { recorded.current = true; setDay(poSlotDay); }
      return;
    }
    if (isSandbox || !data || !fixture || recorded.current) return;
    recorded.current = true;
    recordResult({ fixtureId: fixture.id, homeSets: data.sim.homeSets, awaySets: data.sim.awaySets });
    clearWatchProgress(fixture.id); // 끝까지 봤으니 이어보기 위치 삭제
  }, [isPlayoff, poSlotDay, setDay, isSandbox, data, fixture, recordResult, clearWatchProgress]);

  const onProgress = useCallback((i: number) => { progressRef.current = i; }, []);

  // 이어보기: 관전 위치를 저장하고 나간다(결과 미확정 — 다음에 이 지점부터 다시 본다)
  const handleResume = useCallback(() => {
    if (!isSandbox && fixture) saveWatchProgress(fixture.id, progressRef.current);
    setConfirmExit(false);
    router.back();
  }, [isSandbox, fixture, saveWatchProgress, router]);

  // 결과 확정 = 결정론 결과를 바로 적립(끝까지 본 것과 동일). 이어보기 위치는 삭제.
  const handleExit = useCallback(() => {
    if (isPlayoff) { // 플옵 "결과 확정"(⏭·나가기) — currentDay 전진(§5.1). 스킵 경로 유지(BOARD_RULES 룰49).
      if (!recorded.current && poSlotDay != null) { recorded.current = true; setDay(poSlotDay); }
      setConfirmExit(false);
      router.back();
      return;
    }
    if (!isSandbox && data && fixture && !recorded.current) {
      recorded.current = true;
      recordResult({ fixtureId: fixture.id, homeSets: data.sim.homeSets, awaySets: data.sim.awaySets });
    }
    if (!isSandbox && fixture) clearWatchProgress(fixture.id);
    setConfirmExit(false);
    router.back();
  }, [isPlayoff, poSlotDay, setDay, isSandbox, data, fixture, recordResult, clearWatchProgress, router]);

  // 나가기 요청 — 관전 중(미종료)이면 확인 모달(이어보기/확정 선택), 종료/샌드박스면 즉시 이탈
  const requestExit = useCallback(() => {
    if (finished || isSandbox) handleExit();
    else setConfirmExit(true);
  }, [finished, isSandbox, handleExit]);

  // 앱이 백그라운드/비활성으로 갈 때 관전 위치를 자동 저장 — 홈 버튼 후 OS가 앱을 종료해도
  // 이어보기 위치가 보존된다("나중에 이어보기"를 안 눌러도). 종료(finished)엔 저장 안 함
  // (결과가 확정/확정 중이고 watchProgress는 확정 시 삭제 — 저장하면 낡은 위치가 되살아남).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'background' && next !== 'inactive') return;
      if (!isSandbox && fixture && !finished && progressRef.current > 0) {
        saveWatchProgress(fixture.id, progressRef.current);
        lastSavedRef.current = progressRef.current; // 주기 체크포인트와 중복 저장 방지
      }
    });
    return () => sub.remove();
  }, [isSandbox, fixture, finished, saveWatchProgress]);

  // 주기적 이어보기 체크포인트 — 백그라운드 이벤트 없이 죽는 크래시/강제종료까지 커버(위 AppState 저장의 보완).
  // 5초마다 위치가 진전됐을 때만 저장(풀세이브 쓰기 최소화 — 일시정지/랠리 사이/정체 중엔 스킵).
  useEffect(() => {
    const timer = setInterval(() => {
      if (!isSandbox && fixture && !finished && progressRef.current > 0 && progressRef.current !== lastSavedRef.current) {
        saveWatchProgress(fixture.id, progressRef.current);
        lastSavedRef.current = progressRef.current;
      }
    }, WATCH_SAVE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isSandbox, fixture, finished, saveWatchProgress]);

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

  // ── 경기 개입(§3·§4) — 내 팀 정규시즌 경기에서만 노출(플옵·샌드박스·상대팀·종료 후 숨김) ──
  const canIntervene = mineSide != null && !isSandbox && !isPlayoff && !finished && fixture != null;

  // 전 선수 조회 맵(교체 대상·투입 후보 이름/포지션/OVR)
  const byIdAll = useMemo(() => {
    const m = new Map<string, typeof data.homeSquad[number]>();
    for (const p of data.homeSquad) m.set(p.id, p);
    for (const p of data.awaySquad) m.set(p.id, p);
    return m;
  }, [data.homeSquad, data.awaySquad]);

  const mySquad = mineSide === 'home' ? data.homeSquad : mineSide === 'away' ? data.awaySquad : [];
  // 선발 6인(고정) — 빈 로스터 방어. **buildMatchBox 시뮬과 동일한 육성철학(dvPhilosophy)으로 라인업을 구성해야**
  //   시뮬 subEvents(실제 코트 슬롯 기준)를 이 base에 재생했을 때 코트가 일치한다. dv를 빼면 감독 육성철학이 높은 팀에서
  //   OP 등 근소차 슬롯이 어긋나(예: dv97 → OP가 원선발과 다른 U23) 개입 후보·코트 표시가 실제 시뮬과 불일치(2026-07-21 발견).
  const myDvPhilosophy = mineSide ? (coachInfoOf(mineSide === 'home' ? data.home.id : data.away.id)?.dvPhilosophy ?? 0) : 0;
  const myBaseSix = useMemo(() => (mySquad.length ? buildLineup(mySquad, myDvPhilosophy).six : []), [mySquad, myDvPhilosophy]);
  // 이 경기 유저 개입 지시 목록 — 스테일 카운트 수정(§4)의 pending 항 소스. myIv 변화 시 재구독(재시뮬 트리거와 동일).
  const myDirectives = useMemo(() => (fixture && !isSandbox ? interventionsFor(fixture.id) : []), [fixture, isSandbox, myIv]);
  // 개입 좌표(현재 데드볼) — 셀렉터 공용. score 변화 시만 재생성.
  const cur = useMemo<IvCoord>(() => ({ setNo: score.setNo, h: score.h, a: score.a, ptIdx: score.ptIdx }), [score.setNo, score.h, score.a, score.ptIdx]);
  // 현재(다음 랠리 = 개입 적용 지점 ptIdx+1)의 코트 6인 — **재생 완료(point≤ptIdx)까지만 재생 + 내 pending 개입만** 얹는다.
  //   raw ptIdx+1 컷오프는 같은 iteration의 **감독 자동 교체(rest/pinch/block/def, point=ptIdx+1)까지 미리 혼입**(데드볼의 7.82%,
  //   감사 P1~P2)해 아직 화면에 안 나온 미래 교체가 코트에 뜨던 것 — pendingSubEntries(유저 inId 매칭)만 적용해 대칭 복원.
  const curSix = useMemo(() => {
    if (!mineSide || !myBaseSix.length) return [];
    const replayed = applySubsToSix(myBaseSix, mineSide, data.sim.subEvents, score.ptIdx, byIdAll); // ≤ptIdx만(미래 자동교체 배제)
    const pend = pendingSubEntries(data.sim, mineSide, cur, myDirectives);
    if (!pend.length) return replayed;
    const six = replayed.slice();
    for (const e of pend) { const p = byIdAll.get(e.inId); if (p) six[e.slot] = p; } // 내 개입 enter만 얹음
    return six;
  }, [mineSide, myBaseSix, data.sim, score.ptIdx, byIdAll, cur, myDirectives]);
  // 개입 후보/예산 배제 집합(순수 셀렉터 data/matchInterventionView) — **재생 완료(point<=ptIdx) + 방금 커밋한 내 개입(pending,
  //   point=ptIdx+1)** 이중 항. 감독 자동 교체(같은 point지만 유저 inId 미재사용)는 배제 → 미래 자동 교체 오산 방지.
  const ivEx = useMemo<IvExclusions>(() =>
    ivExclusions(data.sim, (mineSide ?? 'home'), cur, myDirectives),
  [data.sim, mineSide, cur, myDirectives]);
  // 벤치 투입 후보(benchCands) — 같은 포지션 제한(2026-07-12 사용자 결정): OH 자리에 세터 방지. 같은 포지션 벤치 없으면 후보 0(안내).
  //   방금 투입한 선수는 curSix(uptoRally=ptIdx+1)에 반영돼 onCourt가 배제, 방금 나간 선수는 ivEx.enterOutIds가 배제(스테일 수정).
  const benchCands = useMemo(() =>
    (mineSide && mySquad.length) ? benchCandidates(mySquad, curSix, byIdAll, pendingOut, ivEx) : [],
  [mineSide, mySquad, curSix, byIdAll, pendingOut, ivEx]);
  // 코트에서 뺄 후보(pickOut) — 엔진 subIn이 반드시 거부하는 슬롯(부상교체 투입자·복귀선발·활성 교체 투입자)을 사전 제외해
  //   "먹통 버튼"(UV-7 ⑥) 방지. ivEx가 pending을 포함하므로 같은 데드볼 연속 교체 시 이미 투입/아웃된 선수가 즉시 반영된다.
  const outCands = useMemo(() => (mineSide ? outCandidates(curSix, ivEx) : curSix), [mineSide, curSix, ivEx]);
  // 이번 세트 잔여 개입 예산(UV-7 ④ · 문서 §4) — 순수 셀렉터(엔진 subBudget/timeouts와 동일 산식 + pending 항).
  const ivBudget = useMemo(() =>
    mineSide ? selIvBudget(data.sim, mineSide, cur, myDirectives) : { subLeft: 0, toLeft: 0 },
  [mineSide, data.sim, cur, myDirectives]);
  // 후보 정렬 — 서브 교체(핀치)는 서브 스탯 내림차순(잘 넣는 선수 먼저, 사용자 요청), 일반 교체는 OVR 내림차순.
  const sortedBench = useMemo(() =>
    ivSubKind === 'pinch'
      ? [...benchCands].sort((a, b) => deriveRatings(b).serve - deriveRatings(a).serve)
      : [...benchCands].sort((a, b) => overallRaw(b) - overallRaw(a)),
  [benchCands, ivSubKind]);
  // 현재(다음 랠리) 서브권이 내 팀인가 — 서브 교체(핀치)는 서브권이 있어야 실효(없으면 즉시 자동복원). 랠리포인트제:
  //   직전 점수 득점 팀이 다음 서브. 세트 첫 랠리면 setFirstServers.
  const iAmServing = useMemo(() => {
    if (!mineSide) return false;
    const pts = data.sim.points;
    const i = score.ptIdx;
    if (i >= 0 && pts[i] && pts[i].setNo === score.setNo) return pts[i].scorer === mineSide;
    return (data.sim.setFirstServers?.[score.setNo - 1]) === mineSide;
  }, [mineSide, data.sim, score.ptIdx, score.setNo]);
  // 서브 교체(핀치) 사전차단(F1) — 서브 교체는 뺄 선수를 안 고르고 **현재 서버 슬롯**을 자동 타겟(§4 #4)한다.
  //   그 슬롯 선수가 엔진 subIn이 반드시 거부하는 상태(①세터 ③부상교체슬롯 ②활성교체슬롯 ④복귀선발)면 메뉴에서
  //   미리 차단 + 정확한 사유를 보여준다(확정 후 부정확 문구 방지). 서버 슬롯 = 로테이션 재생(reconstructRallies,
  //   엔진 match.ts 규칙과 동일 — tools/_dv_rotation_replay 가드가 트레이스 대조로 박제) → serverIndex(rot).
  //   최종 진실은 commitIntervention 드라이런: 여기서 못 잡은 잔여 케이스는 onConfirmSub 폴백이 같은 사유로 처리.
  const pinchBlock = useMemo<{ blocked: boolean; reason: string | null }>(() => {
    if (!mineSide || !iAmServing || !curSix.length) return { blocked: false, reason: null };
    const at = reconstructRallies(data.sim)[score.ptIdx + 1]; // 주입 지점 = 다음 랠리(진입 상태)의 로테이션
    if (!at || at.setNo !== score.setNo) return { blocked: false, reason: null }; // 세트 경계 등 — 드라이런에 위임
    const slot = serverIndex(mineSide === 'home' ? at.homeRot : at.awayRot);
    const server = curSix[slot];
    if (!server) return { blocked: false, reason: null };
    // ① 세터는 서브차례여도 안 뺀다(5-1 무결성 — 엔진도 세터면 no-op). 엔진 subIn 거부 순서: ③부상 → ②활성 → ④복귀.
    if (server.position === 'S') return { blocked: true, reason: '지금 서브 차례가 세터예요 — 세터는 빼지 않아요' };
    // 슬롯 상태(현 세트) = 재생 완료(point<=ptIdx) + pending(방금 커밋한 내 개입, point=ptIdx+1) — ivEx 공유(스테일 수정).
    //   injurySlots=부상교체 슬롯(영구 잠금)·activeSlots=활성 교체 슬롯(net)·enterOutIds=나갔던 선발 id(복귀 시 재이탈 금지). 엔진 subIn 가드와 대칭.
    if (ivEx.injurySlots.has(slot)) return { blocked: true, reason: '부상 교체가 들어간 자리예요' };
    if (ivEx.activeSlots.has(slot)) return { blocked: true, reason: '이미 교체가 들어간 자리예요' };
    if (ivEx.enterOutIds.has(server.id)) return { blocked: true, reason: '한 번 나갔다 돌아온 선수 자리라 다시 못 빼요' };
    return { blocked: false, reason: null };
  }, [mineSide, iAmServing, curSix, data.sim, score.ptIdx, score.setNo, ivEx]);
  // 코트 선수 체력(가능하면) — **현재 세트**의 마지막 타임아웃 스냅샷에서 id→잔량(0..1). 감사 P2 ②:
  //   ① 이전 산식은 setNo 미필터라 직전 세트 스냅샷을 집어 세트 간 회복(SET_REST)이 반영 안 된 낡은 체력을 보였다 →
  //      현재 세트로 한정(세트 개막 직후엔 스냅샷 없음 → 미표시가 오해보다 안전). ② 코치 TO뿐 아니라 테크니컬 TO(TTO)도
  //      유효 스냅샷이라 포함(가장 최근 것) → 캡션은 "작전 타임아웃"이 아니라 "직전 타임아웃"으로 정정(사실 일치).
  //   세트 개막(0:0) 유저 TO는 엔진 클램프로 point=ptIdx+1에 기록(match.ts) → 현재 좌표(같은 h·a) 클램프 TO도 포함(감사 P1 ③).
  const stamMap = useMemo(() => {
    const m = new Map<string, number>();
    if (!mineSide) return m;
    const evs = (data.sim.timeouts ?? []).filter((t) => t.setNo === score.setNo
      && (t.point <= score.ptIdx || (t.point === score.ptIdx + 1 && t.home === score.h && t.away === score.a)));
    const last = evs[evs.length - 1];
    if (last) for (const s of mineSide === 'home' ? last.stamHome : last.stamAway) m.set(s.id, s.stam);
    return m;
  }, [data.sim, score.ptIdx, score.setNo, score.h, score.a, mineSide]);

  const closeIntervene = useCallback(() => {
    setInterveneOpen(false); setIvStep('menu'); setPendingOut(null); setPendingIn(null); setIvError(null);
  }, []);

  // 확정 = 드라이런 검증(§3) → 적용됐으면 커밋. 재시뮬 프리픽스 불변이라 개입 좌표(현재 점수)의 이벤트만 델타.
  const commitIntervention = useCallback((iv: MatchIntervention): boolean => {
    if (!fixture) return false;
    const tentative = [...interventionsFor(fixture.id), iv];
    const dry = buildMatchBox(data.home.id, data.away.id, fixture.dayIndex, data.seed, tentative).sim;
    let applied = false;
    if (iv.kind === 'sub') {
      const wantKind = iv.subKind === 'pinch' ? 'pinch' : 'manual';
      // 개입 sub은 랠리 루프 최상단에서 주입 → SubEvent.point = points.length = score.ptIdx+1 (엔진 match.ts:255;
      //   주입 시점 points.length==ptIdx+1 — 현재 점수 points[ptIdx] 직후 iteration). 개수 비교 대신 **좌표 정밀 매칭**:
      //   base에 같은 선수 AI 핀치가 있으면 내 개입이 그 좌표를 선점(AI 소멸)해 count 동수 → 오거부되던 버그(UV-7 ③).
      //   kind='manual'은 개입 전용, 'pinch'는 내가 먼저 코트에 올려 같은 좌표·같은 inId AI 핀치가 생길 수 없어 유일.
      applied = (dry.subEvents ?? []).some((e) => e.enter && e.point === score.ptIdx + 1 && e.kind === wantKind && e.inId === iv.inId);
    } else {
      // 타임아웃은 좌표 count 비교 유지(§4). 미적용 사유(한도 소진 vs 이미 타임아웃 존재)는 호출부 onTimeout에서 분기.
      const has = (sim: typeof dry) => (sim.timeouts ?? []).filter((t) => t.side === iv.side && t.setNo === iv.at.setNo && t.home === iv.at.h && t.away === iv.at.a).length;
      applied = has(dry) > has(data.sim);
    }
    if (!applied) return false;
    recordIntervention(fixture.id, iv); // 영속 + 캐시 bump(§2.3) → data 재계산 → 이어재생
    return true;
  }, [fixture, data.home.id, data.away.id, data.seed, data.sim, score.ptIdx, recordIntervention]);

  const onTimeout = useCallback(() => {
    if (!mineSide) return;
    const ok = commitIntervention({ at: { setNo: score.setNo, h: score.h, a: score.a }, side: mineSide as Side, kind: 'timeout' });
    if (ok) {
      // 커밋된 타임아웃 좌표를 신호 → MatchCourt가 그 좌표의 타임아웃 이벤트를 찾아 체력 모달을 확실히 띄운다(10초 자동)
      setToSignal((prev) => ({ seq: (prev?.seq ?? 0) + 1, setNo: score.setNo, h: score.h, a: score.a }));
      pushToast('작전 타임아웃을 요청했어요');
      closeIntervene();
    } else if (isSetOver(score.h, score.a, score.setNo)) {
      // 세트말(세트 종료 점수 표시 창)에서의 커밋은 엔진이 그 세트를 이미 빠져나가 **영구 no-op** — '한도 소진'이 아님(감사 P2 ③).
      setIvError('이 세트는 끝났어요. 다음 세트가 시작되면 타임아웃을 쓸 수 있어요.');
    } else {
      // 미적용 분기(UV-7 ③): 좌표 count가 안 늘어난 게 '한도 소진'이 아니라 '이 좌표에 이미 타임아웃 존재'일 수 있다
      //   (AI가 같은 순간 부른 타임아웃을 내 강제 호출이 대체 → count 동수). 한도 문구 오출력 방지로 사유 분기.
      const dup = (data.sim.timeouts ?? []).some((t) => t.side === mineSide && t.setNo === score.setNo && t.home === score.h && t.away === score.a);
      setIvError(dup
        ? '이 시점엔 이미 작전 타임아웃이 있어요.'
        : '지금은 타임아웃을 쓸 수 없어요. 이번 세트 타임아웃을 이미 다 썼어요.');
    }
  }, [mineSide, commitIntervention, score, data.sim, pushToast, closeIntervene]);

  const onConfirmSub = useCallback((inId: string) => {
    if (!mineSide) return;
    if (ivSubKind !== 'pinch' && !pendingOut) return; // 일반 교체는 뺄 선수 필수(서브 교체는 서버 자동 타겟 §4 #4)
    const ok = commitIntervention({
      at: { setNo: score.setNo, h: score.h, a: score.a }, side: mineSide as Side, kind: 'sub',
      // 서브 교체는 outId 없음 → 엔진이 현재 서버 슬롯을 자동 타겟. 일반 교체만 pendingOut 지정.
      ...(ivSubKind === 'pinch' ? {} : { outId: pendingOut! }), inId, subKind: ivSubKind,
    });
    if (ok) {
      pushToast(ivSubKind === 'pinch'
        ? `${byIdAll.get(inId)?.name ?? '선수'} 선수를 서브 교체했어요 (서브권 넘어가면 자동 복귀)`
        : `${byIdAll.get(inId)?.name ?? '선수'} 선수를 투입했어요`);
      closeIntervene();
    } else if (isSetOver(score.h, score.a, score.setNo)) {
      // 세트말 커밋은 영구 no-op(엔진이 세트를 이미 빠져나감) — '한도 소진'이 아님(감사 P2 ③).
      setIvError('이 세트는 끝났어요. 다음 세트가 시작되면 교체할 수 있어요.');
    } else setIvError(ivSubKind === 'pinch'
      // 사전차단(pinchBlock)이 못 잡은 잔여 케이스 대비 — 가능하면 정확한 사유를, 없으면 일반 문구.
      ? (pinchBlock.reason ?? '지금은 서브 교체가 어려워요. 서브 차례 선수가 세터이거나 이번 세트 교체 한도가 찼어요.')
      : '지금은 교체할 수 없어요. 이번 세트 교체 한도가 찼거나 규칙상 불가한 교체예요.');
  }, [mineSide, pendingOut, ivSubKind, commitIntervention, score, byIdAll, pushToast, closeIntervene, pinchBlock]);

  // 중계 현수막 — 관전 종료 후에만 빌드(스포일러 정책: 결과-결정 사건 누출 0). 샌드박스 제외.
  const banners = useMemo(
    () => (finished && !isSandbox && fixture ? buildMatchBanners(data.home.id, data.away.id, fixture.dayIndex, mineSide) : []),
    [finished, isSandbox, fixture, data.home.id, data.away.id, mineSide],
  );

  // 경기 중 실시간 현수막(Phase 3) — 재생 위치(ptIdx)가 배너 at에 도달하면 큐에 push. 결과-중립/관전동시 사건만(스포일러 안전).
  const liveBanners = useMemo(() => {
    const byId = new Map([...data.homeSquad, ...data.awaySquad].map((p) => [p.id, p] as const));
    return buildLiveBanners(reconstructRallies(data.sim), mineSide, {
      homeName: shortTeamName(data.home.id), awayName: shortTeamName(data.away.id),
      nameOf: (pid) => byId.get(pid)?.name ?? '선수',
    });
  }, [data, mineSide]);
  const [liveQueue, setLiveQueue] = useState<Banner[]>([]);
  // 이어보기 재개 시 재생 위치(shown)는 resumeAt-1에서 시작한다 → 그 지점 배너는 지난 세션에서 이미 봤다.
  // 마운트 시점의 시작 위치를 기억해 at <= 시작위치인 배너를 다시 큐에 넣지 않는다(4.6% 재개에서 배너 재생 수정 2026-07-07).
  const initialPtIdx = useRef(fixture ? (watchProgress[fixture.id] ?? 0) - 1 : -1);
  // 이미 큐에 넣은 배너 식별키(at+kind+title) — 개입 커밋 시 data.sim 재계산으로 liveBanners **참조가 바뀌어** effect가 재실행되면
  //   같은 ptIdx 배너가 재push되던 중복(감사 P2 ①)을 막는다. 프리픽스 바이트 동일이라 at≤ptIdx 배너는 키가 같아 자연 dedup.
  const pushedBanners = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (finished) return;
    const keyOf = (b: { at: number; banner: Banner }) => `${b.at}:${b.banner.kind}:${b.banner.title}`;
    const fresh = liveBanners.filter((b) => b.at === score.ptIdx && b.at > initialPtIdx.current && !pushedBanners.current.has(keyOf(b)));
    if (fresh.length) {
      for (const b of fresh) pushedBanners.current.add(keyOf(b));
      setLiveQueue((q) => [...q, ...fresh.map((b) => b.banner)]);
    }
  }, [score.ptIdx, liveBanners, finished]);

  return (
    <>
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 16 }]}
    >
      {isSandbox ? <Text style={styles.sandboxTag}>테스트 경기 · 결과 미적용</Text> : null}

      {/* 글래스 스코어보드 — 엠블럼(팀명 위 가운데) + 세트 스코어 + 점수 + 세트 진행 칩(OVR 제거, 사용자 요청 2026-06-28) */}
      <View style={styles.scoreboard}>
        <View style={styles.sbSide}>
          <Image source={emblemFor(data.home.id)} style={styles.sbEmblem} />
          <Text style={[styles.sbName, mineSide === 'home' && { color: theme.accent }]} numberOfLines={1}>{data.home.name}</Text>
        </View>
        <View style={styles.sbMid}>
          {/* 관전 메인 = 현재 점수(크게), 세트 스코어는 보조(작게 위) — 2026-06-28 위치 교정 */}
          <Text style={styles.sbSetLabel}>세트 {score.homeSets} : {score.awaySets}</Text>
          <Text style={styles.sbSetScore}>{finished ? '종료' : `${score.h} : ${score.a}`}</Text>
        </View>
        <View style={styles.sbSide}>
          <Image source={emblemFor(data.away.id)} style={styles.sbEmblem} />
          <Text style={[styles.sbName, mineSide === 'away' && { color: theme.accent }]} numberOfLines={1}>{data.away.name}</Text>
        </View>
      </View>
      <View style={styles.setPillWrap}>
        <View style={styles.setPill}>
          <Text style={styles.setPillTxt}>{finished ? '경기 종료' : `${score.setNo}세트 진행 중`}</Text>
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
          timeoutSignal={toSignal}
          paused={statsOpen || tutorialActive || interveneOpen}
          homeName={data.home.name}
          awayName={data.away.name}
          homeDv={coachInfoOf(data.home.id)?.dvPhilosophy ?? 0}
          awayDv={coachInfoOf(data.away.id)?.dvPhilosophy ?? 0}
        />
        {!finished && liveQueue.length > 0 ? <BroadcastBanner key="live" banners={liveQueue} /> : null}
        {finished && banners.length > 0 ? <BroadcastBanner key="fin" banners={banners} /> : null}
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

      <SpotlightTarget id="match-controls">
        <View style={styles.btnRow}>
          <View style={{ flex: 1 }}>
            <Button compact label="스코어박스" variant="ghost" onPress={() => setStatsOpen(true)} />
          </View>
          {canIntervene ? (
            <View style={{ flex: 1 }}>
              <Button compact label="⚙ 개입" variant="ghost" onPress={() => { setIvStep('menu'); setIvError(null); setInterveneOpen(true); }} />
            </View>
          ) : null}
          <View style={{ flex: 1 }}>
            <Button compact label="나가기" onPress={requestExit} />
          </View>
        </View>
      </SpotlightTarget>
      </ScrollView>

      {/* 관전 중 나가기 확인 — 나가면 결정론 결과가 바로 확정된다. 밖 영역 탭으로 안 닫힘(Popup) */}
      {/* 플옵 경기는 fixture가 없어 이어보기(watchProgress)를 저장하지 않는다(§5.1 — 결과는 currentDay 파생). 문구를 사실대로 분기. */}
      <Popup visible={confirmExit} onRequestClose={() => setConfirmExit(false)}>
        <Text style={styles.modalTitle}>경기를 나갈까요?</Text>
        <Text style={styles.modalBody}>
          {isPlayoff
            ? '포스트시즌 경기는 이어보기가 없어\n다음에 처음부터 다시 재생됩니다.'
            : '지금까지 본 위치를 저장합니다.\n다음에 이 지점부터 이어서 볼 수 있어요.'}
        </Text>
        <Pressable style={[styles.mBtnWide, styles.mPrimary]} onPress={handleResume}>
          <Text style={styles.mPrimaryText}>{isPlayoff ? '나가기' : '나중에 이어보기'}</Text>
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
        finished={finished}
        homeDv={coachInfoOf(data.home.id)?.dvPhilosophy ?? 0}
        awayDv={coachInfoOf(data.away.id)?.dvPhilosophy ?? 0}
      />

      {/* 경기 개입 시트(§3·§4) — 데드볼(현재 점수)에서 작전 타임아웃·선수 교체. 현재 점수까지만 표시(미래 스포일러 금지). */}
      <Popup visible={interveneOpen} onRequestClose={closeIntervene}>
        <Text style={styles.modalTitle}>경기 개입</Text>
        <Text style={styles.ivScore}>{score.setNo}세트 · {score.h} : {score.a}</Text>

        {ivStep === 'menu' ? (
          <>
            {/* 세 메뉴 카드는 동일 구조(제목+부제)·동일 높이(#1). 타임아웃만 강조색(배경)이 다르다.
                남은 예산 표시 + 소진 시 비활성(UV-7 ④·§4) — 엔진 no-op을 '먹통'으로 오인 방지. 교체는 엔진 게이트(subBudget<2)와
                동일하게 잔여 <2면 비활성(왕복 2유닛 확보), 타임아웃은 0이면 비활성. */}
            <Pressable
              style={[styles.ivPickBtn, styles.ivPickBtnPrimary, ivBudget.toLeft <= 0 && { opacity: 0.45 }]}
              disabled={ivBudget.toLeft <= 0}
              onPress={onTimeout}>
              <Text style={[styles.ivPickBtnTxt, styles.ivPickBtnTxtOn]}>⏱ 작전 타임아웃</Text>
              <Text style={[styles.ivPickSub, styles.ivPickSubOn]}>
                {ivBudget.toLeft > 0 ? `기세를 끊고 체력 회복 · 남은 ${ivBudget.toLeft}/${TIMEOUTS_PER_SET}` : '이번 세트 타임아웃을 다 썼어요'}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.ivPickBtn, ivBudget.subLeft < 2 && { opacity: 0.45 }]}
              disabled={ivBudget.subLeft < 2}
              onPress={() => { setIvSubKind('manual'); setIvError(null); setIvStep('pickOut'); }}>
              <Text style={styles.ivPickBtnTxt}>🔄 선수 교체</Text>
              <Text style={styles.ivPickSub}>
                {ivBudget.subLeft >= 2 ? `이번 세트 끝까지 유지 · 남은 ${ivBudget.subLeft}/${SUBS_PER_SET}` : '이번 세트 교체 한도를 다 썼어요'}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.ivPickBtn, (!iAmServing || ivBudget.subLeft < 2 || pinchBlock.blocked) && { opacity: 0.45 }]}
              disabled={ivBudget.subLeft < 2 || pinchBlock.blocked}
              onPress={() => {
                if (!iAmServing) { setIvError('서브 교체는 우리 팀 서브권일 때 쓸 수 있어요.'); return; }
                // 서브 교체는 서버가 자동 대상(§4 #4) → 뺄 선수 고르는 단계(pickOut) 건너뛰고 바로 넣을 서버 선택.
                setIvSubKind('pinch'); setPendingOut(null); setIvError(null); setIvStep('pickIn');
              }}>
              <Text style={styles.ivPickBtnTxt}>🎯 서브 교체</Text>
              <Text style={styles.ivPickSub}>
                {/* 사유 우선순위: 한도 소진 → 서브권 없음 → 서버 슬롯 거부(F1: 세터/부상·활성 교체 슬롯/복귀 선발) → 정상 */}
                {ivBudget.subLeft < 2
                  ? '이번 세트 교체 한도를 다 썼어요'
                  : !iAmServing
                    ? '지금은 서브권이 없어요'
                    : pinchBlock.blocked
                      ? pinchBlock.reason
                      : `서브권 넘어가면 자동 복귀 · 남은 ${ivBudget.subLeft}/${SUBS_PER_SET}`}
              </Text>
            </Pressable>
            {ivError ? <Text style={styles.ivError}>{ivError}</Text> : null}
            <Pressable style={styles.mTextBtn} onPress={closeIntervene}>
              <Text style={styles.mTextBtnTxt}>닫기</Text>
            </Pressable>
          </>
        ) : ivStep === 'pickOut' ? (
          <>
            <Text style={styles.ivHint}>코트에서 뺄 선수를 선택하세요</Text>
            {/* 체력 %는 마지막 타임아웃 스냅샷 기준(stamMap) — 실시간 아님. 스냅샷 없으면 미표시(캡션도 숨김, UV-7 ⑤). */}
            {stamMap.size > 0 ? <Text style={styles.ivStamNote}>체력 %는 직전 타임아웃 시점 기준이에요</Text> : null}
            {outCands.length === 0 ? (
              <Text style={styles.ivError}>지금은 뺄 수 있는 선수가 없어요. (이번 세트 교체·부상 규칙상 코트 선수 전원이 고정)</Text>
            ) : (
              <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false}>
                {outCands.map((p) => (
                  <IvPlayerRow key={p.id} name={p.name} pos={p.position} ovr={displayOvr(overallRaw(p))} stam={stamMap.get(p.id)} stats={subStatChips(p, false)}
                    onPress={() => { setPendingOut(p.id); setIvError(null); setIvStep('pickIn'); }} />
                ))}
              </ScrollView>
            )}
            <Pressable style={styles.mTextBtn} onPress={() => { setIvStep('menu'); setIvError(null); }}>
              <Text style={styles.mTextBtnTxt}>뒤로</Text>
            </Pressable>
          </>
        ) : ivStep === 'pickIn' ? (
          <>
            <Text style={styles.ivHint}>
              {ivSubKind === 'pinch'
                ? '서브에 투입할 선수를 선택하세요'
                : `${byIdAll.get(pendingOut ?? '')?.name ?? '선수'} 대신 넣을 선수를 선택하세요`}
            </Text>
            {stamMap.size > 0 ? <Text style={styles.ivStamNote}>체력 %는 직전 타임아웃 시점 기준이에요</Text> : null}
            {benchCands.length === 0 ? (
              <Text style={styles.ivError}>
                {ivSubKind === 'pinch' ? '투입할 수 있는 벤치 선수가 없어요.' : '같은 포지션에 투입할 수 있는 벤치 선수가 없어요.'}
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false}>
                {sortedBench.map((p) => (
                  <IvPlayerRow key={p.id} name={p.name} pos={p.position} ovr={displayOvr(overallRaw(p))} stam={stamMap.get(p.id)} stats={subStatChips(p, ivSubKind === 'pinch')}
                    onPress={() => { setPendingIn(p.id); setIvError(null); setIvStep('confirm'); }} />
                ))}
              </ScrollView>
            )}
            {ivError ? <Text style={styles.ivError}>{ivError}</Text> : null}
            <Pressable style={styles.mTextBtn} onPress={() => { setIvStep(ivSubKind === 'pinch' ? 'menu' : 'pickOut'); setIvError(null); }}>
              <Text style={styles.mTextBtnTxt}>뒤로</Text>
            </Pressable>
          </>
        ) : (
          // 확인 단계(#2) — 확정을 눌러야 실제 커밋. 서브 교체는 뺄 선수 없이 IN만 표시.
          (() => {
            const inP = byIdAll.get(pendingIn ?? '');
            const inLabel = inP ? `${inP.name}(${inP.position})` : '선수';
            const outP = pendingOut ? (curSix.find((p) => p.id === pendingOut) ?? byIdAll.get(pendingOut)) : undefined;
            const outLabel = outP ? `${outP.name}(${outP.position})` : '선수';
            return (
              <>
                <Text style={styles.ivConfirmTitle}>{ivSubKind === 'pinch' ? '서브 교체' : '선수 교체'}</Text>
                <Text style={styles.ivConfirmBody}>
                  {ivSubKind === 'pinch'
                    ? `${inLabel} 투입\n서브권이 넘어가면 자동 복귀합니다.`
                    : `${outLabel} → ${inLabel}\n교체할까요?`}
                </Text>
                {ivError ? <Text style={styles.ivError}>{ivError}</Text> : null}
                <Pressable style={[styles.mBtnWide, styles.mPrimary]} onPress={() => { if (pendingIn) onConfirmSub(pendingIn); }}>
                  <Text style={styles.mPrimaryText}>확정</Text>
                </Pressable>
                <Pressable style={styles.mTextBtn} onPress={() => { setIvStep('pickIn'); setIvError(null); }}>
                  <Text style={styles.mTextBtnTxt}>취소</Text>
                </Pressable>
              </>
            );
          })()
        )}
      </Popup>

      {/* 경기 보드 스포트라이트(관전 안내 → 컨트롤) — 첫 관전 1회. 샌드박스(board-lab·DEV 테스트 경기) 제외(구 팝업 예외 승계). */}
      {!isSandbox && <SpotlightOverlay screen="match" />}

      <ToastHost toasts={toasts} />
    </>
  );
}

// 교체 판단용 핵심 스탯 2개 — 서브 교체(핀치)면 서브를 앞세우고, 아니면 포지션 주요 스탯. 판단 근거 노출(사용자 요청).
function subStatChips(p: Player, pinch: boolean): { label: string; value: number }[] {
  const r = deriveRatings(p);
  const n = (v: number) => Math.round(v);
  const byPos: Record<string, { label: string; value: number }[]> = {
    S: [{ label: '세팅', value: n(r.set) }, { label: '서브', value: n(r.serve) }],
    OH: [{ label: '공격', value: n(r.spike) }, { label: '리시브', value: n(r.receive) }],
    OP: [{ label: '공격', value: n(r.spike) }, { label: '서브', value: n(r.serve) }],
    MB: [{ label: '블로킹', value: n(r.block) }, { label: '공격', value: n(r.spike) }],
    L: [{ label: '디그', value: n(r.dig) }, { label: '리시브', value: n(r.receive) }],
  };
  if (pinch) return [{ label: '서브', value: n(r.serve) }, ...(byPos[p.position] ?? []).filter((c) => c.label !== '서브').slice(0, 1)];
  return byPos[p.position] ?? [];
}

// 개입 시트 선수 행 — 포지션 색 점 + 이름 + 핵심 스탯 + OVR + (있으면)체력. 교체 판단 근거.
function IvPlayerRow({ name, pos, ovr, stam, stats, onPress }: { name: string; pos: string; ovr: number; stam?: number; stats?: { label: string; value: number }[]; onPress: () => void }) {
  const stamPct = stam != null ? Math.round(stam * 100) : null;
  const stamColor = stamPct == null ? theme.muted : stamPct >= 60 ? '#2BAE66' : stamPct >= 35 ? '#E0922B' : '#E1574C';
  return (
    <Pressable style={({ pressed }) => [styles.ivRow, pressed && { opacity: 0.7 }]} onPress={onPress}>
      <View style={[styles.ivPosDot, { backgroundColor: POS_COLOR[pos as keyof typeof POS_COLOR] ?? theme.muted }]}>
        <Text style={styles.ivPosTxt}>{pos}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.ivName} numberOfLines={1}>{name}</Text>
        {stats && stats.length ? (
          <Text style={styles.ivStatLine} numberOfLines={1}>
            {stats.map((c) => `${c.label} ${c.value}`).join('  ·  ')}
          </Text>
        ) : null}
      </View>
      {stamPct != null ? <Text style={[styles.ivStam, { color: stamColor }]}>{stamPct}%</Text> : null}
      <Text style={styles.ivOvr}>OVR {ovr}</Text>
    </Pressable>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  content: { paddingHorizontal: 16, gap: 8 }, // 간격 축소(2026-06-28) — 한 화면 맞춤(스크롤 제거)
  sandboxTag: { color: theme.warn, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  // 코트 최우선 — 스코어보드 컴팩트화(2026-06-28): 엠블럼·패딩·점수 폰트 축소로 코트 공간 확보
  scoreboard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 16, paddingVertical: 8, paddingHorizontal: 12,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  sbSide: { flex: 1, alignItems: 'center', gap: 4 },
  sbEmblem: { width: 40, height: 40, resizeMode: 'contain' },
  sbName: { color: theme.text, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  sbMid: { alignItems: 'center', minWidth: 92 },
  sbSetLabel: { color: theme.muted, fontSize: 10.5, fontWeight: '700' },
  sbSetScore: { color: theme.text, fontSize: 26, fontWeight: '900', marginVertical: 1, letterSpacing: 1 },
  sbPoint: { color: theme.accent, fontSize: 16, fontWeight: '800' },
  setPillWrap: { alignItems: 'center', marginTop: -4 },
  setPill: { backgroundColor: theme.cardAlt, borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 4 },
  setPillTxt: { color: theme.muted, fontSize: 12, fontWeight: '800' },
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
  // 경기 개입 시트
  ivScore: { color: theme.accent, fontSize: 15, fontWeight: '900', textAlign: 'center', marginTop: -4 },
  ivPickBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.cardAlt, borderWidth: 1, borderColor: theme.border },
  ivPickBtnPrimary: { backgroundColor: theme.accent, borderColor: theme.accent }, // 타임아웃 강조 — 배경만 다르고 높이·패딩·부제구조는 동일(#1)
  ivPickBtnTxt: { color: theme.text, fontSize: 15, fontWeight: '800' },
  ivPickBtnTxtOn: { color: '#FFFFFF' },
  ivPickSub: { color: theme.muted, fontSize: 11, fontWeight: '600', textAlign: 'center', marginTop: 3 },
  ivPickSubOn: { color: 'rgba(255,255,255,0.85)' },
  ivConfirmTitle: { color: theme.text, fontSize: 16, fontWeight: '900', textAlign: 'center' },
  ivConfirmBody: { color: theme.muted, fontSize: 14, fontWeight: '700', textAlign: 'center', lineHeight: 21 },
  ivHint: { color: theme.muted, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  ivStamNote: { color: theme.muted, fontSize: 11, fontWeight: '600', textAlign: 'center', marginTop: -4, opacity: 0.85 },
  ivError: { color: theme.bad, fontSize: 13, fontWeight: '700', textAlign: 'center', lineHeight: 19 },
  ivRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: theme.border },
  ivPosDot: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  ivPosTxt: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  ivName: { color: theme.text, fontSize: 14, fontWeight: '800' },
  ivStatLine: { color: theme.muted, fontSize: 11, fontWeight: '700', marginTop: 2 },
  ivStam: { fontSize: 13, fontWeight: '800', width: 44, textAlign: 'right' },
  ivOvr: { color: theme.muted, fontSize: 12, fontWeight: '800', width: 58, textAlign: 'right' },
}));
