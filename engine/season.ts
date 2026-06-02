// 시즌 진행·일정 (CLAUDE.md Phase 3).
// 일정 생성 → 시즌 자동 진행 → 결과·순위·통계 누적.
//
// TODO(Phase 3): 라운드로빈 일정 생성기, 시즌 루프, 순위표.

import type { Team } from '../types';

export interface Fixture {
  round: number;
  home: string; // team id
  away: string; // team id
  seed: number;
}

/** 더블 라운드로빈 등 리그 일정 생성 (placeholder) */
export function generateSchedule(_teams: Team[], _seasonSeed: number): Fixture[] {
  // TODO(Phase 3): 모든 팀이 홈/어웨이로 맞붙는 일정 생성.
  return [];
}
