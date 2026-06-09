// 시즌 롤오버 (다중 시즌 — 백년 운영). 순수 함수.
// 한 시즌치 성장/노쇠를 누적 → 나이 +1 → 계약 -1(만료 시 자동 재계약).
// 시즌 경계에서 1회 호출해 다음 시즌의 base 스냅샷을 만든다.

import type { Contract, Player, TrainingFocus } from '../types';
import { evolvePlayer } from './progression';
import { type StaffEffects, NO_EFFECTS } from './staff';
import { FIRST_FA_SEASONS } from './faMarket';
import { clampSalary } from './cap';
import { marketValue } from './salary';

export const SEASON_LENGTH = 164; // 한 시즌 캘린더 일수(진화량 기준)
const RENEW_YEARS = 2;

/** 시장가치로 재계약된 계약(자동연장·잔류). 개인 연봉 상한(프랜차이즈 예외) 적용. */
export function renewedContract(p: Player): Contract {
  return { salary: clampSalary(marketValue(p), p), years: RENEW_YEARS, remaining: RENEW_YEARS, signedAtAge: p.age };
}

/** 한 선수의 시즌 롤오버. override = 시즌 중 재계약된 계약(있으면 우선). effects = 전문 코치 효과(STAFF) */
export function rolloverPlayer(base: Player, focus: TrainingFocus, override?: Contract, effects: StaffEffects = NO_EFFECTS): Player {
  // 1) 시즌치 성장/노쇠 누적 — 전문 코치 효과(속도·포텐 상한·노쇠 지연)를 영구 반영
  const grown = evolvePlayer(base, focus, SEASON_LENGTH, effects);
  // 2) 나이 +1
  const aged: Player = { ...grown, age: grown.age + 1 };
  // 3) 경력 +1 (FA 자격 기준)
  const career = { ...aged.career, seasons: aged.career.seasons + 1 };
  // 4) 계약: 잔여 -1. 만료 시 — FA 자격자면 미계약(FA), 아니면 자동연장(영건 보유)
  const cur = override ?? aged.contract;
  const remaining = cur.remaining - 1;
  let contract: Contract;
  if (remaining > 0) contract = { ...cur, remaining };
  else if (career.seasons >= FIRST_FA_SEASONS) contract = { ...cur, remaining: 0 }; // FA 공시
  else contract = renewedContract(aged); // 영건 자동연장
  // 현 구단 근속 +1 (이적 시 store 에서 0으로 리셋)
  const clubTenure = (aged.clubTenure ?? 0) + 1;
  return { ...aged, contract, career, clubTenure };
}

/** 리그 전체 롤오버 → 다음 시즌 base 스냅샷 */
export function rolloverLeague(
  players: Player[],
  focusOf: (p: Player) => TrainingFocus,
  overrides: Record<string, Contract>,
  effectsOf?: (p: Player) => StaffEffects,
): Record<string, Player> {
  const out: Record<string, Player> = {};
  for (const p of players) out[p.id] = rolloverPlayer(p, focusOf(p), overrides[p.id], effectsOf?.(p));
  return out;
}
