// 경기 보드 — 코트 위 마커(선수)와 노란 공으로 랠리를 시각화.
// 엔진 SimResult.points 만으로 각 랠리의 서브권·로테이션을 복원(엔진과 동일한 사이드아웃 규칙)
// → 마커를 실제 코트 위치에 놓고 공을 득점 결과와 일치하게 애니메이션.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Popup } from './Popup';
import { theme } from './Screen';
import { themedStyles } from './theme';
import { POS_COLOR } from './posTokens';
import { buildLineup } from '../engine/lineup';
import type { SimResult, TimeoutEvent } from '../engine/simMatch';
import type { Player, Side } from '../types';
import {
  lineupIdxAt, playerAtZone,
  zonePx as zonePxRaw, switchedSpots as switchedSpotsRaw,
} from './courtLayout';
import { ballPath as ballPathRaw, SEG_DUR as DUR, markerTravelMs, type Move, type WP } from './courtPath';
import type { PointHow } from '../engine/rally';
import { segmentTargets, reconstructRallies, isInPlay, applySubsToSix, type RallyState } from './courtDirector';
import { commentLine, situationFeed } from './courtCommentary';
import { CoinTossOverlay } from './CoinTossOverlay';
import { initSfx, playSfx, setSfxEnabled } from '../audio/sfx';
import { useGameStore } from '../store/useGameStore';

// 포지션색은 posTokens 단일 소스(코트 마커도 배지와 같은 색)
// 작전 교체 — 갓 투입된 선수 강조(골드 점선·코트 배지). 코트 위에서 "방금 들어온 선수"를 또렷이.
// (구 BRACED 블루 테두리 제거 2026-06-28 — 포지션 색 마커와 충돌. 상태는 색 대신 점선으로 표현)
const SUB_GOLD = '#F2A93B';
// 중계 자막(일시정지 위 텍스트) 표시 여부 — 숨김(2026-06-28, 사용자: "한 번도 안 본다"). 출시 후 원하면 true.
const SHOW_FEED = false;
const SUB_KIND_KO: Record<'pinch' | 'block' | 'def', string> = { pinch: '서브 보강', block: '블로킹 보강', def: '수비 보강' };

// 랠리 종결 자막 — 엔진이 기록한 사실(PointLog.how)을 그대로 외친다(보드가 지어내지 않음)
// 색은 다크 글래스 콜아웃 뱃지 위에서 또렷하게(2026-06-28 다크 코트 전환 — 밝은 톤으로 상향)
const HOW_CAPTION: Record<PointHow, { txt: string; color: string }> = {
  kill: { txt: '스파이크 득점!', color: '#27E0C7' },
  cap: { txt: '스파이크 득점!', color: '#27E0C7' },
  stuff: { txt: '🧱 블로킹 차단!', color: '#F2A93B' },
  blockout: { txt: '블록 터치아웃!', color: '#FF8A4C' },
  tip: { txt: '페인트!', color: '#A78BFA' },
  ace: { txt: '서브 에이스!', color: '#27E0C7' },
  serveErr: { txt: '서브 범실', color: '#9AA7BC' },
  // 리시브를 흔들어 직접 득점한 서브 — 관전 표기는 '서브 에이스'(사용자 요청). KOVO 통계는
  // 여전히 리시브 범실로 별도 집계(엔진 how/stats 분리 — 분포·서브왕 보존). 보드 헤드라인만 에이스.
  recvErr: { txt: '서브 에이스!', color: '#27E0C7' },
  miscErr: { txt: '핸들링 범실', color: '#9AA7BC' },
  atkErr: { txt: '공격 범실', color: '#9AA7BC' },
  fault: { txt: '포지션 폴트', color: '#9AA7BC' },
};

// 코트 영역 크기
const SCREEN_W = Dimensions.get('window').width;
const COURT_W = SCREEN_W - 32;
const COURT_H = Math.min(COURT_W * 1.4, Dimensions.get('window').height * 0.52); // 코트 최우선(사용자) — 높이 유지

const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');

// 위치 계산은 courtLayout(순수 모듈)에 — 보드 크기 바인딩 래퍼
const zonePx = (side: Side, zone: number) => zonePxRaw(side, zone, COURT_W, COURT_H);
const switchedSpots = (side: Side, lu: ReturnType<typeof buildLineup>, rot: number, offense: boolean) =>
  switchedSpotsRaw(side, lu, rot, offense, COURT_W, COURT_H);

interface Lineups {
  home: ReturnType<typeof buildLineup>;
  away: ReturnType<typeof buildLineup>;
}

/** 사이드 라인업에서 zone 의 선수 (후위 1·5·6 MB는 리베로로 교체. 리베로는 전위 불가) */
function playerAt(L: Lineups, side: Side, rot: number, zone: number): Player {
  return playerAtZone(side === 'home' ? L.home : L.away, rot, zone);
}

type Rally = RallyState;

// 구간별 포물선 높이(px) / 공 크기 피크 — 토스가 가장 크게 휘고 커진다
const ARC: Record<Move, number> = { start: 0, return: 0, walk: 0, serve: COURT_H * 0.10, pass: COURT_H * 0.05, toss: COURT_H * 0.17, spike: COURT_H * 0.03, fault: COURT_H * 0.06, bounce: COURT_H * 0.05 };
const BALL_SCALE: Record<Move, number> = { start: 1, return: 1, walk: 1, serve: 1.2, pass: 1.05, toss: 1.55, spike: 1.15, fault: 1.1, bounce: 1.06 };
const JUMP = 1.45; // 점프 시 마커 확대
const SETTLE_SEGMENTS = 2; // 블록/스파이크 점프 후 착지 정지 구간 수(점프 직후 즉시 이동 방지)
const SPEED = 2; // 전체 경기 속도 배수(클수록 느림). 2 = 2배 느리게
const SERVE_OUT = 22; // 엔드라인 뒤(코트 밖) 서브 거리(px)
const COURT_PAD = SERVE_OUT + 4; // 코트 밖 서브 공간(버퍼 10→4로 축소, 2026-06-28 — 코트 유지하며 한 화면 맞춤)
const serveOutY = (side: Side) => (side === 'home' ? COURT_H + SERVE_OUT : -SERVE_OUT);

