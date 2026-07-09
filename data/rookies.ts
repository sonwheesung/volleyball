// 유망주 생성·충원 (FA_SYSTEM 1.3). 은퇴로 빈 포지션을 신인으로 채운다.
// data 계층(seed.makePlayer 합성) — 정식 드래프트(③) 전까지 자동 배정.
// 결정론: 시즌 번호 시드.

import { createRng } from '../engine/rng';
import { ROSTER_FLOOR, ROSTER_CONTRACT_CAP } from '../engine/transactions';
import { ALL_POSITIONS } from '../engine/overall';
import { makeProspect, dedupeNames } from './seed';
import type { Player, Position } from '../types';

// 자동충원 목표 = 포지션 인지 floor(S2·OH3·OP2·MB3·L2=12, FA_SYSTEM §1.6). ~~ROSTER_IDEAL(16)~~ 폐기 —
//   floor 위(12→20)는 자동으로 안 채운다(드래프트/FA로 단장이 능동 확보 → 포지션 구멍 자연 발생, 기둥4 무게).
const FLOOR = ROSTER_FLOOR;
const FILL_ORDER = ALL_POSITIONS; // 포지션 충원순(= 전 포지션 고정순) 단일 출처

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
      const need = FLOOR[pos] - have[pos];
      for (let i = 0; i < need; i++) {
        if (ids.length >= ROSTER_CONTRACT_CAP) break; // 계약 상한(20) 방어 — floor(12) 충원이 상한을 넘지 않게(정상범위 미접촉)
        const id = `s${season}r${counter++}`;
        const rookie = makeProspect(rng, id, pos);
        newPlayers.push(rookie);
        ids.push(id);
      }
    }
    next[teamId] = ids;
  }
  // 동명이인 방지 — 신인 충원 배치 내부 + taken(현 로스터 전원 이름) 회피. FOREIGN_SYSTEM §8
  const taken = Object.values(rosters).flat()
    .map(registry).filter((p): p is Player => !!p).map((p) => p.name);
  dedupeNames(newPlayers, `fill:${season}`, taken);
  return { rosters: next, newPlayers };
}
