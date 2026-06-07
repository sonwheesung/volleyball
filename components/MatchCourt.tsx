// 경기 보드 — 코트 위 마커(선수)와 노란 공으로 랠리를 시각화.
// 엔진 SimResult.points 만으로 각 랠리의 서브권·로테이션을 복원(엔진과 동일한 사이드아웃 규칙)
// → 마커를 실제 코트 위치에 놓고 공을 득점 결과와 일치하게 애니메이션.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, Text, View } from 'react-native';
import { theme } from './Screen';
import { buildLineup } from '../engine/lineup';
import { createRng } from '../engine/rng';
import type { SimResult } from '../engine/simMatch';
import type { Player, Position, Side } from '../types';

const POS_COLOR: Record<Position, string> = {
  S: '#a78bfa', OH: '#38bdf8', OP: '#f87171', MB: '#fbbf24', L: '#4ade80',
};

// 코트 영역 크기
const SCREEN_W = Dimensions.get('window').width;
const COURT_W = SCREEN_W - 32;
const COURT_H = Math.min(COURT_W * 1.4, Dimensions.get('window').height * 0.52);

// 존(zone) → 그리드 (col 0~2, row F=전위/B=후위)
const GRID: Record<number, [number, 'F' | 'B']> = {
  4: [0, 'F'], 3: [1, 'F'], 2: [2, 'F'],
  5: [0, 'B'], 6: [1, 'B'], 1: [2, 'B'],
};
const COLX = [0.18, 0.5, 0.82];

const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 스파이크 코스 — 상대 코트의 다양한 위치(좌우·깊이). deep=득점성(깊고 빈 곳) */
function spikeTarget(def: Side, rng: ReturnType<typeof createRng>, deep: boolean): { x: number; y: number } {
  const x = (0.12 + rng.next() * 0.76) * COURT_W;
  const near = deep ? 0.72 : 0.55;
  const span = deep ? 0.24 : 0.4;
  const f = def === 'home' ? near + rng.next() * span : 1 - near - rng.next() * span;
  return { x, y: f * COURT_H };
}

/** 존 중심 좌표(px) — 홈은 하단, 원정은 상단(좌우·전후 점대칭) */
function zonePx(side: Side, zone: number): { x: number; y: number } {
  const [col, row] = GRID[zone];
  const x = (side === 'home' ? COLX[col] : COLX[2 - col]) * COURT_W;
  const yF = side === 'home' ? 0.62 : 0.38;
  const yB = side === 'home' ? 0.9 : 0.1;
  return { x, y: (row === 'F' ? yF : yB) * COURT_H };
}

/** 로테이션 r 에서 zone 에 선 라인업 인덱스 (zone z → (r+z-1)%6) */
const lineupIdxAt = (r: number, zone: number) => (r + zone - 1) % 6;

interface Lineups {
  home: ReturnType<typeof buildLineup>;
  away: ReturnType<typeof buildLineup>;
}

/** 사이드 라인업에서 zone 의 선수 (후위 5·6 MB는 리베로로 치환) */
function playerAt(L: Lineups, side: Side, rot: number, zone: number): Player {
  const lu = side === 'home' ? L.home : L.away;
  let p = lu.six[lineupIdxAt(rot, zone)];
  if ((zone === 5 || zone === 6) && lu.libero && p?.position === 'MB') p = lu.libero;
  return p;
}

// 스위칭(1.5) — 서브 직후 전문 포지션 좌→우 선호(세터는 네트로 침투)
const LANE: Record<Position, number> = { OH: 0, L: 1, MB: 2, S: 3, OP: 4 };
interface Switched { pos: Record<number, { x: number; y: number }>; setterIdx: number; frontHitters: number[]; backers: number[] }

