// 스태프(감독·전문코치·스카우터) 순수 로직 — 분야↔훈련 매핑, 부스트·공개도·연봉·예산. React 무의존.
// 효과는 결정론. 감독 효과(성향·카리스마·훈련선호)는 기존 경기/훈련 엔진이 이미 사용.

import type { CoachSpecialty, TrainingId, AssistantCoach, Scout } from '../types';

/** 팀 스태프 총예산(만원) — 감독+코치+스카우터 연봉 합이 이내여야 함. 전부 최고를 못 갖게 빡빡하게. */
export const STAFF_BUDGET = 60000;

/** 전문 코치 분야 → 부스트 대상 훈련 id (TRAINING_SYSTEM 12종) */
export const SPECIALTY_TRAININGS: Record<CoachSpecialty, TrainingId[]> = {
  attack: [4, 5],      // 공격(스파이크)·서브
  defense: [6, 7, 8],  // 리시브·디그·블로킹
  stamina: [1, 2, 3],  // 근력·컨디셔닝·순발력
  setter: [9, 10, 11], // 세팅·콤비네이션·전술
  mental: [12],        // 멘탈/회복
};

export const SPECIALTY_KO: Record<CoachSpecialty, string> = {
  attack: '공격코치', defense: '수비코치', stamina: '체력코치', setter: '세터코치', mental: '멘탈코치',
};

/** 전문 코치 부스트 — rating 100이면 해당 분야 훈련 성장 +40% */
export const assistantBoost = (rating: number): number => 0.4 * (rating / 100);

/** 팀 보조코치들 → 훈련 id별 성장 배수(1.x). 같은 분야 중첩은 최고 1명만 반영(과적 방지). */
export function trainingBoosts(assistants: AssistantCoach[]): Partial<Record<TrainingId, number>> {
  const best: Partial<Record<CoachSpecialty, number>> = {};
  for (const a of assistants) best[a.specialty] = Math.max(best[a.specialty] ?? 0, a.rating);
  const out: Partial<Record<TrainingId, number>> = {};
  for (const sp of Object.keys(best) as CoachSpecialty[]) {
    for (const tid of SPECIALTY_TRAININGS[sp]) out[tid] = 1 + assistantBoost(best[sp]!);
  }
  return out;
}

/** 팀 스카우터들 → 드래프트 유망주 공개도 0~1. 최고 스카우터 기준 + 인원 깊이 보정. */
export function scoutReveal(scouts: Scout[]): number {
  if (!scouts.length) return 0;
  const top = Math.max(...scouts.map((s) => s.scouting));
  const depth = Math.min(0.15, (scouts.length - 1) * 0.05);
  return Math.min(1, (top / 100) * 0.85 + depth);
}

// 연봉(만원) — 역량에 비례(100원 단위 반올림). 감독 13.5k~18.5k·코치 9.5k~13.1k·스카우터 8k~11.2k 대.
export const headCoachSalary = (charisma: number): number => 8000 + Math.round((charisma * 1.1)) * 100;
export const assistantSalary = (rating: number): number => 5000 + Math.round(rating * 0.9) * 100;
export const scoutSalary = (scouting: number): number => 4000 + Math.round(scouting * 0.8) * 100;
