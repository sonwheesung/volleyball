// 유망주 생성·충원 (FA_SYSTEM 1.3). 은퇴로 빈 포지션을 신인으로 채운다.
// data 계층(seed.makePlayer 합성) — 정식 드래프트(③) 전까지 자동 배정.
// 결정론: 시즌 번호 시드.

import { createRng } from '../engine/rng';
import { makePlayer } from './seed';
import type { Player, Position } from '../types';

// 팀 포지션 이상 구성(16인) — seed ROSTER 와 동일
const IDEAL: Record<Position, number> = { S: 3, OH: 5, OP: 2, MB: 4, L: 2 };
const FILL_ORDER: Position[] = ['S', 'OH', 'OP', 'MB', 'L'];

function countByPos(players: Player[]): Record<Position, number> {
  const c: Record<Position, number> = { S: 0, OH: 0, OP: 0, MB: 0, L: 0 };
  for (const p of players) c[p.position]++;
  return c;
}

/**
 * 은퇴로 빈 자리를 신인(18~20세, 고포텐)으로 채운 새 로스터 + 신규 선수 목록.
 * registry: 현재 로스터 선수 조회. season: 새 시즌 번호(시드·id용).
 */
export function fillRosters(
  rosters: Record<string, string[]>,
  registry: (id: string) => Player | undefined,
  season: number,
): { rosters: Record<string, string[]>; newPlayers: Player[] } {
  const rng = createRng(90001 + season * 131);
  const newPlayers: Player[] = [];
  const next: Record<string, string[]> = {};
  let counter = 0;

  for (const teamId of Object.keys(rosters)) {
    const ids = [...rosters[teamId]];
    const have = countByPos(ids.map(registry).filter((p): p is Player => !!p));
    for (const pos of FILL_ORDER) {
      const need = IDEAL[pos] - have[pos];
      for (let i = 0; i < need; i++) {
        const id = `s${season}r${counter++}`;
        const rookie = makePlayer(rng, id, pos, false, rng.int(18, 20));
        newPlayers.push(rookie);
        ids.push(id);
      }
    }
    next[teamId] = ids;
  }
  return { rosters: next, newPlayers };
}
