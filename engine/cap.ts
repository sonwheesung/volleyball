// 샐러리캡·개인 상한·프랜차이즈 (FA_SYSTEM 5장). 순수 함수. 단위: 만원.

import type { Player } from '../types';

export const LEAGUE_CAP = 350000;     // 팀 총연봉 상한 (35억)
export const MAX_SALARY = 80000;      // 개인 최고연봉 (8억)
export const FRANCHISE_SEASONS = 6;   // 한 팀 연속 근속 → 프랜차이즈 스타
export const FRANCHISE_MAX = 110000;  // 프랜차이즈 개인 상한 예외 (11억)

/** 프랜차이즈 스타: 현 구단에서 오래 뛴 선수 */
export function isFranchise(p: Player): boolean {
  return (p.clubTenure ?? 0) >= FRANCHISE_SEASONS;
}

/** 그 선수에게 허용되는 개인 연봉 상한(프랜차이즈는 예외 한도) */
export function maxSalaryFor(p: Player): number {
  return isFranchise(p) ? FRANCHISE_MAX : MAX_SALARY;
}

/** 개인 상한 적용 */
export function clampSalary(salary: number, p: Player): number {
  return Math.min(salary, maxSalaryFor(p));
}

/** 팀 캡 여유 */
export function capSpace(payroll: number, cap = LEAGUE_CAP): number {
  return cap - payroll;
}

/** 영입/계약 가능 여부(프랜차이즈 재계약은 캡 예외 허용) */
export function canAfford(payroll: number, salary: number, opts?: { franchise?: boolean; cap?: number }): boolean {
  if (opts?.franchise) return true; // 프랜차이즈 재계약은 캡 초과 허용
  return payroll + salary <= (opts?.cap ?? LEAGUE_CAP);
}
