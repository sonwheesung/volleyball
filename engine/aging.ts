// 노쇠 곡선 (CLAUDE.md 5.1 / 6, TRAINING_SYSTEM 1.6).
// 하락은 신체 스탯에만 — jump/agility/staminaMax/staminaRegen(점프·민첩·체력·체젠).
// 반응·위치선정·기술·VQ 등 "경험으로 쌓는" 스탯은 노쇠 없음(훈련으로 오히려 상승).
// 성장과 같은 숨은 XP 바를 음수로 적립: xp <= -1 → 스탯 -1 (FLOOR 까지).
// 순수 함수 + 시드 결정론.

import type { Player, Position, TrainableStat } from '../types';
import type { Rng } from './rng';
import { agingTraitMult } from './traits';

/** 스탯이 떨어질 수 있는 하한 (완전 0 방지) */
export const FLOOR = 25;

/** 나이 들며 하락하는 신체 스탯 (CLAUDE.md 5.1: 점프·민첩·체력·체젠) */
export const DECAY_STATS: TrainableStat[] = ['jump', 'agility', 'staminaMax', 'staminaRegen'];

/** 포지션별 노쇠 속도 배수 (CLAUDE 5.3 "MB 신체의존↑ 전성기 짧고 노쇠 빠름" 구현, GPT 리뷰 2026-07-01).
 *  신장·점프 의존이 큰 포지션일수록 빨리, 경험형(세터·리베로)일수록 느리게. */
export const POS_DECAY: Record<Position, number> = { MB: 1.20, OP: 1.10, OH: 1.00, S: 0.85, L: 0.75 };

// 일일 노쇠 XP 적립률 — **peakAge 이후 경과연수(d) 기준**(peakAge를 실제 사용: 포지션별 전성기 시점 반영,
// GPT 리뷰 2026-07-01). 바가 -1 도달 시 스탯 -1. (구: 나이 27 고정 onset → peakAge 상대로 교체)
function decayRate(age: number, peakAge: number): number {
  const d = age - peakAge; // 전성기 지난 햇수
  if (d <= 0) return 0;
  if (d <= 2) return 0.003;   // Fix③(2026-07-01): 신체 하락 ~1.5× 상향 — 노장 OVR 체감 확보(측정 튜닝)
  if (d <= 4) return 0.006;
  if (d <= 6) return 0.011;
  if (d <= 8) return 0.018;
  return 0.028;
}

/**
 * 하루치 노쇠를 선수 한 명에게 적용한 새 선수를 반환(불변).
 * 신체 스탯만 음수로 적립 → -1 도달 시 스탯 -1 (FLOOR 까지).
 */
export function applyAgingDay(p: Player, rng: Rng, ageSlow = 0): Player {
  // 체력 코치(ageSlow)가 노쇠 둔화 + 특성(대기만성 둔화/짧은전성기 가속) + 포지션 배수(MB 빠름·L 느림)
  const rate = decayRate(p.age, p.peakAge) * POS_DECAY[p.position] * (1 - Math.max(0, Math.min(0.6, ageSlow))) * agingTraitMult(p.traits);
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
