// 연출 총감독 — 구간(segment)별 "모든 마커의 목표 좌표"를 계산하는 순수 모듈.
// MatchCourt 렌더와 헤드리스 감사기(tools/auditBoard.ts)가 같은 함수를 쓴다
// → 화면에 보이는 위치 = 감사기가 검사하는 위치(단일 소스, 검증 가능).

import type { Side } from '../types';
import type { SimResult } from '../engine/simMatch';
import {
  lineupIdxAt, zonePx, switchedSpots, receiveFormation, fanSlots, blockerWall,
  type Lineup, type Px,
} from './courtLayout';
import type { WP, Move, Lineups } from './courtPath';
import type { PointHow } from '../engine/rally';

export interface StageInfo { serving: Side; homeRot: number; awayRot: number }
export interface Seg { from: WP; to: WP }

const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');

/** 현재 구간에서 공격(세팅) 중인 측 — 그 팀 세터만 네트로 침투 */
export function offenseSideOf(seg: Seg | null): Side | null {
  if (!seg) return null;
  const k = seg.to.kind;
  if (k === 'serve' || k === 'pass' || k === 'toss') return seg.to.side;
  if (k === 'spike') return seg.from.side;
  return null;
}

export const isInPlay = (k: Move | null): boolean =>
  k === 'serve' || k === 'pass' || k === 'toss' || k === 'spike' || k === 'fault';

/**
 * 구간별 전 마커(12명) 목표 좌표. key = `${side}-${idx}`.
 * (점프 중 제자리 고정은 애니메이션 상태라 렌더 측에서만 처리)
 */