/** 로테이션 정렬 → 전문 포지션 좌표(선수 인덱스별). 전위=네트 라인, 후위=수비 라인, 세터=네트 중앙우 */
function switchedSpots(side: Side, lu: ReturnType<typeof buildLineup>, rot: number): Switched {
  const front = [2, 3, 4].map((z) => lineupIdxAt(rot, z));
  const back = [1, 5, 6].map((z) => lineupIdxAt(rot, z));
  const posOf = (i: number) => lu.six[i].position;
  const X3 = side === 'home' ? [0.2, 0.5, 0.8] : [0.8, 0.5, 0.2];
  const yF = (side === 'home' ? 0.6 : 0.4) * COURT_H;
  const yB = (side === 'home' ? 0.86 : 0.14) * COURT_H;
  const pos: Record<number, { x: number; y: number }> = {};
  [...front].sort((a, b) => LANE[posOf(a)] - LANE[posOf(b)]).forEach((i, k) => { pos[i] = { x: X3[k] * COURT_W, y: yF }; });
  [...back].sort((a, b) => LANE[posOf(a)] - LANE[posOf(b)]).forEach((i, k) => { pos[i] = { x: X3[k] * COURT_W, y: yB }; });
  const setterIdx = lu.six.findIndex((p) => p.position === 'S');
  if (setterIdx >= 0) pos[setterIdx] = { x: (side === 'home' ? 0.63 : 0.37) * COURT_W, y: (side === 'home' ? 0.57 : 0.43) * COURT_H };
  return { pos, setterIdx, frontHitters: front.filter((i) => i !== setterIdx), backers: back.filter((i) => i !== setterIdx) };
}

interface Rally {
  setNo: number;
  home: number;       // 누적 점수
  away: number;
  scorer: Side;
  serving: Side;
  homeRot: number;
  awayRot: number;
  homeSetsBefore: number;
  awaySetsBefore: number;
}

/** points[] → 랠리별 서브권·로테이션·세트 상태 복원 (engine/match.ts 규칙과 동일) */
function reconstruct(sim: SimResult): Rally[] {
  const out: Rally[] = [];
  let homeRot = 0, awayRot = 0;
  let serving: Side = 'home';
  let curSet = 0;
  let hs = 0, as = 0; // 완료 세트
  for (let i = 0; i < sim.points.length; i++) {
    const pt = sim.points[i];
    if (pt.setNo !== curSet) {
      // 새 세트: 회전 0, 서브권 교대(홀수=홈)
      if (curSet !== 0) {
        const prev = sim.points[i - 1];
        if (prev.home > prev.away) hs++; else as++;
      }
      curSet = pt.setNo;
      homeRot = 0; awayRot = 0;
      serving = pt.setNo % 2 === 1 ? 'home' : 'away';
    }
    out.push({
      setNo: pt.setNo, home: pt.home, away: pt.away, scorer: pt.scorer,
      serving, homeRot, awayRot, homeSetsBefore: hs, awaySetsBefore: as,
    });
    if (pt.scorer !== serving) {
      if (pt.scorer === 'home') homeRot = (homeRot + 1) % 6; else awayRot = (awayRot + 1) % 6;
      serving = pt.scorer;
    }
  }
  return out;
}

// 공 이동 종류 — 구간별 속도/이징이 다르다
type Move = 'start' | 'return' | 'walk' | 'serve' | 'pass' | 'toss' | 'spike' | 'fault';
type WP = { x: number; y: number; side: Side; idx: number; kind: Move };

// 구간 지속(ms, 1배속). 토스=느리게(붕), 스파이크=빠르게. walk=서버가 엔드라인 뒤로, return=공이 서버에게.
const DUR: Record<Move, number> = { start: 0, return: 280, walk: 340, serve: 300, pass: 240, toss: 540, spike: 150, fault: 320 };
// 구간별 포물선 높이(px) / 공 크기 피크 — 토스가 가장 크게 휘고 커진다
const ARC: Record<Move, number> = { start: 0, return: 0, walk: 0, serve: COURT_H * 0.10, pass: COURT_H * 0.05, toss: COURT_H * 0.17, spike: COURT_H * 0.03, fault: COURT_H * 0.06 };
const BALL_SCALE: Record<Move, number> = { start: 1, return: 1, walk: 1, serve: 1.2, pass: 1.05, toss: 1.55, spike: 1.15, fault: 1.1 };
const RECV_FAULT = 0.05; // 리시브 미스(투터치 등) 확률 — 지는 쪽 한정
const JUMP = 1.45; // 점프 시 마커 확대
const SERVE_OUT = 22; // 엔드라인 뒤(코트 밖) 서브 거리(px)
const COURT_PAD = SERVE_OUT + 10; // 코트 밖 서브 공간 확보용 상하 여백
const serveOutY = (side: Side) => (side === 'home' ? COURT_H + SERVE_OUT : -SERVE_OUT);

