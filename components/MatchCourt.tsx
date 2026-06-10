// 경기 보드 — 코트 위 마커(선수)와 노란 공으로 랠리를 시각화.
// 엔진 SimResult.points 만으로 각 랠리의 서브권·로테이션을 복원(엔진과 동일한 사이드아웃 규칙)
// → 마커를 실제 코트 위치에 놓고 공을 득점 결과와 일치하게 애니메이션.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, Text, View } from 'react-native';
import { theme } from './Screen';
import { buildLineup } from '../engine/lineup';
import type { SimResult } from '../engine/simMatch';
import type { Player, Position, Side } from '../types';
import {
  lineupIdxAt, playerAtZone,
  zonePx as zonePxRaw, switchedSpots as switchedSpotsRaw, receiveFormation as receiveFormationRaw,
  fanSlots, blockerWall,
} from './courtLayout';
import { ballPath as ballPathRaw, type Move, type Mover, type WP } from './courtPath';

const POS_COLOR: Record<Position, string> = {
  S: '#a78bfa', OH: '#38bdf8', OP: '#f87171', MB: '#fbbf24', L: '#4ade80',
};

// 코트 영역 크기
const SCREEN_W = Dimensions.get('window').width;
const COURT_W = SCREEN_W - 32;
const COURT_H = Math.min(COURT_W * 1.4, Dimensions.get('window').height * 0.52);

const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');

// 위치 계산은 courtLayout(순수 모듈)에 — 보드 크기 바인딩 래퍼
const zonePx = (side: Side, zone: number) => zonePxRaw(side, zone, COURT_W, COURT_H);
const switchedSpots = (side: Side, lu: ReturnType<typeof buildLineup>, rot: number, offense: boolean) =>
  switchedSpotsRaw(side, lu, rot, offense, COURT_W, COURT_H);
const receiveFormation = (side: Side, lu: ReturnType<typeof buildLineup>, rot: number) =>
  receiveFormationRaw(side, lu, rot, COURT_W, COURT_H);

interface Lineups {
  home: ReturnType<typeof buildLineup>;
  away: ReturnType<typeof buildLineup>;
}

/** 사이드 라인업에서 zone 의 선수 (후위 1·5·6 MB는 리베로로 교체. 리베로는 전위 불가) */
function playerAt(L: Lineups, side: Side, rot: number, zone: number): Player {
  return playerAtZone(side === 'home' ? L.home : L.away, rot, zone);
}

