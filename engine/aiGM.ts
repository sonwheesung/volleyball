// AI 구단 의사결정 (FA_SYSTEM 4장의 최소판). 순수 함수.
// 단일 책임: 자기 FA 잔류 여부 + 풀에서 빈 포지션 충원.

import type { Player, Position } from '../types';
import { overall } from './overall';

// 팀 포지션 이상 구성(16인) — 공용
export const ROSTER_IDEAL: Record<Position, number> = { S: 3, OH: 5, OP: 2, MB: 4, L: 2 };
const FILL_ORDER: Position[] = ['S', 'OH', 'OP', 'MB', 'L'];

/** AI가 자기 FA를 잔류시킬지: 어리고 잘하면 잔류, 늙거나 약하면 풀어줌 */
export function aiKeepsFA(p: Player): boolean {
  if (p.age >= 32) return false;
  if (overall(p) < 70) return false;
  return true;
}

function countByPos(ids: string[], snapshot: Record<string, Player>): Record<Position, number> {
  const c: Record<Position, number> = { S: 0, OH: 0, OP: 0, MB: 0, L: 0 };
  for (const id of ids) {
    const p = snapshot[id];
    if (p) c[p.position]++;
  }
  return c;
}

/**
 * AI 팀들이 FA 풀에서 빈 포지션을 OVR 높은 순으로 충원. (myTeam 제외 — 인간이 먼저)
 * 순수. 변경된 rosters + 남은 풀 반환.
 */
export function aiFillFromPool(
  rosters: Record<string, string[]>,
  pool: string[],
  snapshot: Record<string, Player>,
  myTeam: string,
): { rosters: Record<string, string[]>; remaining: string[] } {
  const remaining = [...pool];
  const next: Record<string, string[]> = {};

  for (const teamId of Object.keys(rosters)) {
    const ids = [...rosters[teamId]];
    if (teamId !== myTeam) {
      const have = countByPos(ids, snapshot);
      for (const pos of FILL_ORDER) {
        let need = ROSTER_IDEAL[pos] - have[pos];
        while (need > 0) {
          // 해당 포지션 중 OVR 최고를 풀에서 선택
          let bestIdx = -1;
          let bestOvr = -1;
          for (let i = 0; i < remaining.length; i++) {
            const p = snapshot[remaining[i]];
            if (p && p.position === pos) {
              const o = overall(p);
              if (o > bestOvr) {
                bestOvr = o;
                bestIdx = i;
              }
            }
          }
          if (bestIdx < 0) break;
          ids.push(remaining[bestIdx]);
          remaining.splice(bestIdx, 1);
          need--;
        }
      }
    }
    next[teamId] = ids;
  }
  return { rosters: next, remaining };
}
