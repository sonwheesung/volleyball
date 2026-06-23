// 연출 총감독 — 구간(segment)별 "모든 마커의 목표 좌표"를 계산하는 순수 모듈.
// MatchCourt 렌더와 헤드리스 감사기(tools/auditBoard.ts)가 같은 함수를 쓴다
// → 화면에 보이는 위치 = 감사기가 검사하는 위치(단일 소스, 검증 가능).

import type { Player, Side } from '../types';
import type { SimResult, SubEvent } from '../engine/simMatch';
import {
  lineupIdxAt, zonePx, switchedSpots, receiveFormation, serveFormation, fanSlots, blockerWall, separateTargets,
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
    return separateTargets(out, W, H, serveOut); // 무버가 동결 선수 위에 포개지는 것 방지
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
    // 블로커 형성(공격 종류별 장수) + 비선택 전위(오프블로커) 팁 시프트 + 토스한 선수는 패스 지점 유지.
    // (자체점검 2026-06-20: 이걸 spike 프레임까지 확장하면 오프블로커가 네트 밖으로 빠져 네트 옆 공간이
    //  열려 수비홀 9건 — 페리미터의 실제 약점. 회귀라 토스 프레임에 한정. 트레이드오프는 사용자 판단 대기.)
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
    // 오프블로커(블록 안 뛰는 전위): 네트서 풀오프(yOff≈3m선)하며 **시임/팁 쪽으로 시프트**해 팁·연타를
    // 디그할 위치로 — 페리미터의 약점(가운데 팁 무방비)을 오프블로커 팁 커버로 보강(USAV IMPACT·AoC,
    // 2026-06-20 사용자 보고). 공격 x 쪽으로 0.35 당겨 시임을 덮되, 자기 사이드 각(크로스)도 일부 유지.
    front.filter((i) => !chosen.includes(i)).forEach((ri) => {
      const baseX = dSw.pos[ri].x;
      const tipX = baseX + (ax - baseX) * 0.35;
      moveMap[`${dSide}-${ri}`] = { x: Math.max(24, Math.min(W - 24, tipX)), y: yOff };
    });
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
    // 서브대기(walk: 서버가 베이스라인으로 걸어가는 동안)에도 서브 팀은 **서브 대형**(전위 네트 블로킹 준비)
    // 으로 그린다. 기존엔 walk가 !inPlay라 양 팀 다 리시브 대형 → 서브팀 전위가 깊게 보였음(2026-06-20 사용자
    // 보고: "서브팀 전위가 네트에 붙어 블로킹 준비해야"). 받는 팀은 walk에도 리시브 유지. 세터 침투(릴리즈)는
    // walk엔 안 함 — 서브 컨택 후에만(컨택 전 릴리즈 = 오버랩 위반, 룰 45). serveWalk는 서브 대형만 켠다.
    const serveWalk = segKind === 'walk';
    const servePrep = servePhase || serveWalk;
    const holdReceive = serveWalk ? side !== stage.serving : !inPlay || (servePhase && side !== stage.serving);
    // 서브 팀은 **서브 컨택 순간에만** 오버랩 베이스(serveFormation)를 유지한다(룰 Q 합법성).
    // 서브를 보낸 직후(상대 리시브=pass 구간)부터는 곧바로 수비 전문 포지션으로 전환하기 시작한다 —
    // 그래야 상대 공격(토스/스파이크) 전에 수비가 자리를 잡는다(2026-06-18 사용자 보고: 서브하자마자
    // 이동해야 하는데 상대가 공격하려 할 때 그제서야 움직임). 전환은 pass 구간(긴 비행/리시브)에 걸쳐
    // 점진적으로 일어나 "확 점프"가 아니다(markerTravelMs 속도 상한이 부드럽게 만든다).
    const servingDefBase = side === stage.serving && side !== offSide && servePrep;
    // 서브 컨택 순간: 받는 팀=리시브 대형, 서브 팀=오버랩 합법 베이스(상대 리시브까지 유지).
    // 둘 다 로테이션 순서를 지킨다(BOARD_RULES 18). 그 외 인플레이는 스위칭(전문 포지션).
    const posMap = holdReceive
      ? receiveFormation(side, lu, rot, W, H)
      : (servePrep && side === stage.serving) || servingDefBase
        ? serveFormation(side, lu, rot, W, H)
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
  // 같은 목표점에 몰린 마커(추격자 2인·커버 합류 등) 어깨 간격 분리 — 마커 포개짐 방지
  return separateTargets(out, W, H, serveOut);
}

export interface RallyState {
  setNo: number; home: number; away: number; scorer: Side; how?: PointHow;
  byId?: string; // 종결 선수 id(엔진 귀속) — 보드 스파이크 마커를 실제 공격수로(박스 일치)
  serving: Side; homeRot: number; awayRot: number;
  homeSetsBefore: number; awaySetsBefore: number;
}

/**
 * 작전 교체 로그를 재생해 특정 랠리 시점의 코트 6인(라인업 슬롯)을 복원.
 * subEvents 는 점(point) 오름차순 — point ≤ uptoRally 인 모든 교체를 슬롯에 순서대로 적용.
 * (subIn·subOut·세트말 원복 모두 "슬롯 = inId" 형태라 누적 적용하면 그 랠리의 실제 점유자가 됨.)
 * 결정론·승패 무영향: 보드 연출 전용. subEvents 없으면 base 그대로(기존 동작).
 */
export function applySubsToSix(
  baseSix: Player[], side: Side, subEvents: SubEvent[] | undefined, uptoRally: number, byId: Map<string, Player>,
): Player[] {
  if (!subEvents || subEvents.length === 0) return baseSix;
  let six: Player[] | null = null;
  for (const e of subEvents) {
    if (e.point > uptoRally) break;     // 오름차순 — 이후는 모두 미래
    if (e.side !== side) continue;
    const p = byId.get(e.inId);
    if (!p) continue;
    if (!six) six = baseSix.slice();
    six[e.slot] = p;
  }
  return six ?? baseSix;
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
      setNo: pt.setNo, home: pt.home, away: pt.away, scorer: pt.scorer, how: pt.how, byId: pt.byId,
      serving, homeRot, awayRot, homeSetsBefore: hs, awaySetsBefore: as,
    });
    if (pt.scorer !== serving) {
      if (pt.scorer === 'home') homeRot = (homeRot + 1) % 6; else awayRot = (awayRot + 1) % 6;
      serving = pt.scorer;
    }
  }
  return out;
}
