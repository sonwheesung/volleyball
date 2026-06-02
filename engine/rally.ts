// 랠리 체인 판정 (CLAUDE.md 4.1 / 4.2) — 1점이 나기까지의 흐름.
// 서브 → 리시브 → 세트 → 공격 ─┬ 득점 / 블로킹 차단 / 디그 성공(루프)
// 디그 성공 시 공수가 바뀌어 체인이 다시 돈다. 한 점에 2~3바퀴 가능.
//
// TODO(Phase 0): 능력치 + 확률 판정 구현. 아래는 결과 타입과 시그니처 골격.

import type { Rng } from './rng';
import type { Side } from '../types';

export type RallyEvent =
  | { type: 'serve'; side: Side; result: 'ace' | 'error' | 'inPlay' }
  | { type: 'attack'; side: Side; result: 'kill' | 'blocked' | 'dug' | 'error' }
  | { type: 'dig'; side: Side; success: boolean };

export interface RallyResult {
  winner: Side;
  events: RallyEvent[];
}

export interface RallyInput {
  serving: Side;
  // TODO: 양 팀의 현재 코트 6인 Ratings, 로테이션 등
}

/**
 * 한 랠리를 끝까지 시뮬레이션해 득점한 쪽을 반환.
 * 시드 RNG로 결정론 보장.
 */
export function playRally(_input: RallyInput, _rng: Rng): RallyResult {
  // TODO(Phase 0): 단계별 판정 흐름 구현.
  throw new Error('playRally not implemented yet (Phase 0)');
}
