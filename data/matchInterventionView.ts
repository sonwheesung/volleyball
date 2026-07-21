// 경기 개입 시트 "표시 산출" 순수 셀렉터 (MATCH_INTERVENTION_SYSTEM §4) — 잔여 예산·교체 후보·핀치 차단을
// 엔진 출력(SimResult)+개입 지시(directives)만으로 결정론 계산한다. app/match/[id].tsx 인라인 산출을 여기로
// 추출해 node 가드(_gt_ivbudget)가 직접 검증할 수 있게 함(허위 오라클 방지 — tsx 인라인은 검증 불가).
//
// ── 좌표 규약(§3, 코드 실측 2026-07-21) ──
//   · 유저 개입 교체(sub)의 SubEvent.point = 랠리 루프 최상단 points.length = ptIdx+1  (직전 기록 점수 points[ptIdx] 직후 iteration)
//   · 감독 자동 교체(rest/pinch/block/def)도 **같은 iteration**(ptIdx+1)에 point=ptIdx+1로 기록된다(_tmp_probe 400/400 확인).
//     → 그래서 예산/후보 컷오프를 단순히 `point<=ptIdx+1`로 넓히면 **아직 화면에 안 나온 미래 자동 교체까지 미리 세는**
//       부작용이 있다. 자동 교체는 유저 개입 블록보다 **뒤**에 실행되므로(match.ts) 유저 다음 개입의 실예산을 깎지 않는다.
//   · 유저 타임아웃의 TimeoutEvent.point = points.length-1 = ptIdx (개입 sub과 달리 -1) → `point<=ptIdx`가 이미 포함(스테일 아님).
//   · 부상 교체 SubEvent.point = 랠리 push 후 기록이라 ptIdx+1(직전 랠리 부상) — 현 컷오프(point<=ptIdx)는 기존 동작 그대로 보존.
//
// ── 수정(2026-07-21, 스테일 카운트 버그) ──
//   버그: `ivBudget`·`benchCands`·`outCands`·`pinchBlock`이 컷오프 `point<=ptIdx`만 봐서, **같은 데드볼에 방금 커밋한
//   유저 개입**(point=ptIdx+1)을 절대 못 셈 → 연속 교체 시 잔여 예산·후보·차단 판정이 스테일(테스터 "남은 5/6에서 3명
//   교체해도 5/6"). 형제 3곳도 동일 컷오프라 이미 나간 선수가 후보에 남는 등 동반 결함.
//   수정: **재생 완료분(point<=ptIdx) + 아직 재생 안 된 내 지시(pending)** 이중 항. pending = 현재 좌표 유저 sub 지시가
//   실제 적용된 enter(point===ptIdx+1 & inId이 유저 지시 inId) — 자동 교체는 유저 inId를 재사용 못 하므로(usedSubIn) 자연 분리.

import type { Player, Side } from '../types';
import type { MatchIntervention, SimResult, SubEvent } from '../engine/simMatch';
import { SUBS_PER_SET, TIMEOUTS_PER_SET } from '../engine/match';

/** 개입 시트가 여는 데드볼 좌표(현재 표시 점수) — ptIdx = points[]의 현재 점수 전역 인덱스. */
export interface IvCoord { setNo: number; h: number; a: number; ptIdx: number }

/** 현재 좌표에서 유저가 지시한 sub 개입의 inId 집합(적용/미적용 무관 — 지시 자체). */
function userSubInIdsAt(directives: MatchIntervention[], cur: IvCoord): Set<string> {
  const s = new Set<string>();
  for (const d of directives) {
    if (d.kind === 'sub' && d.inId != null && d.at.setNo === cur.setNo && d.at.h === cur.h && d.at.a === cur.a) s.add(d.inId);
  }
  return s;
}

/** 아직 재생 안 된(pending) 내 개입 교체 enter 이벤트 — 주입 좌표(point===ptIdx+1)에서 엔진이 실제 적용한 것만.
 *  유저 지시 inId와 매칭해 감독 자동 교체(같은 point지만 유저 inId를 재사용 못 함)를 배제한다. 미적용(no-op) 지시는
 *  subEvent가 없어 자동 제외(예산 무차감이 정확). */
export function pendingSubEntries(sim: SimResult, mineSide: Side, cur: IvCoord, directives: MatchIntervention[]): SubEvent[] {
  const inIds = userSubInIdsAt(directives, cur);
  if (!inIds.size) return [];
  return (sim.subEvents ?? []).filter((e) =>
    e.enter && e.kind !== 'injury' && e.side === mineSide && e.setNo === cur.setNo && e.point === cur.ptIdx + 1 && inIds.has(e.inId));
}

