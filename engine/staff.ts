// 스태프(감독·전문코치·스카우터) 순수 로직 — 분야↔훈련 매핑, 부스트·공개도·연봉·예산. React 무의존.
// 효과는 결정론. 감독 효과(성향·카리스마·훈련선호)는 기존 경기/훈련 엔진이 이미 사용.

import type { CoachSpecialty, CoachType, TrainingId, TrainableStat, AssistantCoach, Scout } from '../types';
import { strSeed } from './rng';

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

// ── 성향(type) 체계 (STAFF_SYSTEM §8.1) ──
/** 분야별 가능한 성향(같은 rating도 효과 벡터가 다름 — 스칼라 지배 방지) */
export const SPECIALTY_TYPES: Record<CoachSpecialty, CoachType[]> = {
  attack: ['developer', 'winnow', 'finisher'],
  defense: ['developer', 'winnow', 'finisher'],
  setter: ['developer', 'winnow', 'finisher'],
  stamina: ['antiaging', 'recovery'],
  mental: ['stable', 'clutch'],
};
export const TYPE_KO: Record<CoachType, string> = {
  developer: '육성형', winnow: '즉전형', finisher: '완성형', antiaging: '노쇠억제형', recovery: '회복특화형', stable: '안정형', clutch: '클러치형',
};
export const TYPE_DESC: Record<CoachType, string> = {
  developer: '어린 선수 성장 가속(전성기 전)', winnow: '주전·베테랑 성장 가속(전성기 이후에도)', finisher: '포텐 상한 극대(완성도↑)',
  antiaging: '노쇠 크게 지연(전성기 연장)', recovery: '체력 훈련 가속(노쇠 지연은 약함)', stable: '기복(consistency) 상한↑', clutch: '집중(clutch/focus) 상한↑',
};
/** 구세이브(type=undefined) 호환 — 분야 기본 성향(옛 flat 동작에 가장 가까운 것). */
export const DEFAULT_TYPE: Record<CoachSpecialty, CoachType> = {
  attack: 'finisher', defense: 'finisher', setter: 'finisher', stamina: 'antiaging', mental: 'stable',
};
/** 코치 성향 결정론 배정 — id 시드(메인 rng 불간섭, 분야별 균등). 신규 코치 생성 시 부여.
 *  NO_COACHTYPE env면 undefined(레거시 flat) 반환 — 밸런스 A/B 베이스라인용. */
export function coachTypeFor(id: string, specialty: CoachSpecialty): CoachType | undefined {
  if (typeof process !== 'undefined' && process.env && process.env.NO_COACHTYPE) return undefined;
  const types = SPECIALTY_TYPES[specialty];
  return types[strSeed(`ctype:${id}`) % types.length];
}

// ── 감독 능력 3축 (스태프 3.0 §9.1) — 기존 단일 charisma를 세 축으로 분해 ──
//   ① matchOps(경기 운영) = 구 charisma 값 이관(엔진 등가, 생성식이 별도 주입).
//   ② dvPhilosophy(육성 철학) · ③ leadership(리더십) = **id 시드 파생**(메인 rng 불간섭 — coachTypeFor 패턴 §8.1 ①b).
//   Phase A는 엔진 훅 없이 생성·표시·영속만(훅은 Phase D). 유형 라벨은 **저장 안 함** — 3축 프로필에서 파생(§9.1).
export type HeadType3 = 'competitive' | 'developmental' | 'organizational'; // 승부형/육성형/조직관리형
export const HEAD_TYPE3_KO: Record<HeadType3, string> = {
  competitive: '승부형', developmental: '육성형', organizational: '조직관리형',
};
const clamp01 = (n: number): number => (n < 0 ? 0 : n > 100 ? 100 : n);

/** 감독 유형 아키타입 — id 시드 파생(생성 시 신규 2축의 **범위 방향만** 결정, 저장 안 함 §9.1). */
export function headArchetypeOf(id: string): HeadType3 {
  const arr: HeadType3[] = ['competitive', 'developmental', 'organizational'];
  return arr[strSeed(`harch3:${id}`) % arr.length];
}

/** 신규 2축(육성 철학·리더십) 생성 — id 시드 파생(메인 rng 불간섭·결정론·랜덤 없음).
 *  matchOps(=구 charisma)는 생성식이 별도 주입. 아키타입이 편향 방향만 정한다(같은 유형도 전 수치 상이). */
export function deriveHeadAxes(id: string): { dvPhilosophy: number; leadership: number } {
  const arch = headArchetypeOf(id);
  const base = (salt: string) => 45 + (strSeed(`${salt}:${id}`) % 46); // 45~90
  let dv = base('dvphil');
  let ld = base('lead');
  if (arch === 'competitive') { dv = clamp01(dv - 10); ld = clamp01(ld - 10); }       // 경기 운영 편향(신규 2축 낮춰 matchOps가 상대적 우위)
  else if (arch === 'developmental') dv = clamp01(dv + 15);                            // 육성 철학 편향
  else ld = clamp01(ld + 15);                                                          // 리더십 편향
  return { dvPhilosophy: dv, leadership: ld };
}

/** 감독 OVR — 3축 종합(명성 불포함 §9.1, 표시용). */
export function headOvr(c: { matchOps: number; dvPhilosophy: number; leadership: number }): number {
  return Math.round((c.matchOps + c.dvPhilosophy + c.leadership) / 3);
}

