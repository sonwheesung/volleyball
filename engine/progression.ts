// 진화(성장+노쇠) 리플레이 — TRAINING_SYSTEM 4장.
// 선수 현재 스탯 = f(base, 감독선호, 경과일). 시드 결정론이라 저장 없이 재계산한다.
// 선수별 RNG는 id 해시로 고정 → 같은 currentDay = 같은 결과.

import type { Player, TrainingFocus } from '../types';
import { createRng, strSeed } from './rng';
import { applyTrainingDay } from './training';
import { applyAgingDay } from './aging';
import { type StaffEffects, NO_EFFECTS } from './staff';

// 선수별 RNG 시드 = id 해시(FNV-1a) — rng.strSeed와 동일 알고리즘이라 공유(한쪽만 바뀌면 결정론 깨짐)
const playerSeed = strSeed;

/** 날짜별 훈련 방침 해석기(A4, 2026-07-08) — "바꾼 날부터 적용" 타임라인용. day(0-based 경과일)의 유효 방침을 돌려준다.
 *  단일 `TrainingFocus`(상수 방침)를 주면 매일 그 방침 → 기존과 **바이트 동일**(회귀 무해). 데이터층이 세그먼트 타임라인을
 *  이 함수로 감싸 넘긴다(엔진은 "그날의 방침"만 알면 되고, 감독 기본 폴백 등 도메인은 호출부가 흡수). */
export type FocusResolver = (day: number) => TrainingFocus;
export type FocusInput = TrainingFocus | FocusResolver;

/**
 * base 선수에게 days 일치의 (훈련 성장 + 노쇠)를 적용한 새 선수.
 * 매 캘린더일 = 훈련 1회 (TRAINING_SYSTEM 4장).
 * @param focus 상수 `TrainingFocus` 또는 날짜→방침 해석기(`FocusResolver`). 해석기면 **매일 그날의 방침**으로 훈련(타임라인, A4).
 *   단일 rng 스트림을 계속 유지하므로 세그먼트 경계에서 시드가 리셋되지 않음 — 세그먼트 분할 호출 대비 결정론 안전.
 * @param skipTrainDays 훈련 생략 일수(출장정지·장기결장) — 그 일수만큼 훈련 없이 **노쇠만** 진행.
 *   → 유망주는 성장 정체, 노장은 순하락(OWNER_SYSTEM 4.6 출장정지 비용). 0이면 기존과 바이트 동일.
 */
export function evolvePlayer(base: Player, focus: FocusInput, days: number, effects: StaffEffects = NO_EFFECTS, skipTrainDays = 0): Player {
  if (days <= 0) return base;
  const rng = createRng(playerSeed(base.id));
  let p = base;
  const skip = Math.max(0, Math.min(days, Math.floor(skipTrainDays))); // 앞쪽 skip일은 훈련 생략
  const focusAt: FocusResolver = typeof focus === 'function' ? focus : () => focus; // 상수면 매일 동일 → 바이트 동일
  for (let d = 0; d < days; d++) {
    if (d >= skip) p = applyTrainingDay(p, focusAt(d), rng, effects.trainBoost, effects.potBonus, effects.boostBias); // 정지일엔 훈련 없음
    p = applyAgingDay(p, rng, effects.ageSlow); // 노쇠는 멈추지 않는다
  }
  return p;
}
