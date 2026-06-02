// 시드 기반 결정론적 RNG (mulberry32).
// 같은 시드 => 같은 난수열 => 같은 경기 결과. 리플레이·검증 가능.
// React/Expo 의존성 0. 순수 함수.

export interface Rng {
  /** [0, 1) 실수 */
  next(): number;
  /** [min, max) 실수 */
  range(min: number, max: number): number;
  /** [min, max] 정수 */
  int(min: number, max: number): number;
  /** p 확률로 true (p: 0..1) */
  chance(p: number): boolean;
  /** 현재 내부 상태(직렬화/세이브용) */
  state(): number;
}

/**
 * mulberry32 — 빠르고 통계적으로 충분한 32비트 PRNG.
 * @param seed 32비트 정수 시드
 */
export function createRng(seed: number): Rng {
  let s = seed >>> 0;

  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    chance: (p) => next() < p,
    state: () => s >>> 0,
  };
}
