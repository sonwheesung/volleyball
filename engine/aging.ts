// 노쇠 곡선 (CLAUDE.md 5.1 / 6, TRAINING_SYSTEM 1.6).
// 하락은 신체 스탯에만 — jump/agility/staminaMax/staminaRegen(점프·민첩·체력·체젠).
// 반응·위치선정·기술·VQ 등 "경험으로 쌓는" 스탯은 노쇠 없음(훈련으로 오히려 상승).
// 성장과 같은 숨은 XP 바를 음수로 적립: xp <= -1 → 스탯 -1 (FLOOR 까지).
// 순수 함수 + 시드 결정론.

import type { Player, TrainableStat } from '../types';
import type { Rng } from './rng';
import { agingTraitMult } from './traits';

/** 스탯이 떨어질 수 있는 하한 (완전 0 방지) */
export const FLOOR = 25;

/** 나이 들며 하락하는 신체 스탯 (CLAUDE.md 5.1: 점프·민첩·체력·체젠) */
export const DECAY_STATS: TrainableStat[] = ['jump', 'agility', 'staminaMax', 'staminaRegen'];

// 일일 노쇠 XP 적립률 (매 캘린더일, placeholder — TRAINING_SYSTEM 1.6). 바가 -1 도달 시 스탯 -1.
function decayRate(age: number): number {
  if (age <= 27) return 0;
  if (age <= 29) return 0.002;
  if (age <= 31) return 0.004;
  if (age <= 33) return 0.007;
  if (age <= 35) return 0.012;
  return 0.018;
}

/**
 * 하루치 노쇠를 선수 한 명에게 적용한 새 선수를 반환(불변).
 * 신체 스탯만 음수로 적립 → -1 도달 시 스탯 -1 (FLOOR 까지).
 */
export function applyAgingDay(p: Player, rng: Rng, ageSlow = 0): Player {
  // 체력 코치(ageSlow)가 노쇠 둔화 + 특성(대기만성 둔화/조로 가속)
  const rate = decayRate(p.age) * (1 - Math.max(0, Math.min(0.6, ageSlow))) * agingTraitMult(p.traits);
  if (rate <= 0) return p;

  const next = { ...p } as Player;
  const stats = next as unknown as Record<TrainableStat, number>;
  const xp: Partial<Record<TrainableStat, number>> = { ...p.xp };

  for (const stat of DECAY_STATS) {
    const decay = rate * rng.range(0.85, 1.15);
    const cur = stats[stat];
    if (cur <= FLOOR) continue;

    let bar = (xp[stat] ?? 0) - decay;
    let value = cur;
    while (bar <= -1 && value > FLOOR) {
      value -= 1;
      bar += 1;
    }
    if (value < cur) stats[stat] = value;
    xp[stat] = value <= FLOOR ? 0 : bar;
  }

  next.xp = xp;
  return next;
}

/** 시즌 경과: 나이 +1 (스탯 변화는 일일 틱의 training/aging 누적으로 처리) */
export function ageOneSeason(p: Player): Player {
  return { ...p, age: p.age + 1 };
}