/** 한 랠리의 공 이동 경로 — courtPath(순수 모듈, 헤드리스 검증 가능)에 위임 */
const ballPath = (r: Rally, seed: number, L: Lineups, prevLast?: { x: number; y: number }): WP[] =>
  ballPathRaw(r, seed, L, COURT_W, COURT_H, SERVE_OUT, prevLast);

const easingFor = (k: Move) =>
  k === 'toss' ? Easing.inOut(Easing.quad) : k === 'spike' || k === 'fault' ? Easing.in(Easing.quad) : k === 'bounce' ? Easing.out(Easing.quad) : Easing.linear;

/** 이 구간에 점프하는 마커들 — 서브(서버)·토스(세터)·스파이크(공격수+벽에 선 블로커만) */
function jumpersFor(from: WP, to: WP, homeRot: number, awayRot: number, L: Lineups): { side: Side; idx: number }[] {
  if (to.kind === 'serve' || to.kind === 'toss') return [{ side: from.side, idx: from.idx }];
  if (to.kind === 'spike') {
    const opp = other(from.side);
    const rot = opp === 'home' ? homeRot : awayRot;
    const lu = opp === 'home' ? L.home : L.away;
    const dSw = switchedSpots(opp, lu, rot, false);
    const front = [2, 3, 4].map((z) => lineupIdxAt(rot, z));
    const n = Math.min(from.blk ?? 3, front.length); // 토스 WP의 블록 장수(속공은 1장만 점프)
    const blockers = front.slice()
      .sort((a, b) => Math.abs(dSw.pos[a].x - from.x) - Math.abs(dSw.pos[b].x - from.x)).slice(0, n);
    return [{ side: from.side, idx: from.idx }, ...blockers.map((idx) => ({ side: opp, idx }))];
  }
  return [];
}

interface Props {
  sim: SimResult;
  home: Player[];
  away: Player[];
  seed: number;
  mineSide: Side | null;
  startIdx?: number;                    // 이어보기 — 이 랠리부터 재생
  onProgress?: (idx: number) => void;   // 현재 랠리 인덱스 보고(이어보기 저장용)
  onFinished?: () => void;
  onScore?: (s: { h: number; a: number; homeSets: number; awaySets: number; setNo: number; ptIdx: number }) => void;
  paused?: boolean;                     // 외부 일시정지(스코어박스 모달 등) — true면 진행 멈춤, false면 재개
  homeName?: string;                    // 코인토스 오버레이 등 팀명 표기용(없으면 홈/원정 폴백)
  awayName?: string;
}

