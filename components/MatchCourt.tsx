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
import {
  ZONE_X, lineupIdxAt, playerAtZone,
  zonePx as zonePxRaw, switchedSpots as switchedSpotsRaw, receiveFormation as receiveFormationRaw,
  type Switched,
} from './courtLayout';

const POS_COLOR: Record<Position, string> = {
  S: '#a78bfa', OH: '#38bdf8', OP: '#f87171', MB: '#fbbf24', L: '#4ade80',
};

// 코트 영역 크기
const SCREEN_W = Dimensions.get('window').width;
const COURT_W = SCREEN_W - 32;
const COURT_H = Math.min(COURT_W * 1.4, Dimensions.get('window').height * 0.52);

const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// 위치 계산은 courtLayout(순수 모듈)에 — 보드 크기 바인딩 래퍼
const zonePx = (side: Side, zone: number) => zonePxRaw(side, zone, COURT_W, COURT_H);
const switchedSpots = (side: Side, lu: ReturnType<typeof buildLineup>, rot: number, offense: boolean) =>
  switchedSpotsRaw(side, lu, rot, offense, COURT_W, COURT_H);
const receiveFormation = (side: Side, lu: ReturnType<typeof buildLineup>, rot: number) =>
  receiveFormationRaw(side, lu, rot, COURT_W, COURT_H);

/** 스파이크 코스 — 상대 코트의 다양한 위치(좌우·깊이). deep=득점성(깊고 빈 곳) */
function spikeTarget(def: Side, rng: ReturnType<typeof createRng>, deep: boolean): { x: number; y: number } {
  const x = (0.12 + rng.next() * 0.76) * COURT_W;
  const near = deep ? 0.72 : 0.55;
  const span = deep ? 0.24 : 0.4;
  const f = def === 'home' ? near + rng.next() * span : 1 - near - rng.next() * span;
  return { x, y: f * COURT_H };
}

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

// 공 이동 종류 — 구간별 속도/이징이 다르다
type Move = 'start' | 'return' | 'walk' | 'serve' | 'pass' | 'toss' | 'spike' | 'fault';
type Mover = { side: Side; idx: number; x: number; y: number };
// movers: 이 구간에 특정 위치로 움직이는 선수들(디그·커버·쫓기·세트 등)
// aim: 점선(의도) 궤적의 끝점. 실제 공은 x/y로 가지만 궤적은 aim까지 그린다(터치아웃 등)
type WP = { x: number; y: number; side: Side; idx: number; kind: Move; movers?: Mover[]; aim?: { x: number; y: number } };

// 구간 지속(ms, 1배속). 토스=느리게(붕), 스파이크=빠르게. walk=서버가 엔드라인 뒤로, return=공이 서버에게.
const DUR: Record<Move, number> = { start: 0, return: 280, walk: 340, serve: 300, pass: 240, toss: 540, spike: 150, fault: 320 };
// 구간별 포물선 높이(px) / 공 크기 피크 — 토스가 가장 크게 휘고 커진다
const ARC: Record<Move, number> = { start: 0, return: 0, walk: 0, serve: COURT_H * 0.10, pass: COURT_H * 0.05, toss: COURT_H * 0.17, spike: COURT_H * 0.03, fault: COURT_H * 0.06 };
const BALL_SCALE: Record<Move, number> = { start: 1, return: 1, walk: 1, serve: 1.2, pass: 1.05, toss: 1.55, spike: 1.15, fault: 1.1 };
const RECV_FAULT = 0.05; // 리시브 미스(투터치 등) 확률 — 지는 쪽 한정
const JUMP = 1.45; // 점프 시 마커 확대
const SPEED = 2; // 전체 경기 속도 배수(클수록 느림). 2 = 2배 느리게
const SERVE_OUT = 22; // 엔드라인 뒤(코트 밖) 서브 거리(px)
const COURT_PAD = SERVE_OUT + 10; // 코트 밖 서브 공간 확보용 상하 여백
const serveOutY = (side: Side) => (side === 'home' ? COURT_H + SERVE_OUT : -SERVE_OUT);