/** 한 랠리의 공 이동 경로 — 스위칭(전문 포지션) 기반. prevLast: 직전 낙구점(공 순간이동 방지) */
function ballPath(r: Rally, seed: number, L: Lineups, prevLast?: { x: number; y: number }): WP[] {
  const rng = createRng((seed ^ ((r.home << 8) | r.away) ^ (r.setNo * 7919)) >>> 0);
  const pick = <T,>(a: T[]): T => a[Math.floor(rng.next() * a.length)];
  const rotOf = (s: Side) => (s === 'home' ? r.homeRot : r.awayRot);
  const sw: Record<Side, Switched> = {
    home: switchedSpots('home', L.home, r.homeRot),
    away: switchedSpots('away', L.away, r.awayRot),
  };
  const spot = (s: Side, i: number, kind: Move): WP => ({ ...sw[s].pos[i], side: s, idx: i, kind });

  const serving = r.serving;
  const recv = other(serving);
  const serverIdx = lineupIdxAt(rotOf(serving), 1);
  const wp: WP[] = [];
  if (prevLast) {
    wp.push({ x: prevLast.x, y: prevLast.y, side: serving, idx: serverIdx, kind: 'start' }); // 직전 낙구점
    wp.push({ ...zonePx(serving, 1), side: serving, idx: serverIdx, kind: 'return' }); // 공이 서버에게
  } else {
    wp.push({ ...zonePx(serving, 1), side: serving, idx: serverIdx, kind: 'start' });
  }
  wp.push({ x: zonePx(serving, 1).x, y: serveOutY(serving), side: serving, idx: serverIdx, kind: 'walk' }); // 엔드라인 뒤로

  const recvIdx = pick(sw[recv].backers.length ? sw[recv].backers : [serverIdx]);
  wp.push(spot(recv, recvIdx, 'serve')); // 서브 → 리시버(스위칭 후위)
  let att: Side = recv;

  // 리시브 미스(투터치 등): 지는 쪽이 가끔 리시브를 흘려 자기 코트에 떨어뜨림 → 서브측 득점
  if (recv !== r.scorer && rng.next() < RECV_FAULT) {
    wp.push({ x: sw[recv].pos[recvIdx].x, y: (recv === 'home' ? 0.82 : 0.18) * COURT_H, side: recv, idx: -1, kind: 'fault' });
    return wp;
  }

  for (let hop = 0; hop < 6; hop++) {
    const def = other(att);
    const sIdx = sw[att].setterIdx >= 0 ? sw[att].setterIdx : pick(sw[att].frontHitters);
    wp.push(spot(att, sIdx, 'pass')); // 세터에게(스위칭 네트 위치)
    const hitters = sw[att].frontHitters.length ? sw[att].frontHitters : [sIdx];
    wp.push(spot(att, pick(hitters), 'toss')); // 토스 → 공격수(세터와 다른 위치)
    if (att === r.scorer) {
      const t = spikeTarget(def, rng, true); // 득점: 빈 곳에 다양한 코스로 꽂힘
      wp.push({ x: t.x, y: t.y, side: def, idx: -1, kind: 'spike' });
      break;
    }
    // 디그: 다양한 코스로 때리고 → 가장 가까운 후위 수비가 그 자리로 이동해 받음
    const t = spikeTarget(def, rng, false);
    const backs = sw[def].backers.length ? sw[def].backers : [0];
    const dIdx = backs.reduce((b, i) => (Math.abs(sw[def].pos[i].x - t.x) < Math.abs(sw[def].pos[b].x - t.x) ? i : b), backs[0]);
    wp.push({ x: t.x, y: t.y, side: def, idx: dIdx, kind: 'spike' });
    att = def;
  }
  return wp;
}

const easingFor = (k: Move) =>
  k === 'toss' ? Easing.inOut(Easing.quad) : k === 'spike' || k === 'fault' ? Easing.in(Easing.quad) : Easing.linear;

