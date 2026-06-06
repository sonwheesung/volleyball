// 시즌 롤오버 (다중 시즌 — 백년 운영). 순수 함수.
// 한 시즌치 성장/노쇠를 누적 → 나이 +1 → 계약 -1(만료 시 자동 재계약).
// 시즌 경계에서 1회 호출해 다음 시즌의 base 스냅샷을 만든다.

import type { Contract, Player, TrainingFocus } from '../types';
import { evolvePlayer } from './progression';
import { marketValue } from './salary';

export const SEASON_LENGTH = 164; // 한 시즌 캘린더 일수(진화량 기준)
const RENEW_YEARS = 2;

/** 한 선수의 시즌 롤오버. override = 시즌 중 재계약된 계약(있으면 우선) */
export function rolloverPlayer(base: Player, focus: TrainingFocus, override?: Contract): Player {
  // 1) 시즌치 성장/노쇠 누적
  const grown = evolvePlayer(base, focus, SEASON_LENGTH);
  // 2) 나이 +1
  const aged: Player = { ...grown, age: grown.age + 1 };
  // 3) 계약: 재계약 반영 → 잔여 -1 → 만료 시 시장가치로 자동 재계약(로스터 붕괴 방지)
  const cur = override ?? aged.contract;
  const remaining = cur.remaining - 1;
  const contract: Contract =
    remaining <= 0
      ? { salary: marketValue(aged), years: RENEW_YEARS, remaining: RENEW_YEARS, signedAtAge: aged.age }
      : { ...cur, remaining };
  // 경력 시즌 +1 (FA 자격 기준)
  const career = { ...aged.career, seasons: aged.career.seasons + 1 };
  return { ...aged, contract, career };
}

/** 리그 전체 롤오버 → 다음 시즌 base 스냅샷 */
export function rolloverLeague(
  players: Player[],
  focusOf: (p: Player) => TrainingFocus,
  overrides: Record<string, Contract>,
): Record<string, Player> {
  const out: Record<string, Player> = {};
  for (const p of players) out[p.id] = rolloverPlayer(p, focusOf(p), overrides[p.id]);
  return out;
}