/** 현 좌표에서 mineSide에 **활성인 복원형(pinch/block/def) 교체 수** — 엔진이 각자 나중에 subOut(무조건 예산 −1)로
 *  예산을 1씩 더 쓴다(engine/match subIn 예산 예약 회계, P0 감사A). 유저가 지금 더 쓸 수 있는 교체 수(headroom)는
 *  subBudget − 이 값이므로 subLeft에서 뺀다(표시=엔진). 재생 완료(point≤ptIdx) net(enter add / mid-out delete) +
 *  방금 커밋한 유저 pinch(pending, point=ptIdx+1). rest/manual은 세트말 무예산 원복이라 예약 제외. manualSide(구단주 직접)
 *  경기는 감독 자동 복원형이 없어 항상 0 → 격리 시나리오 무영향(구 산식 바이트 동일). */
export function activeRestorableCount(sim: SimResult, mineSide: Side, cur: IvCoord, directives: MatchIntervention[]): number {
  const restKind = (k: SubEvent['kind']) => k === 'pinch' || k === 'block' || k === 'def';
  const slots = new Set<number>();
  for (const e of sim.subEvents ?? []) {
    if (e.side !== mineSide || e.setNo !== cur.setNo || e.kind === 'injury') continue;
    if (e.point > cur.ptIdx) break; // subEvents는 point 오름차순 — 재생 완료분만
    if (restKind(e.kind)) { if (e.enter) slots.add(e.slot); else slots.delete(e.slot); }
  }
  for (const e of pendingSubEntries(sim, mineSide, cur, directives)) if (restKind(e.kind)) slots.add(e.slot);
  return slots.size;
}

/** 현 좌표에 유저가 지시한 작전 타임아웃이 있나(적용/미적용 무관 — 지시 자체). */
function userTimeoutAt(directives: MatchIntervention[], cur: IvCoord): boolean {
  return directives.some((d) => d.kind === 'timeout' && d.at.setNo === cur.setNo && d.at.h === cur.h && d.at.a === cur.a);
}

/** 이번 세트 사용한 내 작전 타임아웃 수(technical 제외) — 재생 완료(point≤ptIdx) + 세트 개막(0:0) 클램프 pending.
 *  ── 세트 개막 오프바이원(감사 P1) ── 엔진은 개입 TO를 `Math.max(setBaseIdx, points.length−1)`로 클램프한다(match.ts).
 *  세트 개막 0:0에서 커밋하면 point=setBaseIdx=ptIdx+1(직전 세트 마지막 ptIdx보다 1 큼)에 기록돼 `point≤ptIdx`가 못 세고
 *  스테일(toLeft가 안 줆 → 같은 좌표 재커밋 이중 소진). 교체 pending과 대칭으로 유저 TO의 클램프 좌표(ptIdx+1·같은 h/a)를 더한다. */
export function timeoutsUsed(sim: SimResult, mineSide: Side, cur: IvCoord, directives: MatchIntervention[]): number {
  const tos = sim.timeouts ?? [];
  const prefix = tos.filter((t) => t.side === mineSide && t.setNo === cur.setNo && !t.technical && t.point <= cur.ptIdx).length;
  let pending = 0;
  if (userTimeoutAt(directives, cur)) {
    pending = tos.filter((t) => t.side === mineSide && t.setNo === cur.setNo && !t.technical
      && t.point === cur.ptIdx + 1 && t.home === cur.h && t.away === cur.a).length;
  }
  return prefix + pending;
}

/** 이번 세트 잔여 개입 예산(§4) — 엔진 subBudget/timeouts와 동일 산식(예산 예약 회계 포함, P0 감사A).
 *  subLeft = SUBS_PER_SET − [재생 완료 tactical subEvent(enter+exit 각 1, injury 제외, point<=ptIdx)] − [pending enter 수]
 *            − [활성 복원형 수](각자 미래 subOut 예약분 — 엔진이 이만큼 반드시 더 쓰므로 유저 headroom에서 뺌).
 *  toLeft  = TIMEOUTS_PER_SET − [내 작전 타임아웃(technical 제외, point<=ptIdx OR pending 클램프 좌표 ptIdx+1)]. */
export function ivBudget(sim: SimResult, mineSide: Side, cur: IvCoord, directives: MatchIntervention[]): { subLeft: number; toLeft: number } {
  const prefixSub = (sim.subEvents ?? []).filter((e) =>
    e.side === mineSide && e.setNo === cur.setNo && e.kind !== 'injury' && e.point <= cur.ptIdx).length;
  const pending = pendingSubEntries(sim, mineSide, cur, directives).length;
  const reserve = activeRestorableCount(sim, mineSide, cur, directives);
  const toUsed = timeoutsUsed(sim, mineSide, cur, directives);
  return {
    subLeft: Math.max(0, SUBS_PER_SET - prefixSub - pending - reserve),
    toLeft: Math.max(0, TIMEOUTS_PER_SET - toUsed),
  };
}