/** 파생 유형 라벨 — 3축 프로필의 최고 축(저장 안 함 §9.1). 동점은 matchOps>dvPhilosophy>leadership 순. */
export function headType3(c: { matchOps: number; dvPhilosophy: number; leadership: number }): HeadType3 {
  if (c.matchOps >= c.dvPhilosophy && c.matchOps >= c.leadership) return 'competitive';
  if (c.dvPhilosophy >= c.leadership) return 'developmental';
  return 'organizational';
}

/** 스태프 종합 효과(승패·성장 결정론 입력) */
export interface StaffEffects {
  trainBoost: Partial<Record<TrainingId, number>>;              // 성장 속도(1.x)
  boostBias?: Partial<Record<TrainingId, 'young' | 'prime'>>;   // 육성/즉전 나이 타깃(applyTrainingDay가 p.age·peakAge로 해석)
  potBonus: Partial<Record<TrainableStat, number>>;             // 포텐 상한 +
  ageSlow: number;                                             // 노쇠 지연. flat 최대 0.45(rating100), antiaging ×1.4→이론상 0.63이나 aging.ts:39가 Math.min(0.6)로 캡(rating≥96에서만 절단, 현 rating상한 95라 실효 ≈0.5985). STAFF_SYSTEM §1·§8.1.
}
export const NO_EFFECTS: StaffEffects = { trainBoost: {}, boostBias: {}, potBonus: {}, ageSlow: 0 };

/** 팀 보조코치들 → 종합 효과. 같은 분야 중첩은 최고 1명만(과적 방지). 성향(type)이 효과 벡터를 재분배(총량 유지). */
export function staffEffects(assistants: AssistantCoach[]): StaffEffects {
  // 분야별 최고 rating 코치 1명 선정(그 코치의 성향을 적용)
  const bestBysp: Partial<Record<CoachSpecialty, AssistantCoach>> = {};
  for (const a of assistants) { const cur = bestBysp[a.specialty]; if (!cur || a.rating > cur.rating) bestBysp[a.specialty] = a; }
  const trainBoost: Partial<Record<TrainingId, number>> = {};
  const boostBias: Partial<Record<TrainingId, 'young' | 'prime'>> = {};
  const potBonus: Partial<Record<TrainableStat, number>> = {};
  let ageSlow = 0;
  for (const sp of Object.keys(bestBysp) as CoachSpecialty[]) {
    const a = bestBysp[sp]!;
    const r = a.rating;
    const b = assistantBoost(r), p = potRaise(r);
    // 구세이브(type=undefined) → 옛 flat 동작 그대로 보존(save-compat·회귀 무변). 성향은 신규 코치부터.
    if (a.type === undefined) {
      for (const tid of SPECIALTY_TRAININGS[sp]) trainBoost[tid] = 1 + b;
      for (const st of SPECIALTY_POT_STATS[sp]) potBonus[st] = p;
      if (sp === 'stamina') ageSlow = Math.max(ageSlow, ageSlowOf(r));
      continue;
    }
    const setBoost = (mult: number, bias?: 'young' | 'prime') => {
      for (const tid of SPECIALTY_TRAININGS[sp]) { trainBoost[tid] = 1 + b * mult; if (bias) boostBias[tid] = bias; }
    };
    const setPot = (mult: number) => { for (const st of SPECIALTY_POT_STATS[sp]) potBonus[st] = Math.round(p * mult); };
    switch (a.type) {
      case 'developer': setBoost(1, 'young'); setPot(0.7); break;
      case 'winnow': setBoost(1, 'prime'); setPot(0.7); break;
      case 'finisher': setBoost(0.7); setPot(1.6); break; // 천장↑ 대신 성장속도↓ 트레이드(레거시보다 strictly 강하지 않게 — 밸런스 중립)
      case 'antiaging': setBoost(0.6); ageSlow = Math.max(ageSlow, ageSlowOf(r) * 1.4); break;
      case 'recovery': setBoost(1.4); ageSlow = Math.max(ageSlow, ageSlowOf(r) * 0.6); break;
      case 'stable': potBonus.consistency = Math.round(p * 1.6); potBonus.focus = Math.round(p * 0.4); break;
      case 'clutch': potBonus.focus = Math.round(p * 1.6); potBonus.consistency = Math.round(p * 0.4); break;
    }
  }
  return { trainBoost, boostBias, potBonus, ageSlow };
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

// 연봉(만원) — 역량에 비례(100원 단위 반올림). 실생성 스탯 범위 기준: 감독 13.0k~18.6k·코치 9.7k~13.6k(playerToCoach 95)·
// 스카우터 7.6k~11.4k (구 "13.5k~18.5k…" 표기는 스테일 — 발견 모드 2차 정정 2026-07-15, STAFF §2 정본).
/** 감독 연봉 = 능력(3축 OVR) 기반 base + 명성 프리미엄(상한 캡, 대체 금지 §9.4). reputation 0이면 base만.
 *  base는 구 matchOps 단일 → **3축 OVR**로 승격(Phase B) — ovr≈matchOps 대역(3축 평균)이라 범위 대체로 보존. */
export const headCoachSalary = (ovr: number, reputation = 0): number =>
  8000 + Math.round(ovr * 1.1) * 100 + Math.round(0.4 * (reputation < 0 ? 0 : reputation > 100 ? 100 : reputation)) * 100;
export const assistantSalary = (rating: number): number => 5000 + Math.round(rating * 0.9) * 100;
export const scoutSalary = (scouting: number): number => 4000 + Math.round(scouting * 0.8) * 100;
