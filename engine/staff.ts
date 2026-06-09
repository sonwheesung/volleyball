// 스태프(감독·전문코치·스카우터) 순수 로직 — 분야↔훈련 매핑, 부스트·공개도·연봉·예산. React 무의존.
// 효과는 결정론. 감독 효과(성향·카리스마·훈련선호)는 기존 경기/훈련 엔진이 이미 사용.

import type { CoachSpecialty, TrainingId, TrainableStat, AssistantCoach, Scout } from '../types';

/** 팀 스태프 총예산(만원) — 감독+코치+스카우터 연봉 합이 이내여야 함. 전부 최고를 못 갖게 빡빡하게. */
export const STAFF_BUDGET = 60000;
/** 팀당 전문 코치 슬롯(인원 상한) — 예산과 별개로 다양한 코치 중 선택을 강제 */
export const COACH_SLOTS = 3;

/** 전문 코치 분야 → 부스트 대상 훈련 id (TRAINING_SYSTEM 12종) */
export const SPECIALTY_TRAININGS: Record<CoachSpecialty, TrainingId[]> = {
  attack: [4, 5],      // 공격(스파이크)·서브
  defense: [6, 7, 8],  // 리시브·디그·블로킹
  stamina: [1, 2, 3],  // 근력·컨디셔닝·순발력
  setter: [9, 10, 11], // 세팅·콤비네이션·전술
  mental: [12],        // 멘탈/회복
};

/** 분야 → 효과 분류: 기량(포텐 상한↑)·체력(노쇠 지연)·멘탈(focus/consistency 상한↑) */
export type CoachEffectKind = 'skill' | 'stamina' | 'mental';
export const SPECIALTY_KIND: Record<CoachSpecialty, CoachEffectKind> = {
  attack: 'skill', defense: 'skill', setter: 'skill', stamina: 'stamina', mental: 'mental',
};
/** 기량/멘탈 코치가 숨은 포텐셜 상한을 올리는 스탯(체력 코치는 포텐 대신 노쇠 지연) */
export const SPECIALTY_POT_STATS: Record<CoachSpecialty, TrainableStat[]> = {
  attack: ['skSpike', 'skServe'],
  defense: ['skReceive', 'skDig', 'skBlock'],
  setter: ['skSet', 'vq'],
  mental: ['focus', 'consistency'],
  stamina: [],
};

export const SPECIALTY_KO: Record<CoachSpecialty, string> = {
  attack: '공격코치', defense: '수비코치', stamina: '체력코치', setter: '세터코치', mental: '멘탈코치',
};
/** 분야별 효과 한 줄 설명(UI) */
export const SPECIALTY_DESC: Record<CoachSpecialty, string> = {
  attack: '공격·서브 포텐 상한↑', defense: '리시브·디그·블록 포텐 상한↑', setter: '세팅·VQ 포텐 상한↑',
  stamina: '노쇠 지연(전성기 연장)', mental: '집중·기복 포텐 상한↑',
};

/** 전문 코치 성장속도 부스트 — rating 100이면 해당 분야 훈련 +40% */
export const assistantBoost = (rating: number): number => 0.4 * (rating / 100);
/** 기량/멘탈 코치 포텐 상한 상향 — rating 100이면 +5 */
export const potRaise = (rating: number): number => Math.round((rating / 100) * 5);
/** 체력 코치 노쇠 지연율 — rating 100이면 하락 45% 둔화 */
export const ageSlowOf = (rating: number): number => 0.45 * (rating / 100);

/** 스태프 종합 효과(승패·성장 결정론 입력) */
export interface StaffEffects {
  trainBoost: Partial<Record<TrainingId, number>>;  // 성장 속도(1.x)
  potBonus: Partial<Record<TrainableStat, number>>; // 포텐 상한 +
  ageSlow: number;                                  // 노쇠 지연 0~0.45
}
export const NO_EFFECTS: StaffEffects = { trainBoost: {}, potBonus: {}, ageSlow: 0 };

/** 팀 보조코치들 → 종합 효과. 같은 분야 중첩은 최고 1명만(과적 방지). */
export function staffEffects(assistants: AssistantCoach[]): StaffEffects {
  const best: Partial<Record<CoachSpecialty, number>> = {};
  for (const a of assistants) best[a.specialty] = Math.max(best[a.specialty] ?? 0, a.rating);
  const trainBoost: Partial<Record<TrainingId, number>> = {};
  const potBonus: Partial<Record<TrainableStat, number>> = {};
  let ageSlow = 0;
  for (const sp of Object.keys(best) as CoachSpecialty[]) {
    const r = best[sp]!;
    for (const tid of SPECIALTY_TRAININGS[sp]) trainBoost[tid] = 1 + assistantBoost(r);
    for (const st of SPECIALTY_POT_STATS[sp]) potBonus[st] = potRaise(r);
    if (sp === 'stamina') ageSlow = Math.max(ageSlow, ageSlowOf(r));
  }
  return { trainBoost, potBonus, ageSlow };
}

/** 성장 속도 부스트만(하위호환·도구용) */
export const trainingBoosts = (assistants: AssistantCoach[]): Partial<Record<TrainingId, number>> => staffEffects(assistants).trainBoost;

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