export function MatchCourt({ sim, home, away, seed, mineSide, startIdx, onProgress, onFinished, onScore, paused, homeName, awayName }: Props) {
  // 선발 라인업(고정) + 전 선수 id 맵(교체 선수 조회용)
  const baseLineups: Lineups = useMemo(() => ({ home: buildLineup(home), away: buildLineup(away) }), [home, away]);
  const byId = useMemo(() => {
    const m = new Map<string, Player>();
    for (const p of home) m.set(p.id, p);
    for (const p of away) m.set(p.id, p);
    return m;
  }, [home, away]);
  const rallies = useMemo(() => reconstructRallies(sim), [sim]);
  const total = rallies.length;

  // 특정 랠리 시점의 코트 라인업(작전 교체 반영) — subEvents 없으면 base 그대로(기존 동작 보존)
  const effLineupsAt = useCallback((rallyIdx: number): Lineups => ({
    home: { ...baseLineups.home, six: applySubsToSix(baseLineups.home.six, 'home', sim.subEvents, rallyIdx, byId) },
    away: { ...baseLineups.away, six: applySubsToSix(baseLineups.away.six, 'away', sim.subEvents, rallyIdx, byId) },
  }), [baseLineups, sim.subEvents, byId]);

  // 이어보기: 저장된 랠리부터 시작(범위 클램프). 점수도 그 시점으로 맞춘다(shown = 시작-1).
  const resumeAt = Math.min(Math.max(0, startIdx ?? 0), Math.max(0, total - 1));
  const [idx, setIdx] = useState(resumeAt);       // 현재 진행 중인 랠리
  const [segIdx, setSegIdx] = useState(0);        // 랠리 내 공 이동 구간
  const [shown, setShown] = useState(resumeAt > 0 ? resumeAt - 1 : -1); // 점수에 반영된 마지막 랠리
  const [playing, setPlaying] = useState(true);
  const [fast, setFast] = useState(false);
  const [feed, setFeed] = useState<string[]>([]); // 중계 텍스트(최근 라인 유지)
  const [timeoutModal, setTimeoutModal] = useState<TimeoutEvent | null>(null); // 작전 타임아웃 — 멈춤+체력
  const [toCount, setToCount] = useState(0); // 타임아웃 자동 진행 카운트다운(초) — 관전형: 안 눌러도 진행
  const [confirmEnd, setConfirmEnd] = useState(false); // ⏭ 결과(경기 종료) 확인 — 즉시 종료 방지
  const ackTO = useRef<Set<number>>(new Set()); // 이미 본 타임아웃(랠리 인덱스) — 재진입 시 재팝업 방지

  // 효과음(휘슬·스파이크·서브) — 보드 진입 시 1회 프리로드, 설정 토글 동기화(audio/sfx.ts, UI 전용)
  const sfxOn = useGameStore((s) => s.sfxEnabled);
  useEffect(() => { initSfx(); }, []);
  useEffect(() => { setSfxEnabled(sfxOn); }, [sfxOn]);

  const prog = useRef(new Animated.Value(0)).current; // 현재 구간 진행도 0..1
  const posRefs = useRef<Record<string, Animated.ValueXY>>({}); // 마커별 위치(선수 단위)
  const posLast = useRef<Record<string, { x: number; y: number }>>({});
  const jumpHold = useRef<Record<string, number>>({}); // 마커별 착지 후 남은 정지 구간 수(블록/스파이크 점프 한정)
  const finishedOnce = useRef(false);
  const lastTargets = useRef<Record<string, { x: number; y: number }>>({});

  const finished = idx >= total;
  // 현재/직전 랠리의 코트 라인업(교체 반영). 마커·궤적·중계가 모두 "그 순간 실제 코트 6인"을 본다.
  const lineups: Lineups = useMemo(() => effLineupsAt(Math.min(idx, total - 1)), [effLineupsAt, idx, total]);
  const prevLineups: Lineups = useMemo(() => effLineupsAt(Math.max(0, idx - 1)), [effLineupsAt, idx]);
  // 직전 랠리 낙구점 → 새 랠리 공 시작점으로 이어 붙여 공이 순간이동하지 않게
  const prevLast = useMemo(() => {
    if (finished || idx <= 0) return undefined;
    const pp = ballPath(rallies[idx - 1], seed, prevLineups);
    const w = pp[pp.length - 1];
    return { x: w.x, y: w.y };
  }, [finished, rallies, idx, seed, prevLineups]);
  const path = useMemo(() => (finished ? [] : ballPath(rallies[idx], seed, lineups, prevLast)), [finished, rallies, idx, seed, lineups, prevLast]);
  const segCount = Math.max(0, path.length - 1);

  // ── 작전 교체 연출 ── 이 랠리의 교체(투입 enter + **같은 세트 내 원위치 복귀**) → 골드 강조 + 이름표 + 팝인 + 배지.
  // 버그수정(2026-06-28): 기존엔 투입(enter)만 표시해 **핀치서버가 서브 끝나고 빠지는 역교체가 코트에 안 떴다**
  //  (피드 한 줄만). 이제 복귀도 배지·마커로 표시(블로킹/수비 보강 역교체도 동일 — 형제 포함). 세트 경계 원복
  //  (e.setNo !== 현재 세트)은 라인업 리셋이 당연하므로 조용히 제외.
  const subEvsNow = useMemo(() => {
    if (finished) return [];
    const curSet = rallies[Math.min(idx, total - 1)]?.setNo;
    return (sim.subEvents ?? []).filter((e) => e.point === idx && (e.enter || e.setNo === curSet));
  }, [sim.subEvents, idx, finished, rallies, total]);
  const subbedKeys = useMemo(() => new Set(subEvsNow.map((e) => `${e.side}-${e.slot}`)), [subEvsNow]);
  const subPop = useRef(new Animated.Value(1)).current; // 교체 마커 팝인 스케일
  useEffect(() => {
    if (subEvsNow.length === 0) return;
    subPop.setValue(0.45);
    Animated.spring(subPop, { toValue: 1, friction: 5, tension: 90, useNativeDriver: true }).start();
  }, [subEvsNow, subPop]);
  // 교체 발생 랠리 진입 시 중계 한 줄(투입 + 복귀 둘 다).
  useEffect(() => {
    if (finished || subEvsNow.length === 0) return;
    const sideKo = (s: Side) => (s === 'home' ? '홈' : '원정');
    const nm = (id: string) => byId.get(id)?.name ?? '선수';
    const lines = subEvsNow.map((e) => e.enter
      ? `🔄 교체 [${sideKo(e.side)}] ${nm(e.outId)} ▶ ${nm(e.inId)} · ${SUB_KIND_KO[e.kind]}`
      : `↩ 교체 [${sideKo(e.side)}] ${nm(e.outId)} ▶ ${nm(e.inId)} · 원위치`);
    setFeed((f) => [...f, ...lines].slice(-30));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  // 이 랠리(idx) 직후에 잡힌 작전 타임아웃 — 점수 반영 후 보드를 멈추고 코트 체력을 보여준다
  const timeoutHere = useMemo(
    () => (finished ? undefined : (sim.timeouts ?? []).find((t) => t.point === idx)),
    [sim.timeouts, idx, finished],
  );

  // 5세트(결승) 코인토스 오버레이 — 첫 5세트 랠리 직전 1회(MATCH_SYSTEM v2.1). 순수 연출(승패·기록 무영향).
  const coinIdx = useMemo(() => {
    const i = rallies.findIndex((r) => r.setNo === 5);
    return i >= 0 ? i : null;
  }, [rallies]);
  const coinAck = useRef(false);                       // 이미 보여줬나(1회 게이트)
  const [coinActive, setCoinActive] = useState(false); // 오버레이 표시 중 — 랠리 진행 정지

  // 구간 단위 진행 (위치·포물선·크기·점프를 prog 하나로 동기화)
  useEffect(() => {
    if (!playing || paused || finished) return; // paused: 스코어박스 모달 등 외부 일시정지
    // 5세트 진입 — 첫 랠리 직전 코인토스 오버레이(1회). coinAck(ref)로 동기 게이트(재실행 레이스 없음).
    // 자동 해제 타이머는 별도 effect에 둔다(여기 두면 coinActive 변화로 이 effect가 재실행되며 cleanup이 타이머를 죽임).
    if (coinIdx !== null && idx === coinIdx && !coinAck.current) {
      coinAck.current = true;
      setCoinActive(true);
      playSfx('whistle'); // 코인토스 시작 신호
      return;
    }
    if (coinActive) return; // 오버레이 표시 중엔 랠리 진행 정지
    if (segIdx >= segCount) {
      // 득점 → 점수 반영 후 잠시 멈춤(공은 낙구 지점에 정지) → 다음 랠리.
      // shown!==idx 가드: 일시정지(스코어박스) 후 재개 시 이 분기가 다시 돌아도 중계줄·휘슬·점수반영을 중복하지 않음.
      if (shown !== idx) {
        setShown(idx);
        const r = rallies[idx];
        if (r?.how) {
          const c = HOW_CAPTION[r.how];
          setFeed((f) => [...f, `▶ ${c.txt} — ${r.scorer === 'home' ? '홈' : '원정'} 득점 (${r.home}:${r.away})`].slice(-30));
          const sit = situationFeed(rallies, idx).post; // 듀스 도달·연속 득점 — 결과 직후 상황(BOARD_RULES 60)
          if (sit) setFeed((f) => (f[f.length - 1] === sit ? f : [...f, sit].slice(-30)));
        }
        playSfx('whistle'); // 종결 휘슬 — 랠리가 끝나 점수가 났다
      }
      // 작전 타임아웃: 득점 자막을 한 박자 보여준 뒤 멈추고 모달(코트 체력)을 띄운다(아직 안 본 것만).
      if (timeoutHere && !ackTO.current.has(idx)) {
        const t = setTimeout(() => { setPlaying(false); setTimeoutModal(timeoutHere); }, fast ? 320 : 1300);
        return () => clearTimeout(t);
      }
      // 점수 후 한 박자 멈춤 — 득점 자막을 읽고 숨 돌릴 틈(관전형). 빠르게 모드는 짧게.
      const t = setTimeout(() => { setIdx((i) => i + 1); setSegIdx(0); }, fast ? 320 : 1300);
      return () => clearTimeout(t);
    }
    const to = path[segIdx + 1];
    prog.setValue(0);
    const anim = Animated.timing(prog, {
      toValue: 1,
      duration: (to.dur ?? DUR[to.kind]) * (fast ? 0.4 : 1) * SPEED,
      easing: easingFor(to.kind),
      useNativeDriver: true,
    });
    anim.start(({ finished: done }) => { if (done) setSegIdx((s) => s + 1); });
    return () => anim.stop();
  }, [idx, segIdx, playing, paused, fast, finished, segCount, path, prog, rallies, timeoutHere, shown, coinIdx, coinActive]);

  // 코인토스 자동 해제 — coinActive가 켜지면 일정 시간(빠르게 450·일반 950ms) 뒤 끄고 랠리 재개.
  // 별도 effect라 위 진행 effect의 재실행에 타이머가 안 죽는다.
  useEffect(() => {
    if (!coinActive) return;
    const t = setTimeout(() => setCoinActive(false), fast ? 450 : 950);
    return () => clearTimeout(t);
  }, [coinActive, fast]);

  // 타임아웃 종료 — "경기 진행하기" 누르면 다음 랠리로 재개(이 타임아웃은 본 것으로 표시)
  const resumeFromTimeout = useCallback(() => {
    setTimeoutModal((to) => { if (to) ackTO.current.add(to.point); return null; });
    setIdx((i) => i + 1);
    setSegIdx(0);
    setPlaying(true);
  }, []);

  // 타임아웃 자동 진행(관전형) — 모달이 뜨면 10초 카운트다운, 0이면 자동 재개. 탭하면 즉시 진행(수동).
  const TO_AUTO_SECS = 10;
  useEffect(() => {
    if (!timeoutModal) return;
    setToCount(TO_AUTO_SECS);
    const iv = setInterval(() => setToCount((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(iv);
  }, [timeoutModal]);
  useEffect(() => {
    if (timeoutModal && toCount === 0) resumeFromTimeout();
  }, [toCount, timeoutModal, resumeFromTimeout]);

  // ⏭ 결과 — 확인 후 끝으로 건너뛰기(즉시 종료 방지)
  const endNow = useCallback(() => {
    setConfirmEnd(false);
    setPlaying(false); setTimeoutModal(null); setShown(total - 1); setIdx(total); setSegIdx(0);
  }, [total]);

  useEffect(() => {
    if (finished && !finishedOnce.current) {
      finishedOnce.current = true;
      onFinished?.();
    }
  }, [finished, onFinished]);

  // 현재 랠리 인덱스 보고 — 부모(경기 화면)가 이어보기 위치를 저장하는 데 쓴다
  useEffect(() => { onProgress?.(idx); }, [idx, onProgress]);

  const seg = !finished && segIdx < segCount ? { from: path[segIdx], to: path[segIdx + 1] } : null;

  // 화면에 표시할 상태 — 스코어보드는 "지금 진행 중인 세트"(idx) 기준.
  //  버그수정(2026-07-05): 이전엔 view=rallies[shown]이라 세트 경계에서 shown이 아직 직전 세트 마지막 랠리 →
  //  새 세트 첫 점이 날 때까지 **이전 세트 점수·세트번호(25:23·1세트)를 들고 있었다**(사용자 제보). 이제 idx의 세트를
  //  기준으로, 그 세트에서 이미 난 점수(shown이 같은 세트일 때)만 반영하고 아니면 0:0(세트 시작)으로 표시.
  const curIdx = Math.min(idx, total - 1);
  const cur = rallies[curIdx];
  const scoredView = shown >= 0 ? rallies[Math.min(shown, total - 1)] : null;
  const sameSet = scoredView != null && cur != null && scoredView.setNo === cur.setNo; // 이번 세트에서 이미 난 점수?
  const homeSets = finished ? sim.homeSets : cur?.homeSetsBefore ?? 0;
  const awaySets = finished ? sim.awaySets : cur?.awaySetsBefore ?? 0;
  const curPts = sameSet && scoredView ? { h: scoredView.home, a: scoredView.away } : { h: 0, a: 0 };
  const setNo = finished ? (rallies[total - 1]?.setNo ?? 1) : cur?.setNo ?? 1;

  // 관전 점수를 부모(헤더)로 올린다 — 스코어보드를 헤더 팀명 옆에 표시(별도 영역 제거)
  useEffect(() => {
    onScore?.({ h: curPts.h, a: curPts.a, homeSets, awaySets, setNo, ptIdx: shown });
  }, [curPts.h, curPts.a, homeSets, awaySets, setNo, shown, onScore]);

  // 마커 배치는 현재 진행 중 랠리(idx) 기준
  const stage = rallies[Math.min(idx, total - 1)];

  const segKind: Move | null = seg ? seg.to.kind : null;
  // 서브 이후(공 인플레이)엔 전 선수가 전문 포지션으로 스위칭
  const inPlay = isInPlay(segKind);
  const jl = seg ? jumpersFor(seg.from, seg.to, stage.homeRot, stage.awayRot, lineups) : [];
  const jumpScale = prog.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, JUMP, 1] });
  // 받는/막는 쪽이 "굳는" 순간 — 서브 비행·스파이크 컨택에선 공을 받는 팀(seg.to.side)이 자세를 잡고
  // 못 움직인다. 그 팀의 비(非)이동·비점프 선수에 braced 테두리(공 쫓는 디거/리시버는 이동 중이라 제외).
  const reactingSide: Side | null = seg && (segKind === 'serve' || segKind === 'spike') ? seg.to.side : null;

  // 전 마커 목표 좌표 — courtDirector(순수 모듈, 헤드리스 감사기와 동일 소스)
  const targets = segmentTargets(seg, { serving: stage.serving, homeRot: stage.homeRot, awayRot: stage.awayRot }, lineups, COURT_W, COURT_H, SERVE_OUT, lastTargets.current);
  lastTargets.current = targets;

  // 마커는 "선수(라인업 인덱스)" 단위로 그린다 → 위치가 바뀌면 무조건 슬라이드(순간이동 금지).
  const getPos = (key: string, init: { x: number; y: number }) => {
    if (!posRefs.current[key]) { posRefs.current[key] = new Animated.ValueXY(init); posLast.current[key] = init; }
    return posRefs.current[key];
  };

  type Mk = { key: string; side: Side; p: Player | undefined; tx: number; ty: number; jumping: boolean; isServer: boolean; braced: boolean; justSubbed: boolean };
  const buildMarkers = (side: Side): Mk[] => {
    const rot = side === 'home' ? stage.homeRot : stage.awayRot;
    const lu = side === 'home' ? lineups.home : lineups.away;
    const arr: Mk[] = [];
    for (let i = 0; i < 6; i++) {
      const zone = ((i - rot) % 6 + 6) % 6 + 1;     // 이 선수가 현재 선 존
      const isServer = !finished && stage.serving === side && zone === 1;
      const p = isServer ? lu.six[i] : playerAt(lineups, side, rot, zone); // 서버는 실제 선수(리베로는 서브 불가), 그 외 후위 MB→리베로
      const t = targets[`${side}-${i}`] ?? zonePx(side, zone);
      let tx = t.x;
      let ty = t.y;
      const jumping = jl.some((j) => j.side === side && j.idx === i);
      const moving = (seg?.to.movers ?? []).some((mv) => mv.side === side && mv.idx === i);
      // 착지 정지: 블록/스파이크로 점프한 선수는 착지 후 SETTLE_SEGMENTS 구간 동안 그 자리에 머문다 —
      // 점프 직후 즉시 빠르게 미끄러지는 어색함 제거(2026-06-18 사용자 보고). 공 쫓는 무버(디그·커버)는 예외.
      const settling = !jumping && !moving && (jumpHold.current[`${side}-${i}`] ?? 0) > 0;
      if (jumping || settling) { const lp = posLast.current[`${side}-${i}`]; if (lp) { tx = lp.x; ty = lp.y; } } // 점프 중·착지 직후엔 제자리
      const braced = reactingSide === side && !moving && !jumping && !isServer; // 굳어서 못 움직이는 선수
      const justSubbed = subbedKeys.has(`${side}-${i}`); // 이 랠리에 갓 투입된 선수
      arr.push({ key: `${side}-${i}`, side, p, tx, ty, jumping, isServer, braced, justSubbed });
    }
    return arr;
  };
  const allMarkers = [...buildMarkers('home'), ...buildMarkers('away')];

  // 목표가 바뀐 마커만 부드럽게 이동(순간이동 금지)
  const posSig = allMarkers.map((m) => `${m.key}:${Math.round(m.tx)},${Math.round(m.ty)}`).join('|');
  useEffect(() => {
    for (const m of allMarkers) {
      const v = getPos(m.key, { x: m.tx, y: m.ty });
      const last = posLast.current[m.key];
      if (last && (last.x !== m.tx || last.y !== m.ty)) {
        posLast.current[m.key] = { x: m.tx, y: m.ty };
        const d = Math.hypot(m.tx - last.x, m.ty - last.y);
        Animated.timing(v, { toValue: { x: m.tx, y: m.ty }, duration: markerTravelMs(d) * (fast ? 0.4 : 1), easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posSig]);

  // 공 transform — 포물선(translateY에 아치 가산) + 크기(떴다 떨어지는 원근감)
  const last = path.length ? path[path.length - 1] : zonePx('home', 1);
  const arcH = seg ? (seg.to.arc ?? ARC[seg.to.kind]) : 0;
  const ballTransform = seg
    ? [
        { translateX: prog.interpolate({ inputRange: [0, 1], outputRange: [seg.from.x, seg.to.x] }) },
        {
          translateY: Animated.add(
            prog.interpolate({ inputRange: [0, 1], outputRange: [seg.from.y, seg.to.y] }),
            prog.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, -0.75 * arcH, -arcH, -0.75 * arcH, 0] }),
          ),
        },
        { scale: prog.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, seg.to.scale ?? BALL_SCALE[seg.to.kind], 1] }) },
      ]
    : [{ translateX: last.x }, { translateY: last.y }];

  // 중계 텍스트 — 구간 시작마다 사실 기반 한 줄(서브/리시브/토스/스파이크 + 행위자 이름)
  const segSig = seg ? `${idx}:${segIdx}` : '';
  useEffect(() => {
    if (!seg) return;
    const line = commentLine(seg, rallies[Math.min(idx, total - 1)]?.how, lineups, {
      serving: stage.serving, homeRot: stage.homeRot, awayRot: stage.awayRot,
    }, rallies[Math.min(idx, total - 1)]?.byId);
    if (line) setFeed((f) => (f[f.length - 1] === line ? f : [...f, line].slice(-30)));
    // 효과음: 서브 임팩트(서버 컨택) / 스파이크 강타 — 페인트·소프트샷(to.soft)은 퍽 소리 제외(사용자 요청)
    if (seg.to.kind === 'serve') {
      playSfx('serve');
      // 서브 직전 긴장 — 세트포인트/매치포인트(BOARD_RULES 60). 점수 직전 상태로 판정.
      const pre = situationFeed(rallies, Math.min(idx, total - 1)).pre;
      if (pre) setFeed((f) => (f[f.length - 1] === pre ? f : [...f, pre].slice(-30)));
    }
    else if (seg.to.kind === 'spike' && !seg.to.soft) playSfx('spike');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segSig]);

  // 구간이 바뀔 때마다: 기존 정지 카운트 1 감소 + 이번 구간의 "스파이크 점프"(블로커·공격수)에 정지 부여.
  // 토스 점프(세터)는 제외 — 세터는 토스 후 곧장 움직여야 자연스럽다.
  useEffect(() => {
    const h = jumpHold.current;
    for (const k of Object.keys(h)) { h[k] -= 1; if (h[k] <= 0) delete h[k]; }
    if (seg?.to.kind === 'spike') for (const j of jl) h[`${j.side}-${j.idx}`] = SETTLE_SEGMENTS;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segSig]);

  // 종결 자막 — 공이 죽은 순간(바운드)부터 다음 서브 전까지. 바운드 중엔 진행 랠리, 그 후엔 점수 반영 랠리
  // 현재 랠리(idx)가 종결(바운드~정산: segKind==='bounce' 또는 seg===null)이면 그 랠리의 자막을 쓴다.
  //  버그수정(2026-07-05): 이전엔 seg===null(바운드 직후, setShown(idx) 이펙트 커밋 전 ~90ms)에 shown이
  //  아직 직전 랠리(idx-1)라 rallies[shown]으로 **직전 득점 뱃지가 한 프레임 스쳤다 복귀**(색·너비 튐, 사용자 제보).
  //  워크백(return/walk = 다음 랠리 시작 전)만 직전 득점(shown) 유지.
  const capIdx = finished ? -1
    : (segKind === 'bounce' || segKind === null) ? Math.min(idx, total - 1)
    : !inPlay && shown >= 0 ? Math.min(shown, total - 1)
    : -1;
  const capRally = capIdx >= 0 ? rallies[capIdx] : null;
  const caption = capRally?.how ? HOW_CAPTION[capRally.how] : null;

  // 공 궤적(흰 점선) — 경기 중(인플레이)에만. 끝점은 의도(aim)가 있으면 그쪽으로(터치아웃: 점선=의도 코스)
  const aimEnd = seg ? seg.to.aim ?? seg.to : null;
  const trailDots = seg && inPlay && aimEnd
    ? Array.from({ length: 17 }, (_, k) => {
        const s = k / 16;
        return {
          key: k,
          x: seg.from.x + (aimEnd.x - seg.from.x) * s,
          y: seg.from.y + (aimEnd.y - seg.from.y) * s - arcH * 4 * s * (1 - s),
        };
      })
    : [];

  return (
    <View style={{ gap: 6 }}>
      {/* 코트 */}
      <View style={styles.courtWrap}>
      <View style={styles.court}>
        <View style={[styles.half, styles.halfAway]} />
        <View style={[styles.half, styles.halfHome]} />
        <View style={styles.net} />
        <View style={[styles.attackLine, { top: COURT_H * 0.34 }]} />
        <View style={[styles.attackLine, { top: COURT_H * 0.66 }]} />
        {allMarkers.map((m) => {
          const pos = getPos(m.key, { x: m.tx, y: m.ty });
          const mine = mineSide === m.side;
          const color = m.p ? POS_COLOR[m.p.position] : theme.muted;
          return (
            <Animated.View key={m.key} style={[styles.marker, {
              left: -MR, top: -MR,
              // 다크 네온 코트(2026-06-28): 마커는 다크 채움 + 포지션색 링 + 번호(시안). 특수 상태(교체/서브/브레이스)는 링색 우선.
              backgroundColor: mine ? 'rgba(14,27,43,0.96)' : 'rgba(12,19,31,0.94)',
              // 테두리는 **항상 포지션 색·실선·동일 굵기** — 상태별 색/점선 변경은 전부 제거(2026-06-28 사용자 요청:
              // "생각보다 별로"). 교체 표시는 ↑이름표·🔄 코트 배지·팝인이 담당(테두리는 정체성만).
              borderColor: color,
              borderWidth: 2.5,
              borderStyle: 'solid',
              transform: [{ translateX: pos.x }, { translateY: pos.y }, { scale: m.justSubbed ? subPop : m.jumping ? jumpScale : 1 }],
            }]}>
              <Text style={styles.markerTxt}>{m.p ? jerseyNo(m.p.id) : ''}</Text>
              {m.justSubbed ? (
                <View style={styles.subTag}>
                  <Text style={styles.subTagTxt} numberOfLines={1}>↑ {m.p?.name ?? '교체'}</Text>
                </View>
              ) : m.p ? (
                // 마커 밑 선수명(상시) — 포지션은 마커 안, 이름은 아래(사용자 요청). 내 팀은 강조.
                <View style={styles.nameTag} pointerEvents="none">
                  <Text style={[styles.nameTagTxt, mine && styles.nameTagMine]} numberOfLines={1}>{m.p.name}</Text>
                </View>
              ) : null}
            </Animated.View>
          );
        })}
        {trailDots.map((d) => (
          <View key={d.key} style={[styles.trailDot, { left: d.x - 1.5, top: d.y - 1.5 }]} />
        ))}
        <Animated.View style={[styles.ball, { transform: ballTransform }]} />
        {caption ? (
          <View style={[styles.howBadge, { borderColor: caption.color }]}>
            <Text style={[styles.howTxt, { color: caption.color }]}>{caption.txt}</Text>
          </View>
        ) : null}
        {subEvsNow.length > 0 ? (
          // 룰 30c — 배지를 **이벤트별** 블록으로: 각 교체가 자기 사유(투입=🔄 {kind}·복귀=↩ 원위치)+측(홈/원정)을
          // 스스로 표시한다. 헤더 단수(subEvsNow[0]) 가정을 없애 같은 랠리 2건+(대부분 홈·원정 동시 교체 5%)의
          // 사유·측 소실을 막는다. 실측(_measSubBadge, 800경기) 최대 동시 3행 → SHOW_MAX=3, 초과분은 +N.
          <Animated.View style={[styles.subBadge, { transform: [{ scale: subPop }] }]}>
            {subEvsNow.slice(0, 3).map((e, k) => (
              <View key={k} style={{ marginTop: k ? 6 : 0 }}>
                <Text style={styles.subBadgeHdr}>
                  {`[${e.side === 'home' ? '홈' : '원정'}] `}{e.enter ? `🔄 ${SUB_KIND_KO[e.kind]}` : '↩ 원위치 복귀'}
                </Text>
                <Text style={styles.subInTxt}>{byId.get(e.inId)?.name ?? '선수'} IN</Text>
                <Text style={styles.subOutTxt}>{byId.get(e.outId)?.name ?? '선수'} OUT</Text>
              </View>
            ))}
            {subEvsNow.length > 3 ? (
              <Text style={styles.subBadgeMore}>+{subEvsNow.length - 3}</Text>
            ) : null}
          </Animated.View>
        ) : null}
        {finished ? (() => {
          // 종료 오버레이 — "경기 종료" 대신 누가 몇 대 몇으로 이겼는지(세트 스코어). 관전이 끝난 시점이라 스포일러 무관.
          const homeWon = sim.homeSets > sim.awaySets;
          const winName = (homeWon ? homeName : awayName) ?? (homeWon ? '홈' : '원정');
          const win = Math.max(sim.homeSets, sim.awaySets), lose = Math.min(sim.homeSets, sim.awaySets);
          const mineWon = mineSide != null && (mineSide === 'home') === homeWon;
          return (
            <View style={styles.finishOverlay}>
              <View style={styles.finishCard}>
                <Text style={styles.finishLabel}>경기 종료</Text>
                <Text style={styles.finishWinner} numberOfLines={2}>🏐 {winName} 승</Text>
                <Text style={styles.finishScore}>{win} : {lose}</Text>
                {mineSide != null ? (
                  <Text style={[styles.finishMine, { color: mineWon ? theme.good : theme.muted }]}>
                    {mineWon ? '우리 팀 승리 🎉' : '우리 팀 패배'}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })() : null}
        {/* 5세트 코인토스 연출(순수 표시 — 승패 무영향). coinActive 동안만 표시·랠리 정지 */}
        {coinActive && coinIdx !== null ? (
          <CoinTossOverlay
            serving={rallies[coinIdx].serving}
            homeName={homeName}
            awayName={awayName}
            fast={fast}
          />
        ) : null}
      </View>
      </View>

      {/* 중계 텍스트 — 숨김(2026-06-28, 사용자 요청: "한 번도 안 본다"). 출시 후 원하면 SHOW_FEED=true로 복원.
          feed 누적 로직은 그대로 둠(콜아웃·휘슬·교체 표시는 별개 — 영향 없음). */}
      {SHOW_FEED && feed.length > 0 ? (
        <View style={styles.feedBox}>
          {feed.slice(-4).map((t, i, arr) => (
            <Text key={`${feed.length}-${i}`} numberOfLines={1} style={[styles.feedLine, i === arr.length - 1 && styles.feedLast]}>
              {t}
            </Text>
          ))}
        </View>
      ) : null}

      {/* 플레이 컨트롤 */}
      <View style={styles.controls}>
        <Ctrl label={playing ? '⏸' : '▶'} onPress={() => setPlaying((p) => !p)} />
        <Ctrl label="2x" on={fast} onPress={() => setFast((f) => !f)} />
        <Ctrl label="⏭ 결과" onPress={() => setConfirmEnd(true)} />
      </View>

      {/* 작전 타임아웃 — 경기 멈춤 + 코트 선수 체력(미래: 교체·기세) */}
      <Popup visible={!!timeoutModal} onRequestClose={resumeFromTimeout} card={styles.toModal}>
            {timeoutModal ? (() => {
              const dSide: Side = mineSide ?? timeoutModal.side;
              const stam = dSide === 'home' ? timeoutModal.stamHome : timeoutModal.stamAway;
              const callerMine = mineSide != null && timeoutModal.side === mineSide;
              return (
                <>
                  <Text style={styles.toTitle}>⏱ 작전 타임아웃</Text>
                  <Text style={styles.toSub}>
                    {callerMine ? '우리 벤치에서 타임아웃' : mineSide != null ? '상대 벤치에서 타임아웃' : `${timeoutModal.side === 'home' ? '홈' : '원정'} 타임아웃`}
                    {'  ·  '}{timeoutModal.home}:{timeoutModal.away}
                  </Text>
                  <Text style={styles.toSectionLabel}>코트 선수 체력</Text>
                  <ScrollView style={{ maxHeight: 260 }} showsVerticalScrollIndicator={false}>
                    {stam.map(({ id, stam: s }) => {
                      const p = byId.get(id);
                      const pct = Math.round(s * 100);
                      const barColor = s >= 0.6 ? '#2BAE66' : s >= 0.35 ? '#E0922B' : '#E1574C';
                      return (
                        <View key={id} style={styles.toRow}>
                          <View style={[styles.toPosDot, { backgroundColor: p ? POS_COLOR[p.position] : theme.muted }]}>
                            <Text style={styles.toPosTxt}>{p?.position ?? '?'}</Text>
                          </View>
                          <Text style={styles.toName} numberOfLines={1}>{p?.name ?? '선수'}</Text>
                          <View style={styles.toBarTrack}>
                            <View style={[styles.toBarFill, { width: `${pct}%`, backgroundColor: barColor }]} />
                          </View>
                          <Text style={[styles.toPct, { color: barColor }]}>{pct}%</Text>
                        </View>
                      );
                    })}
                  </ScrollView>
                  <Pressable style={styles.toBtn} onPress={resumeFromTimeout}>
                    <Text style={styles.toBtnTxt}>경기 진행하기 ({toCount}초) ▶</Text>
                  </Pressable>
                </>
              );
            })() : null}
      </Popup>

      {/* ⏭ 결과 — 경기 종료 확인(즉시 종료 방지). 건너뛰면 다시 관전 불가 */}
      <Popup visible={confirmEnd} onRequestClose={() => setConfirmEnd(false)}>
        <Text style={styles.toTitle}>경기를 종료할까요?</Text>
        <Text style={styles.toSub}>끝까지 보지 않고 결과로 건너뜁니다.{'\n'}이후 다시 관전할 수 없어요.</Text>
        <Pressable style={styles.toBtn} onPress={endNow}>
          <Text style={styles.toBtnTxt}>결과 보기</Text>
        </Pressable>
        <Pressable style={styles.toCancel} onPress={() => setConfirmEnd(false)}>
          <Text style={styles.toCancelTxt}>계속 관전</Text>
        </Pressable>
      </Popup>
    </View>
  );
}

function Ctrl({ label, onPress, on }: { label: string; onPress: () => void; on?: boolean }) {
  return (
    <Text onPress={onPress} style={[styles.ctrl, on && { color: theme.accent, borderColor: theme.accent }]}>
      {label}
    </Text>
  );
}

const MR = 15; // 마커 반지름
// 표시용 등번호 — 현역은 고정 등번호 데이터가 없어 id 해시로 결정론 부여(장식, 1~99). 같은 선수=항상 같은 번호.
const jerseyNo = (id: string): number => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return (h % 99) + 1; };

const styles = themedStyles(() => StyleSheet.create({
  courtWrap: { paddingVertical: COURT_PAD, alignItems: 'center' },
  // 다크 네온 코트(2026-06-28 시안) — 어두운 바닥 + 네온 민트 라인/글로우. 라이트 코트(구)에서 전환.
  court: {
    width: COURT_W, height: COURT_H, alignSelf: 'center',
    borderRadius: 12, borderWidth: 2, borderColor: theme.accent, backgroundColor: '#0A1422', overflow: 'visible',
    shadowColor: theme.accent, shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 6,
  },
  half: { position: 'absolute', left: 0, right: 0, height: COURT_H / 2 },
  halfAway: { top: 0, backgroundColor: 'rgba(91,155,255,0.08)' },     // 상대 코트 — 블루 틴트
  halfHome: { bottom: 0, backgroundColor: 'rgba(25,194,174,0.10)' },  // 내 코트 — 민트 틴트
  net: { position: 'absolute', left: 0, right: 0, top: COURT_H / 2 - 1.5, height: 3, backgroundColor: theme.accent },
  attackLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: theme.accent + '55' },
  marker: {
    position: 'absolute', width: MR * 2, height: MR * 2, borderRadius: MR,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
  markerTxt: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  // 마커 밑 상시 선수명 — 작고 옅은 칩(라이트 코트에서 읽히게 흰 배경)
  nameTag: { position: 'absolute', top: MR * 2 - 1, left: -27, width: 84, alignItems: 'center' },
  nameTagTxt: {
    color: '#DCE6F2', fontSize: 8.5, fontWeight: '800', backgroundColor: 'rgba(8,14,24,0.82)',
    paddingHorizontal: 4, paddingVertical: 0.5, borderRadius: 4, overflow: 'hidden',
  },
  nameTagMine: { color: theme.accent, backgroundColor: 'rgba(8,14,24,0.9)' },
  // 갓 투입된 선수 이름표 — 마커 아래 중앙(골드 칩)
  subTag: { position: 'absolute', top: MR * 2 + 1, left: -25, width: 80, alignItems: 'center' },
  subTagTxt: {
    color: '#3D2A00', fontSize: 9.5, fontWeight: '900', backgroundColor: SUB_GOLD,
    paddingHorizontal: 5, paddingVertical: 1, borderRadius: 6, overflow: 'hidden',
  },
  howBadge: {
    position: 'absolute', top: 8, alignSelf: 'center',
    backgroundColor: 'rgba(14,21,33,0.92)', borderWidth: 1.5, borderColor: theme.accent, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 6,
    shadowColor: theme.accent, shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 4,
  },
  howTxt: { fontSize: 13, fontWeight: '900' },
  // 작전 교체 코트 배지 — 좌상단(결과 라벨과 안 겹침). IN 초록·OUT 회색.
  subBadge: {
    position: 'absolute', top: 8, left: 8,
    backgroundColor: 'rgba(14,21,33,0.92)', borderWidth: 1.5, borderColor: SUB_GOLD, borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 5,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
  subBadgeHdr: { color: '#B8860B', fontSize: 10, fontWeight: '900', marginBottom: 2 },
  subBadgeMore: { color: '#B8860B', fontSize: 9, fontWeight: '800', marginTop: 4, opacity: 0.85 },
  subInTxt: { color: '#2563EB', fontSize: 12.5, fontWeight: '900' },   // IN 파랑
  subOutTxt: { color: '#EF4444', fontSize: 11, fontWeight: '800' },    // OUT 빨강
  feedBox: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, gap: 1 },
  feedLine: { color: theme.muted, fontSize: 11 },
  feedLast: { color: theme.text, fontSize: 12.5, fontWeight: '700' },
  ball: {
    position: 'absolute', left: 0, top: 0, width: 12, height: 12, borderRadius: 6,
    marginLeft: -6, marginTop: -6, backgroundColor: '#FFD23F',
    borderWidth: 1, borderColor: '#B8860B',
  },
  trailDot: {
    position: 'absolute', width: 3, height: 3, borderRadius: 1.5,
    backgroundColor: theme.accent + 'cc',
  },
  finishOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  finishCard: { alignItems: 'center', backgroundColor: '#15202BF2', paddingHorizontal: 24, paddingVertical: 16, borderRadius: 14, borderWidth: 1, borderColor: theme.accent + '66' },
  finishLabel: { color: theme.muted, fontSize: 12, fontWeight: '700', letterSpacing: 2, marginBottom: 4 },
  finishWinner: { color: '#FFFFFF', fontSize: 20, fontWeight: '900', textAlign: 'center' },
  finishScore: { color: theme.accent, fontSize: 34, fontWeight: '900', marginTop: 2, letterSpacing: 3 },
  finishMine: { fontSize: 14, fontWeight: '800', marginTop: 6 },
  controls: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  ctrl: {
    color: theme.text, fontSize: 15, fontWeight: '800', overflow: 'hidden',
    borderWidth: 1, borderColor: theme.border, borderRadius: 8,
    paddingHorizontal: 16, paddingVertical: 8, minWidth: 64, textAlign: 'center',
  },
  // 작전 타임아웃 모달
  toBackdrop: { flex: 1, backgroundColor: '#15202B80', alignItems: 'center', justifyContent: 'center', padding: 24 },
  toModal: { backgroundColor: theme.card, borderRadius: 18, padding: 20, gap: 10, alignSelf: 'stretch', borderWidth: 1, borderColor: theme.border },
  toTitle: { color: theme.text, fontSize: 18, fontWeight: '900', textAlign: 'center' },
  toSub: { color: theme.muted, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  toSectionLabel: { color: theme.muted, fontSize: 11, fontWeight: '800', marginTop: 4 },
  toRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  toPosDot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  toPosTxt: { color: '#FFFFFF', fontSize: 9.5, fontWeight: '900' },
  toName: { color: theme.text, fontSize: 13, fontWeight: '700', width: 78 },
  toBarTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: theme.border, overflow: 'hidden' },
  toBarFill: { height: 8, borderRadius: 4 },
  toPct: { fontSize: 12, fontWeight: '800', width: 38, textAlign: 'right' },
  toBtn: { backgroundColor: theme.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  toBtnTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  toCancel: { alignItems: 'center', paddingVertical: 8, marginTop: 2 },
  toCancelTxt: { color: theme.muted, fontSize: 14, fontWeight: '700' },
}));
