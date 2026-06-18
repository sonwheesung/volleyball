// 랠리 공 이동 경로(안무) — React 무의존 순수 모듈(MatchCourt에서 분리, 헤드리스 검증 가능).
// 배구 3터치 규칙 재현: 디그(첫 터치) → 다른 선수 토스(더블터치 금지, 세터가 디그했으면
// 가까운 다른 선수가 올림) → 전위 공격수 스파이크. 시드 결정론.

import type { Side } from '../types';
import type { PointHow } from '../engine/rally';
import { createRng } from '../engine/rng';
import {
  lineupIdxAt, zonePx, switchedSpots, coverSpots, fanSlots, receiveFormation, receiveLine, NET_SAFE, type Lineup, type Switched,
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
  soft?: boolean; // 연타/팁 낙하 — 바운드 미약
};

export interface RallyLike {
  setNo: number; home: number; away: number; scorer: Side; serving: Side; homeRot: number; awayRot: number;
  how?: PointHow; // 엔진이 기록한 종결 방식 — 있으면 보드는 사실대로 그린다(미기록 구결과는 즉흥)
}
export interface Lineups { home: Lineup; away: Lineup }

export const RECV_FAULT = 0.05; // 리시브 미스(투터치 등) 확률 — 지는 쪽 한정
// 블록 커버: 소프트 블록(원터치)된 공을 공격팀이 자기 코트에서 살려 재공격하는 비율(나머지는 수비 전환).
// 연출 전용 중간 사건(종결 how는 불변) — 실제 배구의 핵심 수비 장면을 보드에 등장시킨다.
// KOVO 데이터 확인(2026-06-18): "블록 커버(continue/cover)는 공식 통계에 없다 — 디그로도 안 친다"
//   (NCAA/배구 통계 정의). 즉 보정할 KOVO 수치가 없고, 엔진 디그(15.9/세트, KOVO 10~16 정렬)는
//   커버를 안 세므로 KOVO 정의와 일치. 0.42는 블록 굴절구가 공격팀 쪽으로 떨어지는 물리적 비율
//   (~40~50%)에 앵커 — 유일한 합리 기준. 순수 미관 다이얼(밸런스 무영향).
const BLOCK_COVER_RATE = 0.42;

// 구간 지속(ms, 1배속) — 렌더(MatchCourt)와 헤드리스 감사기가 공유. WP.dur가 있으면 우선.
export const SEG_DUR: Record<Move, number> = { start: 0, return: 520, walk: 560, serve: 300, pass: 380, toss: 540, spike: 150, fault: 320, bounce: 240 };

/** 마커 이동 시간(ms) — 거리 비례. 0.21px/ms ≈ 5.3m/s(실제 스프린트 상한).
 *  이전 0.45(11m/s)는 우사인 볼트 초과 — 비현실 질주. 렌더·감사기 공유. */
export const markerTravelMs = (d: number): number => Math.max(260, Math.min(2200, d / 0.21));

