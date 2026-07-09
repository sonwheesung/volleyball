// 시즌 중 이동 — 순수 AI 영입 판정 (TRANSACTION_SYSTEM). 결정론.
// "포지션 구멍날 때만" 영입: healthy 가용 < 선발 필요. 캡·정원 제약.

import type { Player, Position } from '../types';
import { overall, ALL_POSITIONS } from './overall';

/** 선발 코트 필요 인원(포지션별) */
export const STARTER_NEED: Record<Position, number> = { S: 1, OH: 2, OP: 1, MB: 2, L: 1 };

/** 계약 보유 상한(하드캡, FA_SYSTEM §1.5) — 재계약·FA·시즌중 영입은 이 초과면 불가.
 *  ROSTER_MAX(구 18)를 대체하는 새 상한. **드래프트만 예외**(지명은 임시 초과 허용, 다음 오프시즌 자연 정리). */
export const ROSTER_CONTRACT_CAP = 20;
/** 하위호환 별칭 — 기존 호출부(pickSigning·store 시즌중 영입 게이트)가 참조. 값=계약 상한 20. */
export const ROSTER_MAX = ROSTER_CONTRACT_CAP;

/** 포지션 인지 floor(FA_SYSTEM §1.6) — 자동충원 목표·방출 하한의 단일 출처.
 *  S2·OH3·OP2·MB3·L2(합 12) = 주전 1세트 + 부상 1명 흡수 여유. 이 위(12→20)는 자동으로 안 채운다(단장 몫). */
export const ROSTER_FLOOR: Record<Position, number> = { S: 2, OH: 3, OP: 2, MB: 3, L: 2 };
export const ROSTER_FLOOR_TOTAL = Object.values(ROSTER_FLOOR).reduce((a, b) => a + b, 0); // 12

/** 시즌 중 로스터 하한 — 선발 필요 7명(6인+리베로) + 동시부상 상한 3 여유(하위호환 최소 총원).
 *  포지션 인지 방출 게이트(canReleasePosition)가 정본이나, 총원 방어값으로도 유지. */
export const ROSTER_MIN = 10;

/** 방출 가능 여부(총원만 — 하위호환). 포지션 인지 게이트는 canReleasePosition 사용. */
export const canRelease = (rosterSize: number): boolean => rosterSize - 1 >= ROSTER_MIN;

/** 방출 가능 여부(포지션 인지, FA_SYSTEM §1.6) — 방출 후 그 포지션이 floor 미만이 되면 차단('세터 0명' 방지).
 *  buildLineup throw-guard와 같은 결(경기 성립 불가 사전 차단). roster=현 유효 국내 명단, releasedId=방출 대상. */
export function canReleasePosition(roster: Player[], releasedId: string): boolean {
  const target = roster.find((p) => p.id === releasedId);
  if (!target) return false;
  if (target.isForeign) return false; // 외인 방출은 상류에서 이미 차단(여긴 국내 방출만)
  const pos = target.position;
  // floor 카운트는 전 선수(외인 포함) — positionGap/fillRosters와 동일 회계(OP는 외인이 채우는 자리라 총량 기준).
  const after = roster.filter((p) => p.position === pos && p.id !== releasedId).length;
  return after >= ROSTER_FLOOR[pos];
}

/** 배신 웃돈 — 같은 시즌 내 "내가 방출한 선수"를 다시 부르는 값.
 *  방출당한 선수는 배신감이 남는다: 당일 철회(unrelease)는 무료(실수 정정)지만,
 *  그 이후 FA 시장 재영입은 몸값 ×1.5 — 갈 곳 없으면 돌아오긴 하는데, 마음 달랠 돈은 받는다. */
export const BETRAYAL_PREMIUM = 1.5;
export const inSeasonCost = (market: number, betrayed: boolean): number =>
  Math.round(market * (betrayed ? BETRAYAL_PREMIUM : 1));

/** 방출 위약금 — 잔여 보장액(연봉×잔여연수)의 일부를 정산금으로 지불(TRANSACTION_SYSTEM 0.5①).
 *  방출에 "재정 무게"를 줘 정 없이 떨구지 못하게. 장기계약을 막 자르면 더 아프다. RATE는 placeholder(튜닝 대상). */
export const SEVERANCE_RATE = 0.4;
export const severanceFee = (salary: number, remaining: number): number =>
  Math.max(0, Math.round(salary * Math.max(1, remaining) * SEVERANCE_RATE));

export function healthyByPos(players: Player[]): Record<Position, number> {
  const c: Record<Position, number> = { S: 0, OH: 0, OP: 0, MB: 0, L: 0 };
  for (const p of players) c[p.position]++;
  return c;
}

/** 구멍난 포지션(가용 < 필요) — 부족폭 큰 순, 동률은 포지션 고정순 */
export function shortagePositions(healthy: Record<Position, number>): Position[] {
  const order = ALL_POSITIONS; // 포지션 고정순(S·OH·OP·MB·L) 단일 출처
  return order
    .filter((p) => healthy[p] < STARTER_NEED[p])
    .sort((a, b) => (STARTER_NEED[b] - healthy[b]) - (STARTER_NEED[a] - healthy[a]) || order.indexOf(a) - order.indexOf(b));
}

/** FA 풀에서 포지션 pos 최고 OVR 영입 후보(캡·정원 통과). 동률은 id 사전순. */
export function pickSigning(
  pos: Position,
  faPool: Player[],
  rosterSize: number,
  payroll: number,
  salaryOf: (p: Player) => number,
  cap: number,
): Player | null {
  if (rosterSize >= ROSTER_MAX) return null;
  const cands = faPool
    .filter((p) => p.position === pos && payroll + salaryOf(p) <= cap)
    .sort((a, b) => overall(b) - overall(a) || (a.id < b.id ? -1 : 1));
  return cands[0] ?? null;
}
