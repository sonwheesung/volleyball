// 진화(성장+노쇠) 리플레이 — TRAINING_SYSTEM 4장.
// 선수 현재 스탯 = f(base, 감독선호, 경과일). 시드 결정론이라 저장 없이 재계산한다.
// 선수별 RNG는 id 해시로 고정 → 같은 currentDay = 같은 결과.

import type { Player, TrainingFocus } from '../types';
import { createRng } from './rng';
import { applyTrainingDay } from './training';
import { applyAgingDay } from './aging';

/** 문자열 id → 32비트 시드 (FNV-1a) */
function playerSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * base 선수에게 days 일치의 (훈련 성장 + 노쇠)를 적용한 새 선수.
 * 매 캘린더일 = 훈련 1회 (TRAINING_SYSTEM 4장).
 */
export function evolvePlayer(base: Player, focus: TrainingFocus, days: number): Player {
  if (days <= 0) return base;
  const rng = createRng(playerSeed(base.id));
  let p = base;
  for (let d = 0; d < days; d++) {
    p = applyTrainingDay(p, focus, rng);
    p = applyAgingDay(p, rng);
  }
  return p;
}
