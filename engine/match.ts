// 세트/경기 진행 (CLAUDE.md 4.4).
// 1~4세트 25점, 5세트 15점, 모두 듀스(2점차). 5세트 3선승. 랠리포인트제.
// 매 세트 서브권 시작 팀 교대.
//
// TODO(Phase 0): playRally 루프를 돌려 한 경기를 끝까지 진행.

import type { MatchState, Side } from '../types';

export function createMatch(seed: number, firstServe: Side = 'home'): MatchState {
  return {
    seed,
    setNo: 1,
    points: { home: 0, away: 0 },
    sets: { home: 0, away: 0 },
    serving: firstServe,
    rotation: { home: 0, away: 0 },
    over: false,
  };
}

/** 해당 세트의 목표 점수 (5세트만 15) */
export function targetPoints(setNo: number): number {
  return setNo >= 5 ? 15 : 25;
}

/** 듀스 포함 세트 종료 판정 */
export function isSetOver(home: number, away: number, setNo: number): boolean {
  const target = targetPoints(setNo);
  return (home >= target || away >= target) && Math.abs(home - away) >= 2;
}

/**
 * 한 경기를 끝까지 시뮬레이션.
 * TODO(Phase 0): 세트 루프 + playRally + 로테이션/사이드아웃 반영.
 */
export function simulateMatch(_seed: number): MatchState {
  // TODO(Phase 0): createMatch → 세트 루프 → playRally → 로테이션/사이드아웃.
  throw new Error('simulateMatch not implemented yet (Phase 0)');
}
