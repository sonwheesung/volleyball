// 성장·노쇠 곡선 (CLAUDE.md 5.1 / 6, TRAINING_SYSTEM 1.6).
// 노쇠는 성장과 같은 숨은 XP 바를 부호 있게 사용한다: decay 만큼 xp를 깎아
// xp <= -1 이 되면 스탯 -1. 신체부터 빠지고, 기술은 느리게, 멘탈/VQ는 거의 유지.
// 순수 함수 + 시드 결정론. 훈련(training.ts)과 분리, 같은 일일 틱에서 함께 호출.

import type { Player, TrainableStat } from '../types';
import type { Rng } from './rng';
import { STAT_BUCKET, TRAINABLE_STATS } from './training';

/** 스탯이 떨어질 수 있는 하한 (완전 0 방지) */
export const FLOOR = 25;

// 일일 노쇠량 (훈련일/하루 단위, placeholder — TRAINING_SYSTEM 1.6)
function physicalDecay(age: number): number {
  if (age <= 27) return 0;
  if (age <= 29) return 0.004;
  if (age <= 31) return 0.008;
  if (age <= 33) return 0.014;
  if (age <= 35) return 0.022;
  return 0.032;
}
function skillDecay(age: number): number {
  if (age <= 32) return 0;
  if (age <= 35) return 0.003;
  return 0.008;
}
function mentalDecay(age: number): number {
  if (age <= 36) return 0; // 경험으로 유지
  return 0.004;
}

export function decayFor(age: number, stat: TrainableStat): number {
  switch (STAT_BUCKET[stat]) {
    case 'physical': return physicalDecay(age);
    case 'mental': return mentalDecay(age);
    default: return skillDecay(age); // skill + 공통(reaction/positioning)
  }
}

/**
 * 하루치 노쇠를 선수 한 명에게 적용한 새 선수를 반환(불변).
 * 성장과 같은 xp 바를 음수로 적립 → -1 도달 시 스탯 -1 (FLOOR 까지).
 */
export function applyAgingDay(p: Player, rng: Rng): Player {
  const next = { ...p } as Player;
  const stats = next as unknown as Record<TrainableStat, number>;
  const xp: Partial<Record<TrainableStat, number>> = { ...p.xp };

  for (const stat of TRAINABLE_STATS) {
    const decay = decayFor(p.age, stat) * rng.range(0.85, 1.15);
    if (decay <= 0) continue;
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
