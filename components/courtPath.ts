// 랠리 공 이동 경로(안무) — React 무의존 순수 모듈(MatchCourt에서 분리, 헤드리스 검증 가능).
// 배구 3터치 규칙 재현: 디그(첫 터치) → 다른 선수 토스(더블터치 금지, 세터가 디그했으면
// 가까운 다른 선수가 올림) → 전위 공격수 스파이크. 시드 결정론.

import type { Side } from '../types';
import type { PointHow } from '../engine/rally';
import { createRng } from '../engine/rng';
import {
  lineupIdxAt, zonePx, switchedSpots, coverSpots, receiveFormation, receiveLine, type Lineup, type Switched,
} from './courtLayout';

export type Move = 'start' | 'return' | 'walk' | 'serve' | 'pass' | 'toss' | 'spike' | 'fault' | 'bounce';
export type Atk = 'quick' | 'tempo' | 'open' | 'back';
export type Mover = { side: Side; idx: number; x: number; y: number };
// movers: 이 구간에 특정 위치로 움직이는 선수들(디그·커버·쫓기·세트 등)
// aim: 점선(의도) 궤적의 끝점. 실제 공은 x/y로 가지만 궤적은 aim까지 그린다(터치아웃 등)
// atk/blk/dur/arc/scale: 토스 WP의 공격 종류·블록 장수·토스 연출(속공=낮고 빠르게, 오픈=높게)
export type WP = {
  x: number; y: number; side: Side; idx: number; kind: Move;
  movers?: Mover[]; aim?: { x: number; y: number };
  atk?: Atk; blk?: number; dur?: number; arc?: number; scale?: number;
  hold?: boolean; // 서브 국면 데드볼(에이스·서브/리시브 범실) — 대형 동결(공격 전환 금지)
};

export interface RallyLike {
  setNo: number; home: number; away: number; scorer: Side; serving: Side; homeRot: number; awayRot: number;
  how?: PointHow; // 엔진이 기록한 종결 방식 — 있으면 보드는 사실대로 그린다(미기록 구결과는 즉흥)
}
export interface Lineups { home: Lineup; away: Lineup }

export const RECV_FAULT = 0.05; // 리시브 미스(투터치 등) 확률 — 지는 쪽 한정

// 구간 지속(ms, 1배속) — 렌더(MatchCourt)와 헤드리스 감사기가 공유. WP.dur가 있으면 우선.
export const SEG_DUR: Record<Move, number> = { start: 0, return: 520, walk: 560, serve: 300, pass: 380, toss: 540, spike: 150, fault: 320, bounce: 240 };

/** 마커 이동 시간(ms) — 거리 비례. 0.21px/ms ≈ 5.3m/s(실제 스프린트 상한).
 *  이전 0.45(11m/s)는 우사인 볼트 초과 — 비현실 질주. 렌더·감사기 공유. */
export const markerTravelMs = (d: number): number => Math.max(260, Math.min(2200, d / 0.21));

const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 스파이크 코스 — 상대 코트의 다양한 위치(좌우·깊이). deep=득점성(깊고 빈 곳) */
export function spikeTarget(def: Side, rng: ReturnType<typeof createRng>, deep: boolean, W: number, H: number): { x: number; y: number } {
  const x = (0.12 + rng.next() * 0.76) * W;
  const near = deep ? 0.72 : 0.55;
  const span = deep ? 0.24 : 0.4;
  const f = def === 'home' ? near + rng.next() * span : 1 - near - rng.next() * span;
  return { x, y: f * H };
}


/** 랠리 종착 후 바운드 — 종결 에너지에 비례:
 *  강타 킬(인코트)=낮고 길게 한 번에 라인 밖까지 튕겨나감 / 데드 드롭(네트 아래·핸들링)=짧게 톡 /
 *  아웃볼·에이스=중간. 탱탱볼(짧은 동일 바운드 반복) 금지. */
