// 성장·노쇠 곡선 (CLAUDE.md 5.1 / 6 / Phase 6).
// 신체 스탯은 전성기(peakAge) 후 하락. 기술치는 더 오래 유지.
// 미들블로커는 신체 의존 최고 → 전성기 짧고 노쇠 빠름.
//
// TODO(Phase 6): 나이→배수 곡선으로 시즌마다 스탯 갱신.

import type { Player } from '../types';

/**
 * 한 시즌 경과에 따른 선수 스탯 갱신본을 반환 (불변).
 * TODO(Phase 6): 신체 노쇠 + 기술 성장/유지 + 경험치 반영.
 */
export function ageOneSeason(p: Player): Player {
  return { ...p, age: p.age + 1 };
}
