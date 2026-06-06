// FA 시장 — 자격·등급·요구연봉 (FA_SYSTEM 2장). 순수 함수.
// 협상/수락·보상은 후속(2b/2c). 여기선 "누가 FA가 되고, 어느 등급이며, 얼마를 원하나".

import type { Player } from '../types';

export type FAGrade = 'A' | 'B' | 'C';

export const FIRST_FA_SEASONS = 6; // 최초 FA 자격(이후 다년 계약 만료마다 재자격)

/** FA 자격: 경력 6시즌 이상 + 계약 만료 임박(잔여 1년 이하) */
export function isFAEligible(p: Player): boolean {
  return p.career.seasons >= FIRST_FA_SEASONS && p.contract.remaining <= 1;
}

/** 이번 시즌 종료 시 FA가 될 선수(경력+1≥6, 잔여-1≤0 예정) — UI 예고용 */
export function willBeFA(p: Player): boolean {
  return p.career.seasons >= FIRST_FA_SEASONS - 1 && p.contract.remaining <= 1;
}

/** 직전 연봉 순위로 A/B/C 등급 (상위 35% A · 다음 35% B · 나머지 C) */
export function assignFAGrades(pool: Player[]): Map<string, FAGrade> {
  const sorted = [...pool].sort((a, b) => b.contract.salary - a.contract.salary);
  const n = sorted.length;
  const grades = new Map<string, FAGrade>();
  sorted.forEach((p, i) => {
    const frac = n <= 1 ? 0 : i / (n - 1);
    grades.set(p.id, frac <= 0.35 ? 'A' : frac <= 0.7 ? 'B' : 'C');
  });
  return grades;
}

const PREMIUM: Record<FAGrade, number> = { A: 1.25, B: 1.15, C: 1.1 };

/** FA 요구 연봉 = 시장가치 × 등급 프리미엄 */
export function askingPrice(market: number, grade: FAGrade): number {
  return Math.round((market * PREMIUM[grade]) / 100) * 100;
}

// ─── 선수의 오퍼 평가(수락 판정) ───
export interface OfferCtx {
  teamOvr: number;     // 영입 구단 전력
  posGap: number;      // 그 팀의 해당 포지션 부족도(출전 기회)
  isOriginal: boolean; // 원소속 구단인가
  isFranchise: boolean;// 프랜차이즈(원소속 장기근속)인가
  offerSalary: number; // 제시 연봉
  asking: number;      // 요구 연봉
  rand: number;        // 0~1 결정론 난수
}

/** 선수가 한 오퍼를 얼마나 선호하는지(높을수록 수락) */
export function offerScore(c: OfferCtx): number {
  const salaryRatio = Math.max(0.6, Math.min(1.6, c.offerSalary / Math.max(1, c.asking)));
  const strength = Math.max(0, Math.min(1.4, (c.teamOvr - 58) / 18)); // 전력 매력
  const playingTime = c.posGap > 0 ? Math.min(1, 0.4 + 0.25 * c.posGap) : 0.15; // 출전 기회
  const loyalty = c.isOriginal ? (c.isFranchise ? 1.0 : 0.5) : 0;
  return 0.35 * salaryRatio + 0.3 * strength + 0.2 * playingTime + 0.15 * loyalty + 0.05 * c.rand;
}

/** 자격 FA 목록 + 등급 (한 오프시즌 스냅샷) */
export function listFreeAgents(players: Player[]): { player: Player; grade: FAGrade }[] {
  const pool = players.filter(isFAEligible);
  const grades = assignFAGrades(pool);
  return pool.map((player) => ({ player, grade: grades.get(player.id)! }));
}
