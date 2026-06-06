// "진행" 의사결정 (순수). UI와 분리 — 무엇을 할지만 결정하고 실행은 호출측이.
// SOLID: 일정에서 다음 액션을 고르는 단일 책임. 훈련/경기/생산 구현을 모른다.

import type { Fixture, MatchResult } from '../types';

export type NextAction =
  | { kind: 'match'; fixture: Fixture }
  | { kind: 'seasonOver' };

/** 내 팀의 아직 안 치른 가장 이른 경기를 다음 액션으로 */
export function planNextAction(
  season: Fixture[],
  teamId: string,
  results: Record<string, MatchResult>,
): NextAction {
  const next = season
    .filter((f) => f.homeTeamId === teamId || f.awayTeamId === teamId)
    .sort((a, b) => a.dayIndex - b.dayIndex)
    .find((f) => !results[f.id]);
  return next ? { kind: 'match', fixture: next } : { kind: 'seasonOver' };
}