export function segmentTargets(
  seg: Seg | null,
  stage: StageInfo,
  L: Lineups,
  W: number,
  H: number,
  serveOut: number,
  prevTargets?: Record<string, Px>, // 직전 구간 목표 — 데드볼(fault/bounce) 동결용
): Record<string, Px> {
  const segKind: Move | null = seg ? seg.to.kind : null;

  // 데드볼/루스볼(fault·bounce): 지정 무버(추격자)만 움직이고 전원 동결 — 죽은 공에
  // 대형 재배치(공격 전환·릴랙스 일제 이동) 금지. 복귀는 다음 랠리 시작 구간에서.
  if ((segKind === 'fault' || segKind === 'bounce') && prevTargets && Object.keys(prevTargets).length) {
    const out: Record<string, Px> = { ...prevTargets };
    if (seg?.to.movers) for (const m of seg.to.movers) out[`${m.side}-${m.idx}`] = { x: m.x, y: m.y };
    return out;
  }

  const inPlay = isInPlay(segKind);
  const offSide = offenseSideOf(seg);
  const serveOutY = (side: Side) => (side === 'home' ? H + serveOut : -serveOut);

  // ── 이동 목표(블로커/부채꼴/커버/디그/세트) ──
  const moveMap: Record<string, Px> = {};

  // 수비 후위 부채꼴: 토스·스파이크 때 공격 x 중심으로
  let fanSide: Side | null = null;
  let fanAx = 0;
  if (seg && segKind === 'toss') { fanSide = other(seg.to.side); fanAx = seg.to.x; }
  else if (seg && segKind === 'spike') { fanSide = other(seg.from.side); fanAx = seg.from.x; }
  if (fanSide) {
    const fRot = fanSide === 'home' ? stage.homeRot : stage.awayRot;
    const fLu = fanSide === 'home' ? L.home : L.away;
    const back = [1, 5, 6].map((z) => lineupIdxAt(fRot, z));
    const fSw = switchedSpots(fanSide, fLu, fRot, false, W, H);
    const slots = fanSlots(fanSide, fanAx, W, H);
    back.slice().sort((a, b) => fSw.pos[a].x - fSw.pos[b].x)
      .forEach((bi, k) => { moveMap[`${fanSide}-${bi}`] = slots[k]; });
  }

  if (seg && segKind === 'toss') {
    // 블로커 형성(공격 종류별 장수) + 비선택 전위 후퇴 + 토스한 선수는 패스 지점 유지
    const attSide = seg.to.side;
    const dSide = other(attSide);
    const attLu = attSide === 'home' ? L.home : L.away;
    const attSetterIdx = attLu.six.findIndex((p) => p.position === 'S');
    const count = seg.to.blk ?? (seg.from.idx === attSetterIdx ? 2 : 3);
    const dRot = dSide === 'home' ? stage.homeRot : stage.awayRot;
    const dLu = dSide === 'home' ? L.home : L.away;
    const dSw = switchedSpots(dSide, dLu, dRot, false, W, H);
    const front = [2, 3, 4].map((z) => lineupIdxAt(dRot, z));
    const ax = seg.to.x;
    const yOff = (dSide === 'home' ? 0.66 : 0.34) * H;
    const chosen = front.slice().sort((a, b) => Math.abs(dSw.pos[a].x - ax) - Math.abs(dSw.pos[b].x - ax)).slice(0, count)
      .sort((a, b) => dSw.pos[a].x - dSw.pos[b].x);
    const wall = blockerWall(dSide, ax, chosen.length, W, H);
    chosen.forEach((bi, k) => { moveMap[`${dSide}-${bi}`] = wall[k]; });
    front.filter((i) => !chosen.includes(i)).forEach((ri) => { moveMap[`${dSide}-${ri}`] = { x: dSw.pos[ri].x, y: yOff }; });
    moveMap[`${attSide}-${seg.from.idx}`] = { x: seg.from.x, y: seg.from.y };
  }
  if (seg && seg.to.movers) for (const m of seg.to.movers) moveMap[`${m.side}-${m.idx}`] = { x: m.x, y: m.y };

  // ── 사이드별 기본 대형 + 오버라이드 합성 ──
  const out: Record<string, Px> = {};
  for (const side of ['home', 'away'] as Side[]) {
    const rot = side === 'home' ? stage.homeRot : stage.awayRot;
    const lu = side === 'home' ? L.home : L.away;
    // 서브 비행 중엔 "받는 팀"은 리시브 대형 유지(실제 배구 — 스위칭은 패스 이후).
    // 서브 팀은 서브와 동시에 수비 전환 시작.
    // 서브 국면(서브 비행 + 데드볼: 에이스·서브/리시브 범실)엔 받는 팀이 리시브 대형 유지 —
    // 죽은 공에 공격 전환(스위칭 질주) 금지. 추격자(movers)만 공을 쫓는다.
    const servePhase = segKind === 'serve' || seg?.to.hold === true;
    const holdReceive = !inPlay || (servePhase && side !== stage.serving);
    const posMap = holdReceive
      ? receiveFormation(side, lu, rot, W, H)
      : switchedSpots(side, lu, rot, side === offSide, W, H).pos;
    // 단, 받는 팀 세터는 서브 컨택과 동시에 침투 출발(실제 배구) — 패스 도착 전에 세팅 자리 도달
    if (servePhase && side !== stage.serving) {
      const sIdx = lu.six.findIndex((p) => p.position === 'S');
      if (sIdx >= 0) posMap[sIdx] = switchedSpots(side, lu, rot, true, W, H).pos[sIdx];
    }
    for (let i = 0; i < 6; i++) {
      const zone = ((i - rot) % 6 + 6) % 6 + 1;
      const isServer = stage.serving === side && zone === 1;
      const b = posMap[i] ?? zonePx(side, zone, W, H);
      let t: Px = { x: b.x, y: b.y };
      if (isServer && (segKind === 'walk' || segKind === 'serve')) t = { x: zonePx(side, 1, W, H).x, y: serveOutY(side) };
      else { const mv = moveMap[`${side}-${i}`]; if (mv) t = mv; }
      out[`${side}-${i}`] = t;
    }
  }
  return out;
}

export interface RallyState {
  setNo: number; home: number; away: number; scorer: Side; how?: PointHow;
  serving: Side; homeRot: number; awayRot: number;
  homeSetsBefore: number; awaySetsBefore: number;
}

/** points[] → 랠리별 서브권·로테이션·세트 상태 복원 (engine/match.ts 규칙과 동일) */
export function reconstructRallies(sim: SimResult): RallyState[] {
  const out: RallyState[] = [];
  let homeRot = 0, awayRot = 0;
  let serving: Side = 'home';
  let curSet = 0;
  let hs = 0, as = 0;
  for (let i = 0; i < sim.points.length; i++) {
    const pt = sim.points[i];
    if (pt.setNo !== curSet) {
      if (curSet !== 0) {
        const prev = sim.points[i - 1];
        if (prev.home > prev.away) hs++; else as++;
      }
      curSet = pt.setNo;
      homeRot = 0; awayRot = 0;
      serving = pt.setNo % 2 === 1 ? 'home' : 'away';
    }
    out.push({
      setNo: pt.setNo, home: pt.home, away: pt.away, scorer: pt.scorer, how: pt.how,
      serving, homeRot, awayRot, homeSetsBefore: hs, awaySetsBefore: as,
    });
    if (pt.scorer !== serving) {
      if (pt.scorer === 'home') homeRot = (homeRot + 1) % 6; else awayRot = (awayRot + 1) % 6;
      serving = pt.scorer;
    }
  }
  return out;
}
