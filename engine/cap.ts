// 샐러리캡·개인 상한·프랜차이즈 (FA_SYSTEM 5장). 순수 함수. 단위: 만원.

import type { Player } from '../types';
import { overallRaw } from './overall';

export const LEAGUE_CAP = 350000;     // 팀 총연봉 상한 (35억)
export const MAX_SALARY = 80000;      // 개인 최고연봉 (8억)
export const FRANCHISE_SEASONS = 6;   // 프랜차이즈 최소 근속(현 구단 연속 시즌)
export const FRANCHISE_OVR = 74;      // 프랜차이즈 최소 기량(연속 OVR ≈ 표시 86+) — "스타"의 문턱
export const FRANCHISE_MAX = 110000;  // 프랜차이즈 개인 상한 예외 (11억)

/**
 * 프랜차이즈 스타 = **현 구단 장기 근속 + 스타급 기량** 을 모두 만족하는 선수.
 * 근속만 보면(과거 정의) 시드 clubTenure=나이−19 탓에 25세↑ 전원이 프랜차이즈가 돼(측정: 59%)
 * "프랜차이즈"가 무의미해졌다. 근속 + 기량을 함께 봐야 구단의 "간판 스타"가 된다(측정: ~7%).
 * 캡 예외(FRANCHISE_MAX·재계약 캡 면제)도 진짜 간판에게만 적용돼 의미가 산다.
 */
export function isFranchise(p: Player): boolean {
  // 외국인은 제외 — 용병은 매 시즌 트라이아웃으로 교체되는 단기 자원이라 "구단의 간판"이 아니다.
  return !p.isForeign && (p.clubTenure ?? 0) >= FRANCHISE_SEASONS && overallRaw(p) >= FRANCHISE_OVR;
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