function withBounce(wp: WP[], W: number, H: number): WP[] {
  const last = wp[wp.length - 1];
  if (!last || (last.kind !== 'spike' && last.kind !== 'fault' && last.kind !== 'serve')) return wp;
  const prev = wp[wp.length - 2] ?? last;
  let dx = last.x - prev.x, dy = last.y - prev.y;
  const travel = Math.hypot(dx, dy) || 1;
  dx /= travel; dy /= travel;
  const out = last.x < 0 || last.x > W || last.y < 0 || last.y > H;
  // 바운드 에너지(1차 비거리 px)
  let power: number;
  if (travel < 30) power = 16;                              // 데드 드롭(네트 아래로 뚝·핸들링 휘슬)
  else if (last.kind === 'spike') power = out ? 60 : 150;   // 인코트 강타 = 멀리 튕겨 아웃
  else if (last.kind === 'serve') power = out ? 60 : 95;    // 에이스 = 빠른 서브 관통
  else power = out ? 60 : 55;                               // 기타 fault
  const cl = (p: { x: number; y: number }) => ({
    x: Math.max(-26, Math.min(W + 26, p.x)), y: Math.max(-34, Math.min(H + 34, p.y)),
  });
  const b1 = cl({ x: last.x + dx * power, y: last.y + dy * power });
  const b2 = cl({ x: b1.x + dx * power * 0.16, y: b1.y + dy * power * 0.16 });
  // 강타일수록 낮고 길게(작은 포물선), 약할수록 짧고 통통
  const arc1 = (power >= 120 ? 0.035 : power >= 50 ? 0.05 : 0.02) * H;
  wp.push({ ...b1, side: last.side, idx: -1, kind: 'bounce', dur: power >= 120 ? 330 : 240, arc: arc1, scale: 1.08, hold: last.hold });
  wp.push({ ...b2, side: last.side, idx: -1, kind: 'bounce', dur: 300, arc: 0.015 * H, scale: 1.02, hold: last.hold });
  return wp;
}