/** 이 구간에 점프하는 마커들 — 서브(서버)·토스(세터)·스파이크(공격수+상대 전위 블로커) */
function jumpersFor(from: WP, to: WP, homeRot: number, awayRot: number): { side: Side; idx: number }[] {
  if (to.kind === 'serve' || to.kind === 'toss') return [{ side: from.side, idx: from.idx }];
  if (to.kind === 'spike') {
    const opp = other(from.side);
    const rot = opp === 'home' ? homeRot : awayRot;
    const blockers = [2, 3, 4].map((z) => lineupIdxAt(rot, z)); // 상대 전위 3
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
  onFinished?: () => void;
}

export function MatchCourt({ sim, home, away, seed, mineSide, onFinished }: Props) {
  const lineups: Lineups = useMemo(() => ({ home: buildLineup(home), away: buildLineup(away) }), [home, away]);
  const rallies = useMemo(() => reconstruct(sim), [sim]);
  const total = rallies.length;

  const [idx, setIdx] = useState(0);      // 현재 진행 중인 랠리
  const [segIdx, setSegIdx] = useState(0);// 랠리 내 공 이동 구간
  const [shown, setShown] = useState(-1); // 점수에 반영된 마지막 랠리
  const [playing, setPlaying] = useState(true);
  const [fast, setFast] = useState(false);

  const prog = useRef(new Animated.Value(0)).current; // 현재 구간 진행도 0..1
  const posRefs = useRef<Record<string, Animated.ValueXY>>({}); // 마커별 위치(선수 단위)
  const posLast = useRef<Record<string, { x: number; y: number }>>({});
  const finishedOnce = useRef(false);

  const finished = idx >= total;
  // 직전 랠리 낙구점 → 새 랠리 공 시작점으로 이어 붙여 공이 순간이동하지 않게
  const prevLast = useMemo(() => {
    if (finished || idx <= 0) return undefined;
    const pp = ballPath(rallies[idx - 1], seed, lineups);
    const w = pp[pp.length - 1];
    return { x: w.x, y: w.y };
  }, [finished, rallies, idx, seed, lineups]);
  const path = useMemo(() => (finished ? [] : ballPath(rallies[idx], seed, lineups, prevLast)), [finished, rallies, idx, seed, lineups, prevLast]);
  const segCount = Math.max(0, path.length - 1);

  // 구간 단위 진행 (위치·포물선·크기·점프를 prog 하나로 동기화)
  useEffect(() => {
    if (!playing || finished) return;
    if (segIdx >= segCount) {
      // 득점 → 점수 반영 후 잠시 멈춤(공은 낙구 지점에 정지) → 다음 랠리
      setShown(idx);
      const t = setTimeout(() => { setIdx((i) => i + 1); setSegIdx(0); }, fast ? 200 : 650);
      return () => clearTimeout(t);
    }
    const to = path[segIdx + 1];
    prog.setValue(0);
    const anim = Animated.timing(prog, {
      toValue: 1,
      duration: DUR[to.kind] * (fast ? 0.4 : 1),
      easing: easingFor(to.kind),
      useNativeDriver: true,
    });
    anim.start(({ finished: done }) => { if (done) setSegIdx((s) => s + 1); });
    return () => anim.stop();
  }, [idx, segIdx, playing, fast, finished, segCount, path, prog]);

  useEffect(() => {
    if (finished && !finishedOnce.current) {
      finishedOnce.current = true;
      onFinished?.();
    }
  }, [finished, onFinished]);

  const seg = !finished && segIdx < segCount ? { from: path[segIdx], to: path[segIdx + 1] } : null;

  // 화면에 표시할 상태
  const view = shown >= 0 ? rallies[Math.min(shown, total - 1)] : null;
  const homeSets = finished ? sim.homeSets : view?.homeSetsBefore ?? 0;
  const awaySets = finished ? sim.awaySets : view?.awaySetsBefore ?? 0;
  const curPts = view ? { h: view.home, a: view.away } : { h: 0, a: 0 };
  const setNo = view?.setNo ?? 1;

  // 마커 배치는 현재 진행 중 랠리(idx) 기준
  const stage = rallies[Math.min(idx, total - 1)];

  const segKind: Move | null = seg ? seg.to.kind : null;
  // 서브 이후(공 인플레이)엔 전 선수가 전문 포지션으로 스위칭
  const inPlay = segKind === 'serve' || segKind === 'pass' || segKind === 'toss' || segKind === 'spike' || segKind === 'fault';
  const jl = seg ? jumpersFor(seg.from, seg.to, stage.homeRot, stage.awayRot) : [];
  const jumpScale = prog.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, JUMP, 1] });

  // 수비 움직임: 토스 때 상대 블로커가 공격수 쪽 네트로 형성, 스파이크 때 디그수가 낙구점으로 이동
  let blockSide: Side | null = null;
  const blockTargets: Record<number, { x: number; y: number }> = {};
  let digSide: Side | null = null;
  let digIdx = -1;
  let digPos = { x: 0, y: 0 };
  if (seg && segKind === 'toss') {
    blockSide = other(seg.to.side);
    const rot = blockSide === 'home' ? stage.homeRot : stage.awayRot;
    const front = [2, 3, 4].map((z) => lineupIdxAt(rot, z));
    const ax = seg.to.x; // 공격수 화면 x
    const yNet = (blockSide === 'home' ? 0.575 : 0.425) * COURT_H;
    front.forEach((fi, k) => { blockTargets[fi] = { x: clampN(ax + (k - 1) * 18, 24, COURT_W - 24), y: yNet }; });
  } else if (seg && segKind === 'spike' && seg.to.idx >= 0) {
    digSide = seg.to.side;
    digIdx = seg.to.idx;
    digPos = { x: seg.to.x, y: seg.to.y };
  }

  // 마커는 "선수(라인업 인덱스)" 단위로 그린다 → 로테이션·서버 in/out 등 위치가 바뀌면
  // 무조건 슬라이드(절대 순간이동 금지). 각 마커는 자기 Animated 위치를 목표로 이동한다.
  const getPos = (key: string, init: { x: number; y: number }) => {
    if (!posRefs.current[key]) { posRefs.current[key] = new Animated.ValueXY(init); posLast.current[key] = init; }
    return posRefs.current[key];
  };

  type Mk = { key: string; side: Side; p: Player | undefined; tx: number; ty: number; jumping: boolean; isServer: boolean };
  const buildMarkers = (side: Side): Mk[] => {
    const rot = side === 'home' ? stage.homeRot : stage.awayRot;
    const lu = side === 'home' ? lineups.home : lineups.away;
    const sw = inPlay ? switchedSpots(side, lu, rot) : null; // 서브 후엔 전문 포지션
    const arr: Mk[] = [];
    for (let i = 0; i < 6; i++) {
      const zone = ((i - rot) % 6 + 6) % 6 + 1;     // 이 선수가 현재 선 존
      const p = playerAt(lineups, side, rot, zone);  // 후위 MB→리베로 치환 포함
      const isServer = !finished && stage.serving === side && zone === 1;
      const base = sw ? sw.pos[i] : zonePx(side, zone);
      let tx = base.x;
      let ty = base.y;
      if (isServer && (segKind === 'walk' || segKind === 'serve')) {
        tx = zonePx(side, 1).x; ty = serveOutY(side); // 서브 시 엔드라인 뒤
      } else if (blockSide === side && blockTargets[i]) {
        tx = blockTargets[i].x; ty = blockTargets[i].y; // 블로커 형성
      } else if (digSide === side && i === digIdx) {
        tx = digPos.x; ty = digPos.y; // 디그수가 낙구점으로 이동
      }
      const jumping = jl.some((j) => j.side === side && j.idx === i);
      arr.push({ key: `${side}-${i}`, side, p, tx, ty, jumping, isServer });
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
        Animated.timing(v, { toValue: { x: m.tx, y: m.ty }, duration: 300, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posSig]);

  // 공 transform — 포물선(translateY에 아치 가산) + 크기(떴다 떨어지는 원근감)
  const last = path.length ? path[path.length - 1] : zonePx('home', 1);
  const ballTransform = seg
    ? [
        { translateX: prog.interpolate({ inputRange: [0, 1], outputRange: [seg.from.x, seg.to.x] }) },
        {
          translateY: Animated.add(
            prog.interpolate({ inputRange: [0, 1], outputRange: [seg.from.y, seg.to.y] }),
            prog.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -ARC[seg.to.kind], 0] }),
          ),
        },
        { scale: prog.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, BALL_SCALE[seg.to.kind], 1] }) },
      ]
    : [{ translateX: last.x }, { translateY: last.y }];

  return (
    <View style={{ gap: 10 }}>
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
              backgroundColor: color + (mine ? 'ee' : '99'),
              borderColor: m.isServer ? theme.warn : mine ? theme.text : 'transparent',
              borderWidth: m.isServer ? 2.5 : mine ? 1.5 : 0,
              transform: [{ translateX: pos.x }, { translateY: pos.y }, { scale: m.jumping ? jumpScale : 1 }],
            }]}>
              <Text style={styles.markerTxt}>{m.p?.position ?? ''}</Text>
            </Animated.View>
          );
        })}
        <Animated.View style={[styles.ball, { transform: ballTransform }]} />
        {finished ? (
          <View style={styles.finishOverlay}>
            <Text style={styles.finishTxt}>경기 종료</Text>
          </View>
        ) : null}
      </View>
      </View>

      {/* 플레이 컨트롤 */}
      <View style={styles.controls}>
        <Ctrl label={playing ? '⏸' : '▶'} onPress={() => setPlaying((p) => !p)} />
        <Ctrl label={fast ? '2x ✓' : '2x'} on={fast} onPress={() => setFast((f) => !f)} />
        <Ctrl label="⏭ 결과" onPress={() => { setPlaying(false); setShown(total - 1); setIdx(total); setSegIdx(0); }} />
      </View>

      {/* 진행 바 */}
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${total ? (Math.min(idx, total) / total) * 100 : 0}%` }]} />
      </View>

      {/* 점수 */}
      <View style={styles.scoreboard}>
        <Text style={[styles.sName, mineSide === 'home' && { color: theme.accent }]} numberOfLines={1}>홈</Text>
        <Text style={styles.sets}>{homeSets}</Text>
        <View style={styles.ptsBox}>
          <Text style={styles.setNo}>{finished ? '종료' : `${setNo}세트`}</Text>
          <Text style={styles.pts}>{curPts.h} : {curPts.a}</Text>
        </View>
        <Text style={styles.sets}>{awaySets}</Text>
        <Text style={[styles.sName, { textAlign: 'right' }, mineSide === 'away' && { color: theme.accent }]} numberOfLines={1}>원정</Text>
      </View>
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

const styles = StyleSheet.create({
  courtWrap: { paddingVertical: COURT_PAD, alignItems: 'center' },
  court: {
    width: COURT_W, height: COURT_H, alignSelf: 'center',
    borderRadius: 10, borderWidth: 2, borderColor: theme.muted, overflow: 'visible',
  },
  half: { position: 'absolute', left: 0, right: 0, height: COURT_H / 2 },
  halfAway: { top: 0, backgroundColor: '#3a2a1a' },
  halfHome: { bottom: 0, backgroundColor: '#1a2e3a' },
  net: { position: 'absolute', left: 0, right: 0, top: COURT_H / 2 - 1.5, height: 3, backgroundColor: theme.text },
  attackLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: theme.muted + '55' },
  marker: {
    position: 'absolute', width: MR * 2, height: MR * 2, borderRadius: MR,
    alignItems: 'center', justifyContent: 'center',
  },
  markerTxt: { color: '#0b1220', fontSize: 11, fontWeight: '900' },
  ball: {
    position: 'absolute', left: 0, top: 0, width: 12, height: 12, borderRadius: 6,
    marginLeft: -6, marginTop: -6, backgroundColor: '#ffd23f',
    borderWidth: 1, borderColor: '#b8860b',
  },
  finishOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  finishTxt: { color: theme.text, fontSize: 22, fontWeight: '900', backgroundColor: '#000a', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  controls: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  ctrl: {
    color: theme.text, fontSize: 15, fontWeight: '800', overflow: 'hidden',
    borderWidth: 1, borderColor: theme.border, borderRadius: 8,
    paddingHorizontal: 16, paddingVertical: 8, minWidth: 64, textAlign: 'center',
  },
  track: { height: 5, backgroundColor: theme.card, borderRadius: 3, marginHorizontal: 4, overflow: 'hidden' },
  fill: { height: 5, backgroundColor: theme.accent },
  scoreboard: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  sName: { flex: 1, color: theme.text, fontSize: 15, fontWeight: '800' },
  sets: { color: theme.muted, fontSize: 20, fontWeight: '900', minWidth: 18, textAlign: 'center' },
  ptsBox: { alignItems: 'center', minWidth: 96 },
  setNo: { color: theme.accent, fontSize: 11, fontWeight: '700' },
  pts: { color: theme.text, fontSize: 30, fontWeight: '900' },
});
