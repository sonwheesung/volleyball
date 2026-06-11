// 코트 라인업 구성 (MATCH_SYSTEM 1장) — 로스터에서 주전 6인(로테이션 배열) + 리베로 선발.
// 5-1 시스템: 세터 1. 슬롯 배치를 대각(세터↔아포짓, OH↔OH, MB↔MB)으로 둬
// 회전이 돌수록 전·후위 구성이 현실적으로 바뀐다(로테이션 효과의 토대).
// 순수 함수 — React 무의존.

import type { Player, Position } from '../types';
import { overall } from './overall';

export interface Lineup {
  six: Player[];          // 로테이션 슬롯 0..5: [S, OH, MB, OP, OH, MB]
  libero: Player | null;  // 후위 수비 전문(서브·전위 공격 불가)
}

function bestByPos(players: Player[], pos: Position, n: number, used: Set<string>): Player[] {
  const picked = players
    .filter((p) => p.position === pos && !used.has(p.id))
    .sort((a, b) => overall(b) - overall(a))
    .slice(0, n);
  picked.forEach((p) => used.add(p.id));
  return picked;
}

/** 로스터 → 주전 6인 로테이션 배열 + 리베로. 결손 포지션은 잔여 선수로 방어 충원.
 *  빈 로스터는 명시적 거부 — 시즌 계층(부상 상한 3·방출 하한 ROSTER_MIN)이 원천 차단해야 하는 상태. */
export function buildLineup(players: Player[]): Lineup {
  if (players.length === 0) throw new Error('빈 로스터 — 라인업을 구성할 수 없습니다(시즌 계층 가드 위반)');
  const used = new Set<string>();
  const S = bestByPos(players, 'S', 1, used);
  const OH = bestByPos(players, 'OH', 2, used);
  const MB = bestByPos(players, 'MB', 2, used);
  const OP = bestByPos(players, 'OP', 1, used);
  const libero = bestByPos(players, 'L', 1, used)[0] ?? null;

  // 대각 배치: 세터(0)↔아포짓(3), OH(1)↔OH(4), MB(2)↔MB(5)
  const slots: (Player | undefined)[] = [S[0], OH[0], MB[0], OP[0], OH[1], MB[1]];

  // 포지션 결손 시 잔여 비(非)리베로 선수로 채움
  const fallback = players.filter((p) => !used.has(p.id) && p.position !== 'L');
  let fi = 0;
  for (let i = 0; i < 6; i++) {
    if (!slots[i]) slots[i] = fallback[fi++] ?? players[i % players.length];
  }
  return { six: slots as Player[], libero };
}