/** 현재 구간에서 공격(세팅) 중인 측 — 그 팀 세터만 네트로 침투 */
function offenseSideOf(seg: { from: WP; to: WP } | null): Side | null {
  if (!seg) return null;
  const k = seg.to.kind;
  if (k === 'serve' || k === 'pass' || k === 'toss') return seg.to.side;
  if (k === 'spike') return seg.from.side;
  return null;
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

// 구간 지속(ms, 1배속). 토스=느리게(붕), 스파이크=빠르게. walk=서버가 엔드라인 뒤로, return=공이 서버에게.
const DUR: Record<Move, number> = { start: 0, return: 280, walk: 340, serve: 300, pass: 240, toss: 540, spike: 150, fault: 320 };
// 구간별 포물선 높이(px) / 공 크기 피크 — 토스가 가장 크게 휘고 커진다
const ARC: Record<Move, number> = { start: 0, return: 0, walk: 0, serve: COURT_H * 0.10, pass: COURT_H * 0.05, toss: COURT_H * 0.17, spike: COURT_H * 0.03, fault: COURT_H * 0.06 };
const BALL_SCALE: Record<Move, number> = { start: 1, return: 1, walk: 1, serve: 1.2, pass: 1.05, toss: 1.55, spike: 1.15, fault: 1.1 };
const JUMP = 1.45; // 점프 시 마커 확대
const SPEED = 2; // 전체 경기 속도 배수(클수록 느림). 2 = 2배 느리게
const SERVE_OUT = 22; // 엔드라인 뒤(코트 밖) 서브 거리(px)
const COURT_PAD = SERVE_OUT + 10; // 코트 밖 서브 공간 확보용 상하 여백
const serveOutY = (side: Side) => (side === 'home' ? COURT_H + SERVE_OUT : -SERVE_OUT);

/** 한 랠리의 공 이동 경로 — courtPath(순수 모듈, 헤드리스 검증 가능)에 위임 */
const ballPath = (r: Rally, seed: number, L: Lineups, prevLast?: { x: number; y: number }): WP[] =>
  ballPathRaw(r, seed, L, COURT_W, COURT_H, SERVE_OUT, prevLast);

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
      duration: DUR[to.kind] * (fast ? 0.4 : 1) * SPEED,
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

  // 이 구간에 특정 선수들이 이동할 목표 좌표(블로커 형성/디그/커버/쫓기/세트/부채꼴). key=`side-idx`
  const moveMap: Record<string, { x: number; y: number }> = {};

  // 수비 후위 부채꼴: 공격 빌드업(토스)·스파이크 때 공격수 x 중심으로 펼친다(가운데 얕게=팁, 양쪽 깊게=라인/크로스)
  let fanSide: Side | null = null;
  let fanAx = 0;
  if (seg && segKind === 'toss') { fanSide = other(seg.to.side); fanAx = seg.to.x; }
  else if (seg && segKind === 'spike') { fanSide = other(seg.from.side); fanAx = seg.from.x; }
  if (fanSide) {
    const fHome = fanSide === 'home';
    const fRot = fHome ? stage.homeRot : stage.awayRot;
    const fLu = fHome ? lineups.home : lineups.away;
    const back = [1, 5, 6].map((z) => lineupIdxAt(fRot, z));
    // 슬롯은 "현재 스위칭 x 순"으로 배정 — 존 순서 기준은 실제 서 있는 위치와 어긋나 동선이 교차(X자)함
    const fSw = switchedSpots(fanSide, fLu, fRot, false);
    const slots = fanSlots(fanSide, fanAx, COURT_W, COURT_H);
    back.slice().sort((a, b) => fSw.pos[a].x - fSw.pos[b].x)
      .forEach((bi, k) => { moveMap[`${fanSide}-${bi}`] = slots[k]; });
  }

  if (seg && segKind === 'toss') {
    // 블로커 형성: 공격수에 가까운 count명이 자연 좌우 순서를 유지하며(안 겹침) 모인다
    const attSide = seg.to.side;
    const dSide = other(attSide);
    const attLu = attSide === 'home' ? lineups.home : lineups.away;
    const attSetterIdx = attLu.six.findIndex((p) => p.position === 'S');
    const count = seg.from.idx === attSetterIdx ? 2 : 3; // 세터 토스 2장 / 아웃오브시스템 3장
    const dRot = dSide === 'home' ? stage.homeRot : stage.awayRot;
    const dLu = dSide === 'home' ? lineups.home : lineups.away;
    const dSw = switchedSpots(dSide, dLu, dRot, false);
    const front = [2, 3, 4].map((z) => lineupIdxAt(dRot, z));
    const ax = seg.to.x;
    const yOff = (dSide === 'home' ? 0.66 : 0.34) * COURT_H;
    // 공격수에 가까운 count명 선택 → 자연 좌우순으로 정렬해 배치(교차 방지)
    const chosen = front.slice().sort((a, b) => Math.abs(dSw.pos[a].x - ax) - Math.abs(dSw.pos[b].x - ax)).slice(0, count)
      .sort((a, b) => dSw.pos[a].x - dSw.pos[b].x);
    const wall = blockerWall(dSide, ax, chosen.length, COURT_W, COURT_H);
    chosen.forEach((bi, k) => { moveMap[`${dSide}-${bi}`] = wall[k]; });
    front.filter((i) => !chosen.includes(i)).forEach((ri) => { moveMap[`${dSide}-${ri}`] = { x: dSw.pos[ri].x, y: yOff }; }); // 블록 안 가는 전위는 빠짐
    moveMap[`${attSide}-${seg.from.idx}`] = { x: seg.from.x, y: seg.from.y }; // 토스한 선수는 패스 지점에서 세트
    // (공격 커버는 토스 WP의 movers로 처리 — 미끼 제외, 인원 가변)
  }
  if (seg && seg.to.movers) for (const m of seg.to.movers) moveMap[`${m.side}-${m.idx}`] = { x: m.x, y: m.y };

  // 마커는 "선수(라인업 인덱스)" 단위로 그린다 → 위치가 바뀌면 무조건 슬라이드(순간이동 금지).
  const getPos = (key: string, init: { x: number; y: number }) => {
    if (!posRefs.current[key]) { posRefs.current[key] = new Animated.ValueXY(init); posLast.current[key] = init; }
    return posRefs.current[key];
  };

  type Mk = { key: string; side: Side; p: Player | undefined; tx: number; ty: number; jumping: boolean; isServer: boolean };
  const offSide = offenseSideOf(seg);
  const buildMarkers = (side: Side): Mk[] => {
    const rot = side === 'home' ? stage.homeRot : stage.awayRot;
    const lu = side === 'home' ? lineups.home : lineups.away;
    // 서브 전: 양 팀 모두 로테이션 합법 대형. 인플레이(서브 후): 전문 포지션 스위칭(오버랩 무관)
    const posMap = inPlay
      ? switchedSpots(side, lu, rot, side === offSide).pos
      : receiveFormation(side, lu, rot);
    const arr: Mk[] = [];
    for (let i = 0; i < 6; i++) {
      const zone = ((i - rot) % 6 + 6) % 6 + 1;     // 이 선수가 현재 선 존
      const isServer = !finished && stage.serving === side && zone === 1;
      const p = isServer ? lu.six[i] : playerAt(lineups, side, rot, zone); // 서버는 실제 선수(리베로는 서브 불가), 그 외 후위 MB→리베로
      const b = posMap[i] ?? zonePx(side, zone);
      let tx = b.x;
      let ty = b.y;
      if (isServer && (segKind === 'walk' || segKind === 'serve')) { tx = zonePx(side, 1).x; ty = serveOutY(side); } // 서브 시 엔드라인 뒤
      else { const mv = moveMap[`${side}-${i}`]; if (mv) { tx = mv.x; ty = mv.y; } } // 블록/디그/커버/쫓기/세트 이동
      const jumping = jl.some((j) => j.side === side && j.idx === i);
      if (jumping) { const lp = posLast.current[`${side}-${i}`]; if (lp) { tx = lp.x; ty = lp.y; } } // 점프 중엔 제자리(착지 후 이동)
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
        Animated.timing(v, { toValue: { x: m.tx, y: m.ty }, duration: 300 * (fast ? 0.4 : 1) * SPEED, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posSig]);

  // 공 transform — 포물선(translateY에 아치 가산) + 크기(떴다 떨어지는 원근감)
  const last = path.length ? path[path.length - 1] : zonePx('home', 1);
  const arcH = seg ? ARC[seg.to.kind] : 0;
  const ballTransform = seg
    ? [
        { translateX: prog.interpolate({ inputRange: [0, 1], outputRange: [seg.from.x, seg.to.x] }) },
        {
          translateY: Animated.add(
            prog.interpolate({ inputRange: [0, 1], outputRange: [seg.from.y, seg.to.y] }),
            prog.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, -0.75 * arcH, -arcH, -0.75 * arcH, 0] }),
          ),
        },
        { scale: prog.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, BALL_SCALE[seg.to.kind], 1] }) },
      ]
    : [{ translateX: last.x }, { translateY: last.y }];

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
        {trailDots.map((d) => (
          <View key={d.key} style={[styles.trailDot, { left: d.x - 1.5, top: d.y - 1.5 }]} />
        ))}
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
  trailDot: {
    position: 'absolute', width: 3, height: 3, borderRadius: 1.5,
    backgroundColor: '#ffffffcc',
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