const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 스파이크 코스 — 상대 코트의 다양한 위치(좌우·깊이). deep=득점성(깊고 빈 곳) */
export function spikeTarget(def: Side, rng: ReturnType<typeof createRng>, deep: boolean, W: number, H: number): { x: number; y: number } {
  // 코스 분포 — 강타는 라인을 노린다: 라인샷 40% · 대각 코너 35% · 중앙 25% (중앙 일변도 금지)
  const r = rng.next();
  const x = (r < 0.4
    ? (rng.next() < 0.5 ? 0.08 + rng.next() * 0.12 : 0.8 + rng.next() * 0.12)   // 사이드 라인샷
    : r < 0.75
      ? (rng.next() < 0.5 ? 0.14 + rng.next() * 0.16 : 0.7 + rng.next() * 0.16) // 대각 코너
      : 0.32 + rng.next() * 0.36) * W;                                          // 중앙
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
  if (last.soft || travel < 30) power = 16;                              // 데드 드롭(네트 아래로 뚝·핸들링 휘슬)
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
  const servePos = zonePx(serving, 1, W, H);
  const wp: WP[] = [];
  if (prevLast) {
    // 공 전달(멀티볼) — 죽은 공이 혼자 서버에게 휭 날아가지 않는다:
    //  우리 진영 안 = 가까운 선수가 주워 서버에게 로브 / 코트 밖·상대 진영 = 볼보이가 옆에서 새 공
    const inCourt = prevLast.x >= 0 && prevLast.x <= W && prevLast.y >= 0 && prevLast.y <= H;
    const myHalf = serving === 'home' ? prevLast.y >= 0.5 * H : prevLast.y <= 0.5 * H;
    if (inCourt && myHalf) {
      const sLu = serving === 'home' ? L.home : L.away;
      const rfs = receiveFormation(serving, sLu, rotOf(serving), W, H);
      const pd2 = (a: { x: number; y: number }) => (a.x - prevLast.x) ** 2 + (a.y - prevLast.y) ** 2;
      const picker = [0, 1, 2, 3, 4, 5].filter((i) => i !== serverIdx)
        .reduce((b, i) => (pd2(rfs[i]) < pd2(rfs[b]) ? i : b), serverIdx === 0 ? 1 : 0);
      wp.push({ x: prevLast.x, y: prevLast.y, side: serving, idx: picker, kind: 'start' });
      // 가까운 선수가 공으로 걸어가 줍고(공은 그 자리에 잠시), 서버에게 로브로 던져준다
      wp.push({ x: prevLast.x, y: prevLast.y, side: serving, idx: picker, kind: 'return', dur: 340, movers: [{ side: serving, idx: picker, x: prevLast.x, y: prevLast.y }] });
      wp.push({ ...servePos, side: serving, idx: serverIdx, kind: 'return', dur: 500, arc: 0.12 * H });
    } else {
      // 볼보이: 서브 코너 사이드라인에서 새 공을 건넨다 — 옛 공 위치에서 날아오지 않음
      const bb = { x: servePos.x < W / 2 ? -16 : W + 16, y: serving === 'home' ? H - 24 : 24 };
      wp.push({ x: bb.x, y: bb.y, side: serving, idx: serverIdx, kind: 'start' });
      wp.push({ ...servePos, side: serving, idx: serverIdx, kind: 'return', dur: 300, arc: 0.05 * H });
    }
  } else {
    wp.push({ ...servePos, side: serving, idx: serverIdx, kind: 'start' });
  }
  wp.push({ x: servePos.x, y: serveOutY(serving), side: serving, idx: serverIdx, kind: 'walk' }); // 엔드라인 뒤로

  // 서브는 "코스"를 노린다(깊은 좌/중/우 70% · 3m 앞 짧은 서브 30%) — 리시버가 공 위치로 움직인다
  const recvLu = recv === 'home' ? L.home : L.away;
  const rf = receiveFormation(recv, recvLu, rotOf(recv), W, H);
  const line = receiveLine(recvLu, rotOf(recv));
  const NETY = 0.5 * H;
  const sd2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  // 서브는 후위 리시브 존을 노린다 — 전위(네트 앞)로 떨어지면 받을 사람이 없어 비현실(2026-06-18 측정).
  let serveTarget = rng.next() < 0.8
    ? { x: clampN((0.12 + rng.next() * 0.76) * W, 0.1 * W, 0.9 * W), y: (recv === 'home' ? 0.76 + rng.next() * 0.13 : 0.11 + rng.next() * 0.13) * H }  // 깊은 코스(후위 리시브)
    : { x: clampN((0.18 + rng.next() * 0.64) * W, 0.1 * W, 0.9 * W), y: (recv === 'home' ? 0.67 + rng.next() * 0.07 : 0.26 + rng.next() * 0.07) * H }; // 짧은 서브(3m 라인 부근 — 후위가 전진 리시브, 전위 아님)
  // 리시버 = 코스에 가장 가까운 패서("마이볼")
  const cands = line.length ? line : (sw[recv].backers.length ? sw[recv].backers : [serverIdx]);
  const recvIdx = cands.reduce((b, i) => (sd2(rf[i] ?? sw[recv].pos[i], serveTarget) < sd2(rf[b] ?? sw[recv].pos[b], serveTarget) ? i : b), cands[0]);
  {
    // 받히는 서브는 리시버가 공 비행 중 도달 가능한 반경 안 — 그보다 먼 코스는 현실에서도 에이스다
    const rbase = rf[recvIdx] ?? sw[recv].pos[recvIdx];
    const dx = serveTarget.x - rbase.x, dy = serveTarget.y - rbase.y;
    const dist = Math.hypot(dx, dy);
    const MAXR = 95; // ≈2.4m — 서브 비행 시간 내 전력 이동 거리
    if (dist > MAXR) serveTarget = { x: rbase.x + (dx / dist) * MAXR, y: rbase.y + (dy / dist) * MAXR };
  }

  // ── 사실 기반 서브 국면 종결(엔진 how) ──
  if (r.how === 'fault') {
    // 포지션 폴트: 서브 전 휘슬 — 랠리 없이 종료(공은 서버 자리)
    return wp;
  }
  if (r.how === 'serveErr') {
    // 서브 범실: 네트에 걸리거나 길게 아웃
    if (rng.next() < 0.5) {
      // 네트인: 공이 네트에 걸린다. 넘어올지 몰라 가장 가까운 리시버가 네트로 달려갔다가, 안 넘어와 멈춘다.
      const nx = clampN(zonePx(serving, 1, W, H).x + rng.range(-0.08, 0.08) * W, 0.1 * W, 0.9 * W);
      const chargeY = recv === 'home' ? NETY + 30 : NETY - 30;        // 리시버 쪽 네트 앞
      const charger = (line.length ? line : [recvIdx]).reduce(
        (b, i) => (sd2(rf[i] ?? sw[recv].pos[i], { x: nx, y: chargeY }) < sd2(rf[b] ?? sw[recv].pos[b], { x: nx, y: chargeY }) ? i : b),
        line[0] ?? recvIdx);
      const charge: Mover = { side: recv, idx: charger, x: clampN(nx, 0.12 * W, 0.88 * W), y: chargeY };
      wp.push({ x: nx, y: serving === 'home' ? NETY + 4 : NETY - 4, side: serving, idx: -1, kind: 'serve', hold: true, movers: [charge] });
      wp.push({ x: nx, y: serving === 'home' ? NETY + 20 : NETY - 20, side: serving, idx: -1, kind: 'fault', hold: true, movers: [charge] }); // 네트 아래로 뚝(서버 쪽), 리시버는 네트 앞에서 멈춤
    } else {
      // 길게 아웃 — 받는 팀은 아웃 판단(추격 없음)
      const ox = clampN(rf[recvIdx].x + rng.range(-0.12, 0.12) * W, 0.1 * W, 0.9 * W);
      wp.push({ x: ox, y: recv === 'home' ? H + 14 : -14, side: serving, idx: -1, kind: 'serve', hold: true }); // 길게 아웃
    }
    return withBounce(wp, W, H);
  }
  const d2 = (a: { x: number; y: number }, p: { x: number; y: number }) => (a.x - p.x) ** 2 + (a.y - p.y) ** 2;
  // shortPx: 죽은 공 추격은 공에 "닿기 직전"에서 멈춘다 — 공 위에 선 수비는 "잡았어야지"가 된다.
  // 이미 공 옆(shortPx+6 이내)에 서 있던 선수는 추격자에서 제외(얼어붙음) — 그 선수가 추격자가
  // 되면 제자리=공 위가 되어 같은 모순이 생긴다(스터프가 네트 앞 전위 옆에 떨어지는 경우).
  const chasersTo = (side: Side, target: { x: number; y: number }, n: number, reach: number, shortPx = 0): Mover[] => {
    const all = [0, 1, 2, 3, 4, 5].sort((a, b) => d2(swDef[side].pos[a], target) - d2(swDef[side].pos[b], target));
    const min2 = (shortPx + 6) ** 2;
    const order = (shortPx > 0 ? all.filter((i) => d2(swDef[side].pos[i], target) >= min2) : all).slice(0, n);
    return order.map((i) => {
      const p = swDef[side].pos[i];
      const dist = Math.hypot(target.x - p.x, target.y - p.y) || 1;
      const travel = Math.min(dist * reach, Math.max(0, dist - shortPx));
      return { side, idx: i, x: p.x + ((target.x - p.x) / dist) * travel, y: p.y + ((target.y - p.y) / dist) * travel };
    });
  };

  if (r.how === 'ace') {
    if (rng.next() < 0.18) {
      // 네트인 에이스: 백테이프를 맞고 뚝 — 서브도 네트 맞고 득점할 수 있다. 가까운 둘이 달려들지만 늦는다
      const nx = clampN(zonePx(serving, 1, W, H).x + rng.range(-0.15, 0.15) * W, 0.15 * W, 0.85 * W);
      const drop = { x: nx, y: recv === 'home' ? NETY + 16 : NETY - 16 };
      wp.push({ x: nx, y: recv === 'home' ? NETY + 3 : NETY - 3, side: recv, idx: -1, kind: 'serve', hold: true, dur: 360 }); // 네트 터치(처리자 없음)
      wp.push({ ...drop, side: recv, idx: -1, kind: 'fault', hold: true, dur: 420, soft: true, movers: chasersTo(recv, drop, 2, 0.82, 24) }); // 다이빙 — 닿지 못함
      return withBounce(wp, W, H);
    }
    // 강서브 에이스: 코스를 꿰뚫음 — 가장 가까운 리시버가 몸을 날리지만 닿지 못함
    const base = rf[recvIdx] ?? sw[recv].pos[recvIdx];
    const pt = {
      x: clampN(serveTarget.x + rng.range(-10, 10), 0.06 * W, 0.94 * W),
      y: clampN(serveTarget.y + (recv === 'home' ? 14 : -14), 0.04 * H, 0.96 * H),
    };
    wp.push({ x: pt.x, y: pt.y, side: recv, idx: recvIdx, kind: 'serve', hold: true, movers: [{ side: recv, idx: recvIdx, x: base.x + (pt.x - base.x) * 0.8, y: base.y + (pt.y - base.y) * 0.8 }] });
    return withBounce(wp, W, H);
  }

  // 정상 리시브: 공이 코스로 — 리시버가 공 위치로 이동해 받는다
  wp.push({ x: serveTarget.x, y: serveTarget.y, side: recv, idx: recvIdx, kind: 'serve', movers: [{ side: recv, idx: recvIdx, x: serveTarget.x, y: serveTarget.y }] });
  let att: Side = recv;

  // 리시브 미스: 공이 옆/뒤로 튕겨 라인 밖으로, 선수들이 쫓지만 못 살림 → 서브측 득점
  if (r.how ? r.how === 'recvErr' : (recv !== r.scorer && rng.next() < RECV_FAULT)) {
    const rp = serveTarget; // 공은 코스에 떨어졌고, 리시버가 거기서 튕겨냈다
    // 튕긴 공은 "동료 없는 쪽"으로 — 옆에 선 수비 코스로 빠지면 잡았어야 한다(블록아웃과 동일 원칙).
    // 동료에서 먼 코스 = 추격 거리가 길어져 "쫓는 장면"도 보인다(짧으면 가만히 서 있는 것처럼 보임).
    const cs = [
      { x: -14, y: clampN(rp.y + rng.range(-0.1, 0.1) * H, 0.1 * H, 0.9 * H) },
      { x: W + 14, y: clampN(rp.y + rng.range(-0.1, 0.1) * H, 0.1 * H, 0.9 * H) },
      { x: clampN(rp.x + (rng.next() < 0.5 ? -1 : 1) * 0.3 * W, 12, W - 12), y: recv === 'home' ? H + 14 : -14 },
    ];
    const mateDist = (p: { x: number; y: number }) =>
      Math.min(...[0, 1, 2, 3, 4, 5].filter((i) => i !== recvIdx).map((i) => d2(rf[i] ?? sw[recv].pos[i], p)));
    const out = cs.reduce((b, c) => (mateDist(c) > mateDist(b) ? c : b));
    // 실패한 리시버는 자기가 튕긴 공을 쫓고(닿지 못함), 가까운 2명이 코트 밖까지 추격. 나머지는 대형 동결.
    const selfChase = { side: recv, idx: recvIdx, x: rp.x + (out.x - rp.x) * 0.45, y: rp.y + (out.y - rp.y) * 0.45 };
    const others = chasersTo(recv, out, 3, 1.05, 26).filter((m) => m.idx !== recvIdx).slice(0, 2);
    wp.push({ x: out.x, y: out.y, side: recv, idx: -1, kind: 'fault', hold: true, movers: [selfChase, ...others] });
    return withBounce(wp, W, H);
  }

  let firstTouch = recvIdx; // 이번 공격의 첫 터치(리시브/디그)한 선수 — 토스는 다른 선수가
  let touchPos = { x: serveTarget.x, y: serveTarget.y }; // 첫 터치 지점 — 그 선수는 한 박자 머문다(즉시 커버 참가 금지)
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
    // 공은 패스 지점으로, 토스할 선수가 그 자리로 이동해 세트.
    // 퍼스트 터치한 선수는 패스 구간부터 그 자리에 멈춘다(자세 회복) — 대형 복귀로 어슬렁거리지 않게
    wp.push({
      x: passSpot.x, y: passSpot.y, side: att, idx: tosserIdx, kind: 'pass',
      movers: [
        { side: att, idx: tosserIdx, x: passSpot.x, y: passSpot.y },
        ...(firstTouch !== tosserIdx ? [{ side: att, idx: firstTouch, x: touchPos.x, y: touchPos.y }] : []),
      ],
    });

    // ── 공격 종류 선택 (엔진 분포 근사: 속공 ~12%·시간차 ~7%·백어택 ~18%·오픈 나머지) ──
    const lu = att === 'home' ? L.home : L.away;
    const attFront = [2, 3, 4].map((z) => lineupIdxAt(rotOf(att), z));
    const mbFront = attFront.find((i) => lu.six[i].position === 'MB' && i !== tosserIdx);
    // 퍼스트 터치(리시브/디그)한 선수는 이번 공격에서 제외 — 받은 직후 자세 회복(한 박자 멈춤)
    const backCand = [1, 5, 6].map((z) => lineupIdxAt(rotOf(att), z))
      .filter((i) => i !== tosserIdx && i !== sIdx && i !== firstTouch && (lu.six[i].position === 'OH' || lu.six[i].position === 'OP'));
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
      const oh = sw[att].frontHitters.filter((i) => i !== tosserIdx && i !== firstTouch && lu.six[i].position !== 'MB');
      const pool = oh.length ? oh : sw[att].frontHitters.filter((i) => i !== tosserIdx);
      atkIdx = pick(pool.length ? pool : (sw[att].frontHitters.length ? sw[att].frontHitters : [tosserIdx]));
    }

    // ── 타점: 속공=토스 지점 옆 1~2m 낮고 빠르게 / 시간차=조금 넓게 / 백어택=3m 라인 뒤 / 오픈=사이드 레인 ──
    // 기준은 세터 "대형" x가 아니라 공이 실제 올라가는 지점(passSpot) — 토서는 패스를 따라
    // 움직이므로, 대형 기준으로 잡으면 패스가 흐른 날 타점·미끼가 토서 위에 포개진다.
    const toLeft = att === 'home' ? -1 : 1;
    // 공격수 타점 — 네트 안전 여백 보장(점프 마커가 네트 침범 안 하게, 저해상도 폰 대응)
    const hitY = att === 'home' ? Math.max(0.555 * H, 0.5 * H + NET_SAFE) : Math.min(0.445 * H, 0.5 * H - NET_SAFE);
    // 토스 지점에서 off만큼 옆 — 코트 가장자리에 몰리면 반대쪽으로(간격 보존이 우선)
    const besideX = (off: number) => {
      const want = passSpot.x + toLeft * off;
      return want < 0.08 * W || want > 0.92 * W ? clampN(passSpot.x - toLeft * off, 0.08 * W, 0.92 * W) : want;
    };
    const hit =
      atk === 'quick' ? { x: besideX((0.08 + rng.next() * 0.08) * W), y: hitY }
      : atk === 'tempo' ? { x: besideX((0.14 + rng.next() * 0.10) * W), y: hitY }
      : atk === 'back' ? { x: sw[att].pos[atkIdx].x, y: att === 'home' ? 0.70 * H : 0.30 * H }
      : { x: sw[att].pos[atkIdx].x, y: hitY };
    const ahx = hit.x;

    // 속공 페이크(미끼) 런은 넣지 않는다 — 톱뷰 2D에선 토스 중 세터 쪽 질주가 "토서 방해"로만
    // 읽힌다(사용자 보고 3회). 비커버 전위(decoys)는 네트 앞 자기 자리를 지키는 걸로 위협을 표현.
    const decoys = attFront.filter((i) => i !== atkIdx && i !== tosserIdx && i !== firstTouch && rng.next() < 0.6);
    // 공격 커버: 반원(가까운 2 좌우 측면 + 1 깊은 중앙), 좌→우 슬롯 배정(동선 교차 방지)
    // 첫 터치(리시브/디그)한 선수는 제외 — 패스 직후 한 박자 머물러야지 즉시 커버로 뛰면 어색하다
    // 커버 풀이 비면(백어택 시 전위가 전부 미끼로 빠진 경우) 미끼라도 1명은 받친다 — 무방비 금지.
    //   후위 공격의 블록 리바운드는 네트 앞에 떨어지므로 전위 선수가 커버로 들어오는 게 정석.
    let coverPool = [0, 1, 2, 3, 4, 5].filter((i) => i !== atkIdx && i !== tosserIdx && i !== firstTouch && !decoys.includes(i));
    if (coverPool.length === 0) coverPool = [0, 1, 2, 3, 4, 5].filter((i) => i !== atkIdx && i !== tosserIdx && i !== firstTouch);
    const coverCand = coverPool
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
    // 커버 슬롯이 토스 지점과 우연히 포개지면(타점≈토스 지점) 토서에서 24px 밖으로 — 토서 점유 금지
    for (const mv of coverMovers) {
      const cdx = mv.x - passSpot.x, cdy = mv.y - passSpot.y;
      const cdd = Math.hypot(cdx, cdy);
      if (cdd < 24) {
        const ux = cdd > 0.01 ? cdx / cdd : (att === 'home' ? -1 : 1);
        const uy = cdd > 0.01 ? cdy / cdd : 0;
        mv.x = clampN(passSpot.x + ux * 24, 12, W - 12);
        mv.y = clampN(passSpot.y + uy * 24, 12, H - 12);
      }
    }

    // 토스 연출: 속공=낮고 빠르게(작은 포물선) / 오픈=높게 붕 / 백어택=중간 — 블록 장수도 차등
    const blkCount = atk === 'quick' ? 1 : atk === 'open' ? (inSystem ? 2 : 3) : 2;
    const tossDur = atk === 'quick' ? 230 : atk === 'tempo' ? 380 : atk === 'back' ? 500 : 540;
    const tossArc = (atk === 'quick' ? 0.055 : atk === 'tempo' ? 0.10 : atk === 'back' ? 0.15 : 0.17) * H;
    const tossScale = atk === 'quick' ? 1.2 : 1.55;
    wp.push({
      x: hit.x, y: hit.y, side: att, idx: atkIdx, kind: 'toss',
      atk, blk: blkCount, dur: tossDur, arc: tossArc, scale: tossScale,
      movers: [
        ...coverMovers,
        { side: att, idx: atkIdx, x: hit.x, y: hit.y }, // 공격수가 타점으로 이동
        // 첫 터치한 선수는 패스 지점에 한 박자 머문다(자세 회복) — 다음 구간부터 합류
        ...(firstTouch !== atkIdx && firstTouch !== tosserIdx
          ? [{ side: att, idx: firstTouch, x: touchPos.x, y: touchPos.y }]
          : []),
      ],
    });

    // 볼핸들링 범실(사실): 세터의 세트가 더블컨택/들어올림 — 휘슬. 공이 (자기에게가 아니라) 공격수
    // 쪽으로 올라가던 중 죽는다. 위 toss WP가 firstTouch·커버를 올바로 잡으므로(M 안전) 여기서 스파이크
    // 대신 낙구만 — 공은 타점 부근에 뚝 떨어진다.
    if (r.how === 'miscErr' && att === other(r.scorer) && (hop >= 2 || rng.next() < 0.7)) {
      wp.push({ x: clampN(hit.x + rng.range(-10, 10), 12, W - 12), y: hit.y + (att === 'home' ? 14 : -14), side: att, idx: -1, kind: 'fault', soft: true });
      return withBounce(wp, W, H);
    }

    // 스파이크 경로(의도 코스)가 블록 폭 안이면 블록에 걸리고, 각으로 빠지면 안 걸린다
    const ap = hit; // 타점에서 발사
    const blockW = (atk === 'quick' ? 0.10 : atk === 'tempo' ? 0.14 : atk === 'back' ? 0.18 : inSystem ? 0.16 : 0.24) * W;
    const intended = spikeTarget(def, rng, att === r.scorer, W, H); // 공격수가 원한 코스
    const intoBlock = Math.abs(intended.x - ap.x) < blockW;
    const netY = (def === 'home' ? 0.52 : 0.48) * H;
    const sCross = Math.abs(intended.y - ap.y) < 1 ? 0.3 : (netY - ap.y) / (intended.y - ap.y);
    const blockNet = { x: clampN(ap.x + (intended.x - ap.x) * sCross, 12, W - 12), y: netY };
    // 블록은 타점 앞(ap.x)에 형성된다 → 종결 블록(스터프·블록아웃)은 공이 "블록 정면"으로 들어가야
    // 모순이 없다. blockNet(의도 코스 기준)은 빈 곳을 통과할 수 있어, 그대로 쓰면 "블록 없는 곳에
    // 때렸는데 막힘"이 된다(측정 42%). 블록 사건은 blockContact(블록 중심)로 보낸다.
    const blockContact = { x: clampN(ap.x + rng.range(-0.04, 0.04) * W, 16, W - 16), y: netY };
    // 디그 후보 = 후위 전원(세터 포함 — 후위 세터도 디그한다, 엔진 defenders()와 일치).
    // 세터가 디그하면 토서 선정 로직이 자동으로 다른 선수(가까운 전위 — 대개 센터)에게 토스를 맡긴다.
    // 리베로 콜 우선권: 후위 MB 슬롯(표시=리베로)은 약간 멀어도 "마이볼" — 수비 전문이 수비를 한다.
    const dBacks = [1, 5, 6].map((z) => lineupIdxAt(rotOf(def), z));
    const dluSix = (def === 'home' ? L.home : L.away).six;
    const nearestDig = (tg: { x: number; y: number }) => {
      const ds = dBacks.map((i) => ({ i, d: d2(swDef[def].pos[i], tg) })).sort((a, b) => a.d - b.d);
      const libIdx = dBacks.find((i) => dluSix[i]?.position === 'MB');
      if (libIdx !== undefined && libIdx !== ds[0].i) {
        const dl = ds.find((x) => x.i === libIdx);
        if (dl && dl.d <= ds[0].d * 1.7) return libIdx; // 거리 1.3배 이내면 리베로가 부른다
      }
      return ds[0].i;
    };

    // ── 종결 실행기(사실 기반) ──
    const doKill = () => {
      // 클린 킬: 블록 코스에 걸려 있으면 각을 살짝 빼서(사실은 킬이므로 블록 회피 연출)
      let t = intended;
      if (intoBlock) {
        const dir = Math.sign(intended.x - ap.x) || (rng.next() < 0.5 ? -1 : 1);
        t = { x: clampN(ap.x + dir * (blockW + 0.05 * W), 0.08 * W, 0.92 * W), y: intended.y };
      }
      wp.push({ x: t.x, y: t.y, side: def, idx: -1, kind: 'spike', movers: [...chasersTo(def, t, 1, 0.92, 22), ...coverMovers] });
    };
    const doBlockout = () => {
      // 터치아웃: 블록 손끝을 맞고 **코트 밖 멀리** 빠진다 — 후보 코스(좌·우 사이드 한참 밖, 엔드라인
      // 한참 밖) 중 수비에서 가장 먼 곳. 멀리 나가는 공은 못 잡는 게 정상 → 추격 2명은 라인에서 멈춰
      // 멀어지는 공을 지켜본다(2026-06-18 사용자 보고: 멀리 나가야 하는데 잡을 수 있는 위치에 서 있음).
      const cs = [
        { x: -58, y: (def === 'home' ? 0.72 + rng.next() * 0.12 : 0.16 + rng.next() * 0.12) * H },
        { x: W + 58, y: (def === 'home' ? 0.72 + rng.next() * 0.12 : 0.16 + rng.next() * 0.12) * H },
        { x: clampN(blockContact.x + rng.range(-0.22, 0.22) * W, 24, W - 24), y: def === 'home' ? H + 52 : -52 },
      ];
      const fan = fanSlots(def, ap.x, W, H);
      const defDist = (p: { x: number; y: number }) =>
        Math.min(...[0, 1, 2, 3, 4, 5].map((i) => d2(swDef[def].pos[i], p)), ...fan.map((s) => d2(s, p)));
      const outPt = cs.reduce((b, c) => (defDist(c) > defDist(b) ? c : b));
      // 강타가 블록 정면(손끝)을 강하게 때린다 — 짧고 빠른 잭(dur↓). 그 뒤 손끝에 에너지를 뺏겨 굴절구는
      // 크게 떠올라(arc↑) 천천히 코트 밖으로 빠진다 → 공이 블록으로 들어갔다가 빠진 게 보인다.
      wp.push({ x: blockContact.x, y: blockContact.y, side: def, idx: -1, kind: 'spike', dur: 95, movers: coverMovers });
      // 후위 2명이 라인까지 쫓지만 멀리 나간 굴절구엔 닿지 못한다(70px≈1.7m 밖에서 멈춰 지켜봄 — 도착해서
      // 못 잡는 모순 제거). 멀리 나간 공은 감사 룰 H(추격 사정권 밖)에서 추격 요구 면제.
      wp.push({ ...outPt, side: def, idx: -1, kind: 'fault', dur: 700, arc: 0.12 * H, scale: 1.05, movers: chasersTo(def, outPt, 2, 0.78, 70) });
    };
    const doStuff = () => {
      // 스터프: 벽에 막혀 수직으로 꺾임 — 공격수 바로 뒤(네트~3m)에 꽂힌다. 깊게 날아가면
      // 랠리 공처럼 읽히므로 낙하점은 짧게. 막힌 공은 떠오르지 않는다 — 포물선 0으로
      // 블록 면에서 그대로 내리꽂힌다(위로 붕 떴다 떨어지면 스터프로 안 읽힘).
      // 커버 2명이 낙하점으로 몸을 던지지만 못 살린다. 벽은 데드볼 동결로 네트 앞에 서 있다.
      const dropY = att === 'home' ? (0.56 + rng.next() * 0.08) * H : (0.36 + rng.next() * 0.08) * H;
      const stuffPt = { x: clampN(blockContact.x + rng.range(-0.05, 0.05) * W, 16, W - 16), y: dropY };
      // 공이 블록 정면으로 들어가 수직으로 꺾인다(빈 곳 통과 모순 제거). aim(점선)도 빼서 "엉뚱한 곳 점선" 방지.
      wp.push({ x: blockContact.x, y: blockContact.y, side: def, idx: -1, kind: 'spike', movers: coverMovers });
      wp.push({ ...stuffPt, side: att, idx: -1, kind: 'fault', dur: 240, arc: 0, scale: 1, movers: chasersTo(att, stuffPt, 2, 0.9, 24) });
    };
    const doTip = () => {
      // 페인트(연타) 득점: 블록 너머 빈 공간에 톡. 후보 낙하점 중 수비에서 가장 먼 곳(빈 공간)으로 —
      // "수비가 앞에 있는데 안 잡는" 모순 방지. 두 연출(사용자 제안): ① 수비가 못 읽어 굳음(아무도 못 옴) /
      // ② 가까운 수비가 손은 댔지만 리시브 실패 → 공이 동료 없는 쪽으로 튕겨 죽는다.
      const cands = [-0.18, -0.09, 0.09, 0.18].map((dx) => ({
        x: clampN(ap.x + dx * W, 0.14 * W, 0.86 * W),
        y: def === 'home' ? (0.58 + rng.next() * 0.1) * H : (0.32 + rng.next() * 0.1) * H,
      }));
      const defDistT = (p: { x: number; y: number }) => Math.min(...[0, 1, 2, 3, 4, 5].map((i) => d2(swDef[def].pos[i], p)));
      const t = cands.reduce((b, c) => (defDistT(c) > defDistT(b) ? c : b));
      const nearIdx = nearestDig(t);
      const np = swDef[def].pos[nearIdx];
      const nearD = Math.hypot(np.x - t.x, np.y - t.y);
      if (nearD < 0.16 * W) {
        // ② 닿긴 했지만 리시브 실패 — 손에 맞고 동료 없는 쪽으로 튕겨 죽는다(연타 디그 실패)
        wp.push({ x: t.x, y: t.y, side: def, idx: -1, kind: 'spike', dur: 470, arc: 0.115 * H, scale: 1.3, soft: true,
          movers: [{ side: def, idx: nearIdx, x: t.x + (np.x < t.x ? -8 : 8), y: t.y }, ...coverMovers] });
        const dir = np.x < t.x ? 1 : -1; // 댄 손 반대쪽으로 튕김
        const deflect = { x: clampN(t.x + dir * (0.18 + rng.next() * 0.1) * W, 10, W - 10), y: clampN(t.y + (def === 'home' ? 0.1 : -0.1) * H, 0.08 * H, 0.92 * H) };
        wp.push({ ...deflect, side: def, idx: -1, kind: 'fault', soft: true });
      } else {
        // ① 수비가 못 읽어 굳음 — 아무도 못 와 빈 공간에 톡 떨어진다(경직)
        wp.push({ x: t.x, y: t.y, side: def, idx: -1, kind: 'spike', dur: 470, arc: 0.115 * H, scale: 1.3, soft: true, movers: coverMovers });
      }
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
      const winsByAtk = r.how === 'kill' || r.how === 'blockout' || r.how === 'cap' || r.how === 'tip';
      const finalAtt: Side = winsByAtk ? r.scorer : other(r.scorer);
      if (att === finalAtt && (hop >= 3 || rng.next() < 0.7)) {
        if (r.how === 'tip') doTip();
        else if (r.how === 'blockout') doBlockout();
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

    let nextAtt: Side = def; // 기본: 공수 전환(아래 블록 커버 시 공격팀 유지)
    if (intoBlock) {
      // 원터치(소프트 블록): 떠오른 공을 ① 공격팀이 커버해 살림(재공격) ② 또는 수비팀 코트로 넘어가 디그 전환.
      if (rng.next() < BLOCK_COVER_RATE) {
        // 블록 커버 — 공이 공격팀 코트 네트 앞에 떨어지고, 후위/커버가 몸을 던져 살린다 → 같은 팀 재공격
        const ct = { x: clampN(blockNet.x + rng.range(-0.07, 0.07) * W, 16, W - 16), y: (att === 'home' ? 0.61 : 0.39) * H };
        const aBacks = [1, 5, 6].map((z) => lineupIdxAt(rotOf(att), z));
        const coverIdx = aBacks.reduce((b, i) => (d2(swDef[att].pos[i], ct) < d2(swDef[att].pos[b], ct) ? i : b), aBacks[0]);
        wp.push({ x: blockNet.x, y: blockNet.y, side: def, idx: -1, kind: 'spike', aim: intended, movers: coverMovers }); // 블록 원터치(공격팀 쪽으로 튕김)
        wp.push({ x: ct.x, y: ct.y, side: att, idx: -1, kind: 'pass', movers: [{ side: att, idx: coverIdx, x: ct.x, y: ct.y }] }); // 커버 디그(살림)
        firstTouch = coverIdx;
        touchPos = ct;
        nextAtt = att; // 커버 성공 → 같은 팀이 다시 공격
      } else {
        // 원터치 → def 코트로 떨어진 걸 디그 → 공수 전환
        const dt = { x: clampN(blockNet.x + rng.range(-0.06, 0.06) * W, 16, W - 16), y: (def === 'home' ? 0.64 : 0.36) * H };
        const digIdx = nearestDig(dt);
        wp.push({ x: blockNet.x, y: blockNet.y, side: def, idx: -1, kind: 'spike', aim: intended, movers: coverMovers }); // 블록 원터치
        wp.push({ x: dt.x, y: dt.y, side: def, idx: -1, kind: 'pass', movers: [{ side: def, idx: digIdx, x: dt.x, y: dt.y }] }); // 디그
        firstTouch = digIdx;
        touchPos = dt;
      }
    } else if (rng.next() < 0.18) {
      // 페인트가 살아나는 장면 — 엔진에선 팁 절반이 디그된다. 수비가 몸을 던져 받아내고 랠리가 이어진다
      const tp = {
        x: clampN(ap.x + (rng.next() < 0.5 ? -1 : 1) * (0.05 + rng.next() * 0.07) * W, 0.12 * W, 0.88 * W),
        y: def === 'home' ? (0.58 + rng.next() * 0.07) * H : (0.35 + rng.next() * 0.07) * H,
      };
      const digIdx = nearestDig(tp);
      wp.push({ x: tp.x, y: tp.y, side: def, idx: -1, kind: 'spike', dur: 470, arc: 0.115 * H, scale: 1.3, soft: true, movers: [{ side: def, idx: digIdx, x: tp.x, y: tp.y }, ...coverMovers] });
      firstTouch = digIdx;
      touchPos = tp;
    } else {
      // 클린 디그: 블록 피한 강타를 후위가 받아 전환 — 강타 위세에 한 걸음(12px) 뒤로 밀린다.
      // 연타(팁·원터치)는 제자리 디그 — 공 속도에 따라 밀림이 갈린다(사용자 제안 반영).
      const t = intended;
      const digIdx = nearestDig(t);
      const kd = Math.hypot(t.x - ap.x, t.y - ap.y) || 1;
      const dug = {
        x: clampN(t.x + ((t.x - ap.x) / kd) * 12, 12, W - 12),
        y: clampN(t.y + ((t.y - ap.y) / kd) * 12, 12, H - 12),
      };
      const cover = chasersTo(def, t, 2, 0.5).find((m) => m.idx !== digIdx);
      wp.push({ x: t.x, y: t.y, side: def, idx: -1, kind: 'spike', movers: [{ side: def, idx: digIdx, ...dug }, ...(cover ? [cover] : []), ...coverMovers] });
      firstTouch = digIdx;
      touchPos = dug;
    }
    att = nextAtt;
  }
  return withBounce(wp, W, H);
}