/** 한 랠리의 공 이동 경로 — 스위칭(전문 포지션) 기반. prevLast: 직전 낙구점(공 순간이동 방지) */
export function ballPath(r: RallyLike, seed: number, L: Lineups, W: number, H: number, serveOut: number, prevLast?: { x: number; y: number }): WP[] {
  const rng = createRng((seed ^ ((r.home << 8) | r.away) ^ (r.setNo * 7919)) >>> 0);
  const pick = <T,>(a: T[]): T => a[Math.floor(rng.next() * a.length)];
  const rotOf = (s: Side) => (s === 'home' ? r.homeRot : r.awayRot);
  const sw: Record<Side, Switched> = {
    home: switchedSpots('home', L.home, r.homeRot, true, W, H),
    away: switchedSpots('away', L.away, r.awayRot, true, W, H),
  };
  // 수비 자세 좌표(세터 침투 없음) — 디그/추격자 선정은 수비 측 실제 위치 기준
  const swDef: Record<Side, Switched> = {
    home: switchedSpots('home', L.home, r.homeRot, false, W, H),
    away: switchedSpots('away', L.away, r.awayRot, false, W, H),
  };
  const spot = (s: Side, i: number, kind: Move): WP => ({ ...sw[s].pos[i], side: s, idx: i, kind });
  const serveOutY = (side: Side) => (side === 'home' ? H + serveOut : -serveOut);

  const serving = r.serving;
  const recv = other(serving);
  const serverIdx = lineupIdxAt(rotOf(serving), 1);
  const wp: WP[] = [];
  if (prevLast) {
    wp.push({ x: prevLast.x, y: prevLast.y, side: serving, idx: serverIdx, kind: 'start' }); // 직전 낙구점
    wp.push({ ...zonePx(serving, 1, W, H), side: serving, idx: serverIdx, kind: 'return' }); // 공이 서버에게
  } else {
    wp.push({ ...zonePx(serving, 1, W, H), side: serving, idx: serverIdx, kind: 'start' });
  }
  wp.push({ x: zonePx(serving, 1, W, H).x, y: serveOutY(serving), side: serving, idx: serverIdx, kind: 'walk' }); // 엔드라인 뒤로

  // 서브는 리시브 라인(리베로 표시+OH 패서)이 "리시브 대형 자리에서" 받는다 — 스위칭은 패스 중에(현실 순서)
  const recvLu = recv === 'home' ? L.home : L.away;
  const rf = receiveFormation(recv, recvLu, rotOf(recv), W, H);
  const line = receiveLine(recvLu, rotOf(recv));
  const recvIdx = pick(line.length ? line : (sw[recv].backers.length ? sw[recv].backers : [serverIdx]));
  const NETY = 0.5 * H;

  // ── 사실 기반 서브 국면 종결(엔진 how) ──
  if (r.how === 'fault') {
    // 포지션 폴트: 서브 전 휘슬 — 랠리 없이 종료(공은 서버 자리)
    return wp;
  }
  if (r.how === 'serveErr') {
    // 서브 범실: 네트에 걸리거나 길게 아웃 — 받는 팀은 판단(추격 없음)
    if (rng.next() < 0.5) {
      const nx = clampN(zonePx(serving, 1, W, H).x + rng.range(-0.08, 0.08) * W, 0.1 * W, 0.9 * W);
      wp.push({ x: nx, y: serving === 'home' ? NETY + 4 : NETY - 4, side: serving, idx: -1, kind: 'serve', hold: true });
      wp.push({ x: nx, y: serving === 'home' ? NETY + 20 : NETY - 20, side: serving, idx: -1, kind: 'fault', hold: true }); // 네트 아래로 뚝
    } else {
      const ox = clampN(rf[recvIdx].x + rng.range(-0.12, 0.12) * W, 0.1 * W, 0.9 * W);
      wp.push({ x: ox, y: recv === 'home' ? H + 14 : -14, side: serving, idx: -1, kind: 'serve', hold: true }); // 길게 아웃
    }
    return withBounce(wp, W, H);
  }
  if (r.how === 'ace') {
    // 에이스: 리시버 옆을 꿰뚫음 — 몸을 날리지만 닿지 못함
    const ang = rng.range(0, Math.PI * 2);
    const pt = {
      x: clampN(rf[recvIdx].x + Math.cos(ang) * 32, 0.06 * W, 0.94 * W),
      y: clampN(rf[recvIdx].y + Math.abs(Math.sin(ang)) * (recv === 'home' ? 30 : -30), 0.04 * H, 0.96 * H),
    };
    wp.push({ x: pt.x, y: pt.y, side: recv, idx: recvIdx, kind: 'serve', hold: true, movers: [{ side: recv, idx: recvIdx, x: rf[recvIdx].x + (pt.x - rf[recvIdx].x) * 0.8, y: rf[recvIdx].y + (pt.y - rf[recvIdx].y) * 0.8 }] });
    return withBounce(wp, W, H);
  }

  wp.push({ x: rf[recvIdx].x, y: rf[recvIdx].y, side: recv, idx: recvIdx, kind: 'serve' });
  let att: Side = recv;

  const d2 = (a: { x: number; y: number }, p: { x: number; y: number }) => (a.x - p.x) ** 2 + (a.y - p.y) ** 2;
  const chasersTo = (side: Side, target: { x: number; y: number }, n: number, reach: number): Mover[] => {
    const order = [0, 1, 2, 3, 4, 5].sort((a, b) => d2(swDef[side].pos[a], target) - d2(swDef[side].pos[b], target)).slice(0, n);
    return order.map((i) => { const p = swDef[side].pos[i]; return { side, idx: i, x: p.x + (target.x - p.x) * reach, y: p.y + (target.y - p.y) * reach }; });
  };

  // 리시브 미스: 공이 옆/뒤로 튕겨 라인 밖으로, 선수들이 쫓지만 못 살림 → 서브측 득점
  if (r.how ? r.how === 'recvErr' : (recv !== r.scorer && rng.next() < RECV_FAULT)) {
    const rp = rf[recvIdx];
    const dir = rng.next() < 0.5 ? -1 : 1;
    const out = rng.next() < 0.5
      ? { x: dir < 0 ? -12 : W + 12, y: clampN(rp.y + rng.range(-0.1, 0.1) * H, 0.1 * H, 0.9 * H) } // 사이드 밖
      : { x: clampN(rp.x + dir * 0.25 * W, 12, W - 12), y: (recv === 'home' ? H + 12 : -12) }; // 엔드라인 밖
    // 실패한 리시버는 자기가 튕긴 공을 쫓고(닿지 못함), 가까운 2명이 코트 밖까지 추격. 나머지는 대형 동결.
    const selfChase = { side: recv, idx: recvIdx, x: rp.x + (out.x - rp.x) * 0.45, y: rp.y + (out.y - rp.y) * 0.45 };
    const others = chasersTo(recv, out, 3, 1.05).filter((m) => m.idx !== recvIdx).slice(0, 2);
    wp.push({ x: out.x, y: out.y, side: recv, idx: -1, kind: 'fault', hold: true, movers: [selfChase, ...others] });
    return withBounce(wp, W, H);
  }

  let firstTouch = recvIdx; // 이번 공격의 첫 터치(리시브/디그)한 선수 — 토스는 다른 선수가
  for (let hop = 0; hop < 6; hop++) {
    const def = other(att);
    // 리시브/디그 패스는 세터 자리 주변 "일정 범위"에서 랜덤하게 떨어진다(정확히 안 감)
    const sIdx = sw[att].setterIdx;
    const ideal = sIdx >= 0 ? sw[att].pos[sIdx] : sw[att].pos[sw[att].frontHitters[0] ?? 0];
    const ang = rng.range(0, Math.PI * 2);
    const mag = rng.next() ** 1.7 * (0.2 * W); // 대부분 가깝게, 가끔 멀리(난조)
    const yLo = (att === 'home' ? 0.52 : 0.26) * H;
    const yHi = (att === 'home' ? 0.74 : 0.48) * H;
    const passSpot = {
      x: clampN(ideal.x + Math.cos(ang) * mag, 0.12 * W, 0.88 * W),
      y: clampN(ideal.y + Math.sin(ang) * mag * 0.7, yLo, yHi),
    };
    // 세터가 닿으면 세터가, 아니면 가장 가까운 다른 선수가 토스. 단 첫 터치한 선수는 제외(같은 선수가 리시브+토스 금지)
    let tosserIdx: number;
    if (sIdx >= 0 && sIdx !== firstTouch && mag <= 0.12 * W) {
      tosserIdx = sIdx;
    } else {
      const cand = [0, 1, 2, 3, 4, 5].filter((i) => i !== sIdx && i !== firstTouch);
      const pool = cand.length ? cand : [0, 1, 2, 3, 4, 5].filter((i) => i !== firstTouch);
      tosserIdx = pool.reduce((b, i) => (d2(sw[att].pos[i], passSpot) < d2(sw[att].pos[b], passSpot) ? i : b), pool[0]);
    }
    // 공은 패스 지점으로, 토스할 선수가 그 자리로 이동해 세트
    wp.push({ x: passSpot.x, y: passSpot.y, side: att, idx: tosserIdx, kind: 'pass', movers: [{ side: att, idx: tosserIdx, x: passSpot.x, y: passSpot.y }] });

    // 볼핸들링 범실(사실): 더블컨택·캐치 휘슬 — 패스가 죽고 그 자리에서 종료
    if (r.how === 'miscErr' && att === other(r.scorer) && (hop >= 2 || rng.next() < 0.7)) {
      wp.push({ x: clampN(passSpot.x + rng.range(-12, 12), 12, W - 12), y: passSpot.y, side: att, idx: -1, kind: 'fault' });
      return withBounce(wp, W, H);
    }

    // ── 공격 종류 선택 (엔진 분포 근사: 속공 ~12%·시간차 ~7%·백어택 ~18%·오픈 나머지) ──
    const lu = att === 'home' ? L.home : L.away;
    const attFront = [2, 3, 4].map((z) => lineupIdxAt(rotOf(att), z));
    const mbFront = attFront.find((i) => lu.six[i].position === 'MB' && i !== tosserIdx);
    const backCand = [1, 5, 6].map((z) => lineupIdxAt(rotOf(att), z))
      .filter((i) => i !== tosserIdx && i !== sIdx && (lu.six[i].position === 'OH' || lu.six[i].position === 'OP'));
    const inSystem = tosserIdx === sIdx; // 세터 토스 = 인시스템(속공 가능)
    let atk: Atk = 'open';
    const rA = rng.next();
    if (inSystem && mbFront !== undefined) { if (rA < 0.17) atk = 'quick'; else if (rA < 0.26) atk = 'tempo'; }
    if (atk === 'open' && backCand.length && rng.next() < 0.22) atk = 'back';

    let atkIdx: number;
    if (atk === 'quick' || atk === 'tempo') atkIdx = mbFront!;
    else if (atk === 'back') atkIdx = pick(backCand);
    else {
      // 오픈은 전위 OH/OP(센터는 속공 담당) — 결손 시 폴백
      const oh = sw[att].frontHitters.filter((i) => i !== tosserIdx && lu.six[i].position !== 'MB');
      const pool = oh.length ? oh : sw[att].frontHitters.filter((i) => i !== tosserIdx);
      atkIdx = pick(pool.length ? pool : (sw[att].frontHitters.length ? sw[att].frontHitters : [tosserIdx]));
    }

    // ── 타점: 속공=세터 옆 1~2m 낮고 빠르게 / 시간차=조금 넓게 / 백어택=3m 라인 뒤 / 오픈=사이드 레인 ──
    const toLeft = att === 'home' ? -1 : 1;
    const hitY = att === 'home' ? 0.555 * H : 0.445 * H;
    const setterX = sIdx >= 0 ? sw[att].pos[sIdx].x : 0.5 * W;
    const hit =
      atk === 'quick' ? { x: clampN(setterX + toLeft * (0.05 + rng.next() * 0.09) * W, 0.08 * W, 0.92 * W), y: hitY }
      : atk === 'tempo' ? { x: clampN(setterX + toLeft * (0.12 + rng.next() * 0.10) * W, 0.08 * W, 0.92 * W), y: hitY }
      : atk === 'back' ? { x: sw[att].pos[atkIdx].x, y: att === 'home' ? 0.70 * H : 0.30 * H }
      : { x: sw[att].pos[atkIdx].x, y: hitY };
    const ahx = hit.x;

    // 미끼(페이크): 오픈/백어택일 때 전위 센터가 속공 하는 척 세터 쪽으로 달려듦(시드 기반 가변)
    const decoys = attFront.filter((i) => i !== atkIdx && i !== tosserIdx && rng.next() < 0.6);
    const fakeRun: Mover[] = (atk === 'open' || atk === 'back') && mbFront !== undefined && decoys.includes(mbFront)
      ? [{ side: att, idx: mbFront, x: clampN(setterX + toLeft * 0.06 * W, 0.08 * W, 0.92 * W), y: hitY }]
      : [];
    // 공격 커버: 반원(가까운 2 좌우 측면 + 1 깊은 중앙), 좌→우 슬롯 배정(동선 교차 방지)
    const coverCand = [0, 1, 2, 3, 4, 5].filter((i) => i !== atkIdx && i !== tosserIdx && !decoys.includes(i))
      .sort((a, b) => Math.abs(sw[att].pos[a].x - ahx) - Math.abs(sw[att].pos[b].x - ahx)).slice(0, 3)
      .sort((a, b) => sw[att].pos[a].x - sw[att].pos[b].x); // 좌→우
    const cSpots = coverSpots(att, ahx, coverCand.length, W, H, atk === 'back');
    const coverMovers: Mover[] = coverCand.length === 3
      ? [
          { side: att, idx: coverCand[0], ...cSpots[0] },
          { side: att, idx: coverCand[2], ...cSpots[1] },
          { side: att, idx: coverCand[1], ...cSpots[2] },
        ]
      : coverCand.map((i, k) => ({ side: att, idx: i, ...cSpots[k] }));

    // 토스 연출: 속공=낮고 빠르게(작은 포물선) / 오픈=높게 붕 / 백어택=중간 — 블록 장수도 차등
    const blkCount = atk === 'quick' ? 1 : atk === 'open' ? (inSystem ? 2 : 3) : 2;
    const tossDur = atk === 'quick' ? 230 : atk === 'tempo' ? 380 : atk === 'back' ? 500 : 540;
    const tossArc = (atk === 'quick' ? 0.055 : atk === 'tempo' ? 0.10 : atk === 'back' ? 0.15 : 0.17) * H;
    const tossScale = atk === 'quick' ? 1.2 : 1.55;
    wp.push({
      x: hit.x, y: hit.y, side: att, idx: atkIdx, kind: 'toss',
      atk, blk: blkCount, dur: tossDur, arc: tossArc, scale: tossScale,
      movers: [...coverMovers, { side: att, idx: atkIdx, x: hit.x, y: hit.y }, ...fakeRun], // 공격수가 타점으로 이동
    });

    // 스파이크 경로(의도 코스)가 블록 폭 안이면 블록에 걸리고, 각으로 빠지면 안 걸린다
    const ap = hit; // 타점에서 발사
    const blockW = (atk === 'quick' ? 0.10 : atk === 'tempo' ? 0.14 : atk === 'back' ? 0.18 : inSystem ? 0.16 : 0.24) * W;
    const intended = spikeTarget(def, rng, att === r.scorer, W, H); // 공격수가 원한 코스
    const intoBlock = Math.abs(intended.x - ap.x) < blockW;
    const netY = (def === 'home' ? 0.52 : 0.48) * H;
    const sCross = Math.abs(intended.y - ap.y) < 1 ? 0.3 : (netY - ap.y) / (intended.y - ap.y);
    const blockNet = { x: clampN(ap.x + (intended.x - ap.x) * sCross, 12, W - 12), y: netY };
    // 디그 후보 = 후위 전원(세터 포함 — 후위 세터도 디그한다, 엔진 defenders()와 일치).
    // 세터가 디그하면 토서 선정 로직이 자동으로 다른 선수(가까운 전위 — 대개 센터)에게 토스를 맡긴다.
    const dBacks = [1, 5, 6].map((z) => lineupIdxAt(rotOf(def), z));
    const nearestDig = (tg: { x: number; y: number }) => dBacks.reduce((b, i) => (d2(swDef[def].pos[i], tg) < d2(swDef[def].pos[b], tg) ? i : b), dBacks[0]);

    // ── 종결 실행기(사실 기반) ──
    const doKill = () => {
      // 클린 킬: 블록 코스에 걸려 있으면 각을 살짝 빼서(사실은 킬이므로 블록 회피 연출)
      let t = intended;
      if (intoBlock) {
        const dir = Math.sign(intended.x - ap.x) || (rng.next() < 0.5 ? -1 : 1);
        t = { x: clampN(ap.x + dir * (blockW + 0.05 * W), 0.08 * W, 0.92 * W), y: intended.y };
      }
      wp.push({ x: t.x, y: t.y, side: def, idx: -1, kind: 'spike', movers: [...chasersTo(def, t, 1, 0.92), ...coverMovers] });
    };
    const doBlockout = () => {
      // 터치아웃: 블록 스치고 아웃 — 수비 2명이 코트 밖까지 오버런하며 쫓는다(못 살림)
      const outPt = rng.next() < 0.55
        ? { x: ap.x < W / 2 ? W + 13 : -13, y: (def === 'home' ? 0.78 : 0.22) * H }
        : { x: clampN(blockNet.x + rng.range(-0.2, 0.2) * W, 24, W - 24), y: def === 'home' ? H + 18 : -18 };
      wp.push({ x: blockNet.x, y: blockNet.y, side: def, idx: -1, kind: 'spike', aim: intended, movers: coverMovers });
      wp.push({ ...outPt, side: def, idx: -1, kind: 'fault', movers: chasersTo(def, outPt, 2, 1.06) });
    };
    const doStuff = () => {
      // 스터프: 벽에 막혀 자기 코트로 — 커버가 몸을 던진다(못 살림)
      const stuffPt = { x: clampN(ap.x + rng.range(-0.08, 0.08) * W, 12, W - 12), y: (att === 'home' ? 0.78 : 0.22) * H };
      wp.push({ x: blockNet.x, y: blockNet.y, side: def, idx: -1, kind: 'spike', aim: intended, movers: coverMovers });
      wp.push({ ...stuffPt, side: att, idx: -1, kind: 'fault', movers: chasersTo(att, stuffPt, 2, 0.97) });
    };
    const doAtkErr = () => {
      if (rng.next() < 0.45) {
        // 네트에 꽂힘 — 자기 쪽 네트 면 맞고 아래로
        const nx = clampN(ap.x + rng.range(-0.04, 0.04) * W, 0.1 * W, 0.9 * W);
        wp.push({ x: nx, y: att === 'home' ? 0.5 * H + 4 : 0.5 * H - 4, side: att, idx: -1, kind: 'spike', movers: coverMovers });
        wp.push({ x: nx, y: att === 'home' ? 0.5 * H + 20 : 0.5 * H - 20, side: att, idx: -1, kind: 'fault' });
      } else {
        // 라인 밖 — 수비는 아웃 판단(일부러 안 건드림)
        const outPt = rng.next() < 0.6
          ? { x: clampN(intended.x, 0.1 * W, 0.9 * W), y: def === 'home' ? H + 16 : -16 }
          : { x: intended.x < W / 2 ? -14 : W + 14, y: def === 'home' ? clampN(intended.y, 0.56 * H, 0.94 * H) : clampN(intended.y, 0.06 * H, 0.44 * H) };
        wp.push({ x: outPt.x, y: outPt.y, side: def, idx: -1, kind: 'spike', movers: coverMovers });
      }
    };

    if (r.how) {
      // 사실 기반: 엔진이 기록한 종결을, 진 팀/이긴 팀이 맞는 공격 차례에 실행
      const winsByAtk = r.how === 'kill' || r.how === 'blockout' || r.how === 'cap';
      const finalAtt: Side = winsByAtk ? r.scorer : other(r.scorer);
      if (att === finalAtt && (hop >= 3 || rng.next() < 0.7)) {
        if (r.how === 'blockout') doBlockout();
        else if (r.how === 'stuff') doStuff();
        else if (r.how === 'atkErr') doAtkErr();
        else doKill(); // kill·cap (그 외 how는 위 국면에서 이미 종료)
        break;
      }
    } else {
      // 레거시(종결 미기록): 기존 즉흥 분포
      if (att === r.scorer) {
        if (intoBlock) doBlockout(); else doKill();
        break;
      }
      if (intoBlock && rng.next() < 0.55) { doStuff(); break; }
    }

    if (intoBlock) {
      // 원터치(소프트 블록): 블록 스치고 def 코트로 떨어진 걸 디그 → 전환
      const dt = { x: clampN(blockNet.x + rng.range(-0.06, 0.06) * W, 16, W - 16), y: (def === 'home' ? 0.64 : 0.36) * H };
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
  return withBounce(wp, W, H);
}
