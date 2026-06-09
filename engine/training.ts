// 훈련·성장 엔진 (TRAINING_SYSTEM 구현). 순수 함수 + 시드 결정론.
// 훈련 1회 = 감독의 12종 가중 배분을 한 번 실행 → 코트 위 선수 스탯별 XP 적립.
// 화면 숫자는 한동안 고정되다 가끔 +1. (스탯별 숨은 XP 바 + 스탯별 포텐셜)

import type {
  Player,
  Position,
  TrainableStat,
  TrainingCategory,
  TrainingFocus,
  TrainingId,
} from '../types';
import type { Rng } from './rng';

export const BASE = 0.18; // 마스터 속도 손잡이 (TRAINING_SYSTEM 1.4) — 유망주가 20대 중반에 포텐 도달하도록 상향(2026-06)
export const POS_FLOOR = 0.24; // 포지션 인식 성장 바닥 — 감독 선호와 무관하게 포지션 핵심 스탯은 항상 성장

export const TRAINABLE_STATS: TrainableStat[] = [
  'jump', 'agility', 'staminaMax', 'staminaRegen',
  'reaction', 'positioning',
  'focus', 'consistency', 'vq',
  'skSpike', 'skBlock', 'skDig', 'skReceive', 'skSet', 'skServe',
];

/** 스탯 분야 (재능 보정·나이 곡선 선택용) */
export const STAT_BUCKET: Record<TrainableStat, TrainingCategory> = {
  jump: 'physical', agility: 'physical', staminaMax: 'physical', staminaRegen: 'physical',
  reaction: 'skill', positioning: 'skill',          // 공통 → 기술 곡선 취급
  focus: 'mental', consistency: 'mental', vq: 'mental',
  skSpike: 'skill', skBlock: 'skill', skDig: 'skill', skReceive: 'skill', skSet: 'skill', skServe: 'skill',
};

interface Training {
  id: TrainingId;
  name: string;
  primary: TrainableStat;
  secondary: TrainableStat[];
}

// TRAINING_SYSTEM 2장
export const TRAININGS: Training[] = [
  { id: 1, name: '웨이트/근력', primary: 'jump', secondary: ['skSpike'] },
  { id: 2, name: '컨디셔닝', primary: 'staminaMax', secondary: ['staminaRegen'] },
  { id: 3, name: '순발력/풋워크', primary: 'agility', secondary: ['reaction'] },
  { id: 4, name: '공격(스파이크)', primary: 'skSpike', secondary: ['positioning'] },
  { id: 5, name: '서브', primary: 'skServe', secondary: ['focus'] },
  { id: 6, name: '리시브', primary: 'skReceive', secondary: ['reaction'] },
  { id: 7, name: '디그/수비', primary: 'skDig', secondary: ['positioning'] },
  { id: 8, name: '블로킹', primary: 'skBlock', secondary: ['reaction'] },
  { id: 9, name: '세팅/토스', primary: 'skSet', secondary: ['vq'] },
  { id: 10, name: '콤비네이션', primary: 'vq', secondary: ['positioning'] },
  { id: 11, name: '전술/영상 분석', primary: 'vq', secondary: ['positioning'] },
  { id: 12, name: '멘탈/회복', primary: 'focus', secondary: ['consistency'] },
];

export const TRAINING_NAME: Record<TrainingId, string> = Object.fromEntries(
  TRAININGS.map((t) => [t.id, t.name]),
) as Record<TrainingId, string>;

// 포지션 관련성 (TRAINING_SYSTEM 2.1) — 명시 안 된 칸은 기본 1.0
const POS_REL: Partial<Record<TrainingId, Partial<Record<Position, number>>>> = {
  1: { L: 0.5 },
  3: {}, // 전 포지션 ~1
  4: { S: 0.3, L: 0.1, MB: 0.9 },
  5: { L: 0.2 },
  6: { L: 1.0, OH: 1.0, S: 0.5, MB: 0.4, OP: 0.3 },
  7: { L: 1.0, OH: 0.8, S: 0.6, MB: 0.5, OP: 0.4 },
  8: { MB: 1.0, OH: 0.6, OP: 0.6, S: 0.3, L: 0.0 },
  9: { S: 1.0, OH: 0.3, OP: 0.3, MB: 0.3, L: 0.3 },
};