/** 개입 후보 산출용 배제 집합(현 세트, 내 사이드) — 재생 완료(point<=ptIdx) + pending(유저 개입 enter) 합산.
 *  각 집합은 기존 app/match 인라인 산출과 동일 의미. injury 계열은 기존 컷오프(point<=ptIdx) 보존(유저 개입 무관 축). */
export interface IvExclusions {
  enterInIds: Set<string>;   // 이번 세트 진입한 교체선수 id(재진입 금지, usedSubIn) — benchCands.usedIn / outCands.activeSubIn
  enterOutIds: Set<string>;  // 이번 세트 교체로 나간 선발 id(타슬롯 IN 금지 F2·복귀 재이탈 금지) — benchCands.outThisSet / outCands.roundTrip / pinchBlock.roundTrip
  injuryOutIds: Set<string>; // 부상으로 나간 선수 id(복귀 불가, match-wide) — benchCands.injuredIn
  injuryReplInIds: Set<string>; // 부상 교체로 들어온 선수 id(슬롯 잠금, 세트) — outCands.injuryIn
  injurySlots: Set<number>;  // 부상 교체 슬롯 — pinchBlock
  activeSlots: Set<number>;  // 현재 활성(작전) 교체 슬롯(net enter−exit) — pinchBlock
}

export function ivExclusions(sim: SimResult, mineSide: Side, cur: IvCoord, directives: MatchIntervention[]): IvExclusions {
  const pendingInIds = new Set(pendingSubEntries(sim, mineSide, cur, directives).map((e) => e.inId));
  const enterInIds = new Set<string>();
  const enterOutIds = new Set<string>();
  const injuryOutIds = new Set<string>();
  const injuryReplInIds = new Set<string>();
  const injurySlots = new Set<number>();
  const activeSlots = new Set<number>();
  // subEvents는 point 오름차순(엔진 push 순서) — 활성 슬롯 net 계산(enter add/exit delete)이 순서 의존이라 그대로 순회.
  for (const e of sim.subEvents ?? []) {
    if (e.side !== mineSide) continue;
    if (e.kind === 'injury') {
      // injury 축은 유저 개입과 무관 → 기존 컷오프(point<=ptIdx) 보존. injuryOut은 match-wide(부상은 경기 내내), 나머지는 세트.
      if (e.point > cur.ptIdx) continue;
      if (e.enter) {
        injuryOutIds.add(e.outId);
        if (e.setNo === cur.setNo) { injuryReplInIds.add(e.inId); injurySlots.add(e.slot); }
      }
      continue;
    }
    // tactical(rest/pinch/block/def/manual) — 세트 일치 + (재생완료 point<=ptIdx OR pending 유저 enter)
    if (e.setNo !== cur.setNo) continue;
    const inScope = e.point <= cur.ptIdx || (e.point === cur.ptIdx + 1 && e.enter && pendingInIds.has(e.inId));
    if (!inScope) continue;
    if (e.enter) {
      enterInIds.add(e.inId);
      enterOutIds.add(e.outId);
      activeSlots.add(e.slot);
    } else {
      activeSlots.delete(e.slot); // 복원(OUT) — pending에는 exit 없음(현재 좌표 유저 sub은 enter만). 미래(point>ptIdx) exit는 제외.
    }
  }
  return { enterInIds, enterOutIds, injuryOutIds, injuryReplInIds, injurySlots, activeSlots };
}

/** 벤치 투입 후보(benchCands) — 내 로스터 − 리베로 − 현재코트 − 이번세트 진입/아웃/부상 − (뺄 선수와 다른 포지션).
 *  onCourt는 호출부가 준 curSix(주입 좌표까지 재생된 코트)로 판정 — 방금 투입한 선수는 curSix에 이미 들어가 자동 배제. */
export function benchCandidates(
  mySquad: Player[], curSix: Player[], byIdAll: Map<string, Player>, pendingOut: string | null, ex: IvExclusions,
): Player[] {
  const outPos = pendingOut ? (curSix.find((p) => p.id === pendingOut)?.position ?? byIdAll.get(pendingOut)?.position) : null;
  const onCourt = new Set(curSix.map((p) => p.id));
  return mySquad.filter((p) =>
    p.position !== 'L' && !onCourt.has(p.id) && !ex.enterInIds.has(p.id) && !ex.enterOutIds.has(p.id) && !ex.injuryOutIds.has(p.id)
    && (!outPos || p.position === outPos));
}

/** 코트에서 뺄 후보(outCands) — 현재코트 − 부상교체 투입자(슬롯 잠금) − 복귀선발(재이탈 금지) − 활성 교체 투입자(슬롯 재교체 금지). */
export function outCandidates(curSix: Player[], ex: IvExclusions): Player[] {
  return curSix.filter((p) => !ex.injuryReplInIds.has(p.id) && !ex.enterInIds.has(p.id) && !ex.enterOutIds.has(p.id));
}
