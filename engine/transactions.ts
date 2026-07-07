// 시즌 중 이동 — 순수 AI 영입 판정 (TRANSACTION_SYSTEM). 결정론.
// "포지션 구멍날 때만" 영입: healthy 가용 < 선발 필요. 캡·정원 제약.

import type { Player, Position } from '../types';
import { overall, ALL_POSITIONS } from './overall';

/** 선발 코트 필요 인원(포지션별) */
export const STARTER_NEED: Record<Position, number> = { S: 1, OH: 2, OP: 1, MB: 2, L: 1 };
/** 시즌 중 로스터 상한(영입 버퍼 — AI 방출 없이도 긴급 수혈 가능) */
export const ROSTER_MAX = 18;
/** 시즌 중 로스터 하한 — 선발 필요 7명(6인+리베로) + 동시부상 상한 3 여유.
 *  이 밑으로 방출 불가: 명단이 비어 경기 자체가 불가능해지는 상태를 원천 차단. */
export const ROSTER_MIN = 10;

/** 방출 가능 여부 — 방출 후에도 하한을 지키는가(스토어/UI 게이트용 순수 판정) */
export const canRelease = (rosterSize: number): boolean => rosterSize - 1 >= ROSTER_MIN;

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