/** 한 랠리의 공 이동 경로 — 스위칭(전문 포지션) 기반. prevLast: 직전 낙구점(공 순간이동 방지) */
function ballPath(r: Rally, seed: number, L: Lineups, prevLast?: { x: number; y: number }): WP[] {
  const rng = createRng((seed ^ ((r.home << 8) | r.away) ^ (r.setNo * 7919)) >>> 0);
  const pick = <T,>(a: T[]): T => a[Math.floor(rng.next() * a.length)];
  const rotOf = (s: Side) => (s === 'home' ? r.homeRot : r.awayRot);
  const sw: Record<Side, Switched> = {
    home: switchedSpots('home', L.home, r.homeRot, true),
    away: switchedSpots('away', L.away, r.awayRot, true),
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

  const d2 = (a: { x: number; y: number }, p: { x: number; y: number }) => (a.x - p.x) ** 2 + (a.y - p.y) ** 2;
  const chasersTo = (side: Side, target: { x: number; y: number }, n: number, reach: number): Mover[] => {
    const order = [0, 1, 2, 3, 4, 5].sort((a, b) => d2(sw[side].pos[a], target) - d2(sw[side].pos[b], target)).slice(0, n);
    return order.map((i) => { const p = sw[side].pos[i]; return { side, idx: i, x: p.x + (target.x - p.x) * reach, y: p.y + (target.y - p.y) * reach }; });
  };

  // 리시브 미스: 공이 옆/뒤로 튕겨 라인 밖으로, 선수들이 쫓지만 못 살림 → 서브측 득점
  if (recv !== r.scorer && rng.next() < RECV_FAULT) {
    const rp = sw[recv].pos[recvIdx];
    const dir = rng.next() < 0.5 ? -1 : 1;
    const out = rng.next() < 0.5
      ? { x: dir < 0 ? -12 : COURT_W + 12, y: clampN(rp.y + rng.range(-0.1, 0.1) * COURT_H, 0.1 * COURT_H, 0.9 * COURT_H) } // 사이드 밖
      : { x: clampN(rp.x + dir * 0.25 * COURT_W, 12, COURT_W - 12), y: (recv === 'home' ? COURT_H + 12 : -12) }; // 엔드라인 밖
    wp.push({ x: out.x, y: out.y, side: recv, idx: -1, kind: 'fault', movers: chasersTo(recv, out, 2, 0.7) });
    return wp;
  }

  let firstTouch = recvIdx; // 이번 공격의 첫 터치(리시브/디그)한 선수 — 토스는 다른 선수가
  for (let hop = 0; hop < 6; hop++) {
    const def = other(att);
    // 리시브/디그 패스는 세터 자리 주변 "일정 범위"에서 랜덤하게 떨어진다(정확히 안 감)
    const sIdx = sw[att].setterIdx;
    const ideal = sIdx >= 0 ? sw[att].pos[sIdx] : sw[att].pos[sw[att].frontHitters[0] ?? 0];
    const ang = rng.range(0, Math.PI * 2);
    const mag = rng.next() ** 1.7 * (0.2 * COURT_W); // 대부분 가깝게, 가끔 멀리(난조)
    const yLo = (att === 'home' ? 0.52 : 0.26) * COURT_H;
    const yHi = (att === 'home' ? 0.74 : 0.48) * COURT_H;
    const passSpot = {
      x: clampN(ideal.x + Math.cos(ang) * mag, 0.12 * COURT_W, 0.88 * COURT_W),
      y: clampN(ideal.y + Math.sin(ang) * mag * 0.7, yLo, yHi),
    };
    // 세터가 닿으면 세터가, 아니면 가장 가까운 다른 선수가 토스. 단 첫 터치한 선수는 제외(같은 선수가 리시브+토스 금지)
    let tosserIdx: number;
    if (sIdx >= 0 && sIdx !== firstTouch && mag <= 0.12 * COURT_W) {
      tosserIdx = sIdx;
    } else {
      const cand = [0, 1, 2, 3, 4, 5].filter((i) => i !== sIdx && i !== firstTouch);
      const pool = cand.length ? cand : [0, 1, 2, 3, 4, 5].filter((i) => i !== firstTouch);
      tosserIdx = pool.reduce((b, i) => (d2(sw[att].pos[i], passSpot) < d2(sw[att].pos[b], passSpot) ? i : b), pool[0]);
    }
    // 공은 패스 지점으로, 토스할 선수가 그 자리로 이동해 세트
    wp.push({ x: passSpot.x, y: passSpot.y, side: att, idx: tosserIdx, kind: 'pass', movers: [{ side: att, idx: tosserIdx, x: passSpot.x, y: passSpot.y }] });
    const hitters = sw[att].frontHitters.filter((i) => i !== tosserIdx);
    const atkIdx = pick(hitters.length ? hitters : (sw[att].frontHitters.length ? sw[att].frontHitters : [tosserIdx]));

    const ahx = sw[att].pos[atkIdx].x; // 공격수 x
    // 미끼(속공/페이크): 토스 안 온 전위 공격수 일부는 공격하는 척 네트에 남아 커버 못 옴(시드 기반 가변)
    const attFront = [2, 3, 4].map((z) => lineupIdxAt(rotOf(att), z));
    const decoys = attFront.filter((i) => i !== atkIdx && i !== tosserIdx && rng.next() < 0.6);
    // 공격 커버: 공격수·세터·미끼 제외한 선수들이 공격수 뒤로(인원 가변, 최대 3)
    const coverY = (att === 'home' ? 0.7 : 0.3) * COURT_H;
    const coverMovers: Mover[] = [0, 1, 2, 3, 4, 5].filter((i) => i !== atkIdx && i !== tosserIdx && !decoys.includes(i))
      .sort((a, b) => Math.abs(sw[att].pos[a].x - ahx) - Math.abs(sw[att].pos[b].x - ahx)).slice(0, 3)
      .map((i, k) => ({ side: att, idx: i, x: clampN(ahx + (k - 1) * 34, 24, COURT_W - 24), y: coverY }));
    wp.push({ ...spot(att, atkIdx, 'toss'), movers: coverMovers }); // 토스 → 공격수 + 커버 형성(미끼 제외)

    // 스파이크 경로(의도 코스)가 블록 폭 안이면 블록에 걸리고, 각으로 빠지면 안 걸린다(여자배구: 원터치 빈번)
    const ap = sw[att].pos[atkIdx];
    const blockW = (tosserIdx === sw[att].setterIdx ? 0.16 : 0.24) * COURT_W; // 인시스템 2장(좁게)/아웃 3장(넓게)
    const intended = spikeTarget(def, rng, att === r.scorer); // 공격수가 원한 코스
    const intoBlock = Math.abs(intended.x - ap.x) < blockW;
    const netY = (def === 'home' ? 0.52 : 0.48) * COURT_H;
    const sCross = Math.abs(intended.y - ap.y) < 1 ? 0.3 : (netY - ap.y) / (intended.y - ap.y);
    const blockNet = { x: clampN(ap.x + (intended.x - ap.x) * sCross, 12, COURT_W - 12), y: netY };
    const dBacks = sw[def].backers.length ? sw[def].backers : [0, 1, 2, 3, 4, 5].filter((i) => i !== sw[def].setterIdx);
    const nearestDig = (tg: { x: number; y: number }) => dBacks.reduce((b, i) => (d2(sw[def].pos[i], tg) < d2(sw[def].pos[b], tg) ? i : b), dBacks[0]);

    if (att === r.scorer) {
      if (intoBlock) {
        // 블로킹 아웃(터치아웃): 블록 맞고 옆으로 아웃 → 공격 득점. 점선=의도(코트)
        wp.push({ x: blockNet.x, y: blockNet.y, side: def, idx: -1, kind: 'spike', aim: intended, movers: coverMovers });
        wp.push({ x: ap.x < COURT_W / 2 ? COURT_W + 12 : -12, y: (def === 'home' ? 0.78 : 0.22) * COURT_H, side: def, idx: -1, kind: 'fault' });
      } else {
        // 클린 킬: 블록을 각으로 피해 코트로 (수비 못 닿음)
        wp.push({ x: intended.x, y: intended.y, side: def, idx: -1, kind: 'spike', movers: [...chasersTo(def, intended, 1, 0.5), ...coverMovers] });
      }
      break;
    }

    // att !== scorer (def가 득점하거나 랠리 지속)
    if (intoBlock && rng.next() < 0.55) {
      // 스터프 블록: 막혀서 자기 코트로 떨어짐 → 블로킹 당함(def 득점, 랠리 종료)
      wp.push({ x: blockNet.x, y: blockNet.y, side: def, idx: -1, kind: 'spike', aim: intended, movers: coverMovers });
      wp.push({ x: clampN(ap.x + rng.range(-0.08, 0.08) * COURT_W, 12, COURT_W - 12), y: (att === 'home' ? 0.78 : 0.22) * COURT_H, side: att, idx: -1, kind: 'fault' });
      break;
    }

    if (intoBlock) {
      // 원터치(소프트 블록): 블록 스치고 def 코트로 떨어진 걸 디그 → 전환
      const dt = { x: clampN(blockNet.x + rng.range(-0.06, 0.06) * COURT_W, 16, COURT_W - 16), y: (def === 'home' ? 0.64 : 0.36) * COURT_H };
      const digIdx = nearestDig(dt);
      wp.push({ x: blockNet.x, y: blockNet.y, side: def, idx: -1, kind: 'spike', aim: intended, movers: coverMovers }); // 블록 원터치
      wp.push({ x: dt.x, y: dt.y, side: def, idx: -1, kind: 'pass', movers: [{ side: def, idx: digIdx, x: dt.x, y: dt.y }] }); // 디그
      firstTouch = digIdx;
    } else {
      // 클린 디그: 블록 피한 강타를 후위가 받아 전환
      const t = intended;
      const digIdx = nearestDig(t);
      const cover = chasersTo(def, t, 2, 0.5).find((m) => m.idx !== digIdx);
      wp.push({ x: t.x, y: t.y, side: def, idx: -1, kind: 'spike', movers: [{ side: def, idx: digIdx, x: t.x, y: t.y }, ...(cover ? [cover] : []), ...coverMovers] });
      firstTouch = digIdx;
    }
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
    const back = [1, 5, 6].map((z) => lineupIdxAt(fRot, z));
    // 코트 전체 폭(좌·중·우)을 커버하되 공격 방향으로만 살짝 치우침 → 안 뭉침. 가운데 얕게(팁)·양쪽 깊게(라인/크로스)
    const shift = (fanAx - 0.5 * COURT_W) * 0.3;
    const sx = [0.22, 0.5, 0.78].map((b) => clampN(b * COURT_W + shift, 22, COURT_W - 22));
    const yDeep = (fHome ? 0.84 : 0.16) * COURT_H;
    const yMid = (fHome ? 0.72 : 0.28) * COURT_H;
    const slots = [{ x: sx[0], y: yDeep }, { x: sx[1], y: yMid }, { x: sx[2], y: yDeep }];
    back.slice().sort((a, b) => ZONE_X[((a - fRot) % 6 + 6) % 6 + 1] - ZONE_X[((b - fRot) % 6 + 6) % 6 + 1])
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
    const yNet = (dSide === 'home' ? 0.575 : 0.425) * COURT_H;
    const yOff = (dSide === 'home' ? 0.66 : 0.34) * COURT_H;
    // 공격수에 가까운 count명 선택 → 자연 좌우순으로 정렬해 배치(교차 방지)
    const chosen = front.slice().sort((a, b) => Math.abs(dSw.pos[a].x - ax) - Math.abs(dSw.pos[b].x - ax)).slice(0, count)
      .sort((a, b) => dSw.pos[a].x - dSw.pos[b].x);
    const spread = count === 2 ? [-13, 13] : [-22, 0, 22];
    chosen.forEach((bi, k) => { moveMap[`${dSide}-${bi}`] = { x: clampN(ax + spread[k], 24, COURT_W - 24), y: yNet }; });
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
