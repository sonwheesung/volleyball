// 노쇠 곡선 (CLAUDE.md 5.1 / 6, TRAINING_SYSTEM 1.6).
// 하락은 체력·근력(피지컬 컨디셔닝)에만 — jump/staminaMax/staminaRegen.
// 민첩·반응·기술·VQ 등 "경험으로 쌓는" 스탯은 노쇠 없음(훈련으로 오히려 상승).
// 성장과 같은 숨은 XP 바를 음수로 적립: xp <= -1 → 스탯 -1 (FLOOR 까지).
// 순수 함수 + 시드 결정론.

import type { Player, TrainableStat } from '../types';
import type { Rng } from './rng';

/** 스탯이 떨어질 수 있는 하한 (완전 0 방지) */
export const FLOOR = 25;

/** 나이 들며 하락하는 스탯 = 체력·근력만 */
export const DECAY_STATS: TrainableStat[] = ['jump', 'staminaMax', 'staminaRegen'];

// 일일 노쇠량 (매 캘린더일 단위, placeholder — TRAINING_SYSTEM 1.6)
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
 * 체력·근력만 음수로 적립 → -1 도달 시 스탯 -1 (FLOOR 까지).
 */
export function applyAgingDay(p: Player, rng: Rng): Player {
  const rate = decayRate(p.age);
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
