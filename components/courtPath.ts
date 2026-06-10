// 랠리 공 이동 경로(안무) — React 무의존 순수 모듈(MatchCourt에서 분리, 헤드리스 검증 가능).
// 배구 3터치 규칙 재현: 디그(첫 터치) → 다른 선수 토스(더블터치 금지, 세터가 디그했으면
// 가까운 다른 선수가 올림) → 전위 공격수 스파이크. 시드 결정론.

import type { Side } from '../types';
import { createRng } from '../engine/rng';
import {
  lineupIdxAt, zonePx, switchedSpots, coverSpots, type Lineup, type Switched,
} from './courtLayout';

export type Move = 'start' | 'return' | 'walk' | 'serve' | 'pass' | 'toss' | 'spike' | 'fault';
export type Atk = 'quick' | 'tempo' | 'open' | 'back';
export type Mover = { side: Side; idx: number; x: number; y: number };
// movers: 이 구간에 특정 위치로 움직이는 선수들(디그·커버·쫓기·세트 등)
// aim: 점선(의도) 궤적의 끝점. 실제 공은 x/y로 가지만 궤적은 aim까지 그린다(터치아웃 등)
// atk/blk/dur/arc/scale: 토스 WP의 공격 종류·블록 장수·토스 연출(속공=낮고 빠르게, 오픈=높게)
export type WP = {
  x: number; y: number; side: Side; idx: number; kind: Move;
  movers?: Mover[]; aim?: { x: number; y: number };
  atk?: Atk; blk?: number; dur?: number; arc?: number; scale?: number;
};

export interface RallyLike {
  setNo: number; home: number; away: number; scorer: Side; serving: Side; homeRot: number; awayRot: number;
}
export interface Lineups { home: Lineup; away: Lineup }

export const RECV_FAULT = 0.05; // 리시브 미스(투터치 등) 확률 — 지는 쪽 한정

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

  const recvIdx = pick(sw[recv].backers.length ? sw[recv].backers : [serverIdx]);
  wp.push(spot(recv, recvIdx, 'serve')); // 서브 → 리시버(스위칭 후위)
  let att: Side = recv;

  const d2 = (a: { x: number; y: number }, p: { x: number; y: number }) => (a.x - p.x) ** 2 + (a.y - p.y) ** 2;
  const chasersTo = (side: Side, target: { x: number; y: number }, n: number, reach: number): Mover[] => {
    const order = [0, 1, 2, 3, 4, 5].sort((a, b) => d2(swDef[side].pos[a], target) - d2(swDef[side].pos[b], target)).slice(0, n);
    return order.map((i) => { const p = swDef[side].pos[i]; return { side, idx: i, x: p.x + (target.x - p.x) * reach, y: p.y + (target.y - p.y) * reach }; });
  };

  // 리시브 미스: 공이 옆/뒤로 튕겨 라인 밖으로, 선수들이 쫓지만 못 살림 → 서브측 득점
  if (recv !== r.scorer && rng.next() < RECV_FAULT) {
    const rp = sw[recv].pos[recvIdx];
    const dir = rng.next() < 0.5 ? -1 : 1;
    const out = rng.next() < 0.5
      ? { x: dir < 0 ? -12 : W + 12, y: clampN(rp.y + rng.range(-0.1, 0.1) * H, 0.1 * H, 0.9 * H) } // 사이드 밖
      : { x: clampN(rp.x + dir * 0.25 * W, 12, W - 12), y: (recv === 'home' ? H + 12 : -12) }; // 엔드라인 밖
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
    const cSpots = coverSpots(att, ahx, coverCand.length, W, H);
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

    if (att === r.scorer) {
      if (intoBlock) {
        // 블로킹 아웃(터치아웃): 블록 맞고 옆으로 아웃 → 공격 득점. 점선=의도(코트)
        wp.push({ x: blockNet.x, y: blockNet.y, side: def, idx: -1, kind: 'spike', aim: intended, movers: coverMovers });
        wp.push({ x: ap.x < W / 2 ? W + 12 : -12, y: (def === 'home' ? 0.78 : 0.22) * H, side: def, idx: -1, kind: 'fault' });
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
      wp.push({ x: clampN(ap.x + rng.range(-0.08, 0.08) * W, 12, W - 12), y: (att === 'home' ? 0.78 : 0.22) * H, side: att, idx: -1, kind: 'fault' });
      break;
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
  return wp;
}
