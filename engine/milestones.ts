// 기록 경신 마일스톤 (MILESTONE_SYSTEM). 순수 함수 — 통산 누적이 임계를 "넘는 순간"을 사건화.
// 누적 숫자(career)는 박물관 유물, 마일스톤은 그 유물이 태어나는 순간(②데이터 누적 서사).

import type { CareerStats } from '../types';

/** 통산 임계값 — 의미 있는 라운드 넘버만(노이즈 방지) */
export const CAREER_THRESHOLDS: Record<string, number[]> = {
  points: [1000, 2000, 3000, 5000, 7000, 10000, 15000],
  blocks: [300, 500, 1000, 1500, 2000, 3000],
  digs: [1000, 2000, 3000, 5000, 7000, 10000],
  aces: [200, 400, 700, 1000, 1500],
  matches: [400, 700, 1000],
};

/** 장수(롱런) 시즌 임계 */
export const SEASON_THRESHOLDS = [10, 15, 20, 25];

/** before→after 사이에 새로 넘어선 임계값들(오름차순). 같은 값이면 빈 배열 */
export function crossedThresholds(before: number, after: number, thresholds: number[]): number[] {
  if (after <= before) return [];
  return thresholds.filter((t) => before < t && after >= t);
}

/** 한 선수의 시즌 통산 임계 돌파 전부 — {stat, threshold} 목록 */
export function personalMilestones(
  before: CareerStats,
  after: CareerStats,
): { stat: string; threshold: number }[] {
  const out: { stat: string; threshold: number }[] = [];
  for (const stat of Object.keys(CAREER_THRESHOLDS)) {
    const b = (before as unknown as Record<string, number>)[stat] ?? 0;
    const a = (after as unknown as Record<string, number>)[stat] ?? 0;
    for (const t of crossedThresholds(b, a, CAREER_THRESHOLDS[stat])) out.push({ stat, threshold: t });
  }
  for (const t of crossedThresholds(before.seasons, after.seasons, SEASON_THRESHOLDS)) {
    out.push({ stat: 'seasons', threshold: t });
  }
  return out;
}

/** before→after 가 추월한 기준값들(레전드/순위 추월 감지용) — between(exclusive before, inclusive after) */
export function passedValues(before: number, after: number, marks: number[]): number[] {
  if (after <= before) return [];
  return marks.filter((m) => before < m && after >= m);
}