export function posRelevance(id: TrainingId, pos: Position): number {
  const m = POS_REL[id];
  if (!m) return 1;
  const v = m[pos];
  return v === undefined ? 1 : v;
}

/** 감독 배분 시간 비중: 핵심 0.25 / 보조 0.12 / 나머지 0.02 */
export function coachShare(id: TrainingId, focus: TrainingFocus): number {
  if (focus.primary.includes(id)) return 0.25;
  if (focus.secondary.includes(id)) return 0.12;
  return 0.02;
}

// 나이 배수 (TRAINING_SYSTEM 1.3)
function ageMulSkill(age: number): number {
  if (age <= 18) return 1.5;
  if (age <= 21) return 1.3;
  if (age <= 24) return 1.0;
  if (age <= 27) return 0.7;
  if (age <= 30) return 0.4;
  return 0.2;
}
function ageMulPhysical(age: number): number {
  if (age <= 18) return 1.5;
  if (age <= 21) return 1.3;
  if (age <= 24) return 0.8;
  if (age <= 27) return 0.3;
  return 0;
}
export function ageMul(age: number, stat: TrainableStat): number {
  return STAT_BUCKET[stat] === 'physical' ? ageMulPhysical(age) : ageMulSkill(age);
}

export function talentFor(p: Player, stat: TrainableStat): number {
  const cat = p.catTalent[STAT_BUCKET[stat]];
  return Math.max(0.6, Math.min(1.4, p.talentBase * cat));
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * 훈련 1회를 선수 한 명에게 적용한 새 선수를 반환(불변).
 * focus = 감독의 훈련 선호. rng = 시드 RNG(결정론).
 */
export function applyTrainingDay(p: Player, focus: TrainingFocus, rng: Rng, boosts?: Partial<Record<TrainingId, number>>, potBonus?: Partial<Record<TrainableStat, number>>): Player {
  const next = { ...p } as Player;
  const stats = next as unknown as Record<TrainableStat, number>;
  const xp: Partial<Record<TrainableStat, number>> = { ...p.xp };

  const addXp = (stat: TrainableStat, effort: number) => {
    if (effort <= 0) return;
    const cur = stats[stat];
    const pot = Math.min(99, (p.potential[stat] ?? cur) + (potBonus?.[stat] ?? 0)); // 기량/멘탈 코치가 상한 +
    if (cur >= pot) return; // 상한 도달 → 성장 없음
    const head = clamp01((pot - cur) / 12);
    if (head <= 0) return;
    const gain = effort * head * talentFor(p, stat) * ageMul(p.age, stat);

    let bar = (xp[stat] ?? 0) + gain;
    let value = cur;
    while (bar >= 1 && value < pot) {
      value += 1;
      bar -= 1;
    }
    if (value > cur) stats[stat] = value;
    xp[stat] = value >= pot ? 0 : bar;
  };

  for (const t of TRAININGS) {
    const pos = posRelevance(t.id, p.position);
    if (pos <= 0) continue; // 포지션 무관(리베로 블로킹 등) → 성장 0 유지
    // 포지션 인식: 감독 선호(coachShare)와 포지션 바닥(POS_FLOOR) 중 큰 값.
    // → 포지션 핵심 스탯은 감독과 무관하게 항상 크고, 감독이 속도·부가 방향을 더한다.
    const share = Math.max(coachShare(t.id, focus), POS_FLOOR);
    const boost = boosts?.[t.id] ?? 1; // 전문 코치 부스트(STAFF_SYSTEM) — 미지정 시 1(불변)
    // 주 스탯
    addXp(t.primary, BASE * 1.0 * pos * share * boost * rng.range(0.85, 1.15));
    // 부 스탯
    for (const sec of t.secondary) {
      addXp(sec, BASE * 0.4 * pos * share * boost * rng.range(0.85, 1.15));
    }
  }

  next.xp = xp;
  return next;
}
