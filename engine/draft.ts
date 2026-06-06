// 신인 드래프트 (FA_SYSTEM 3장). 순수 함수.
// 순번: 하위 팀 가중 추첨(1라운드) → 이후 라운드는 같은 순서(KOVO식 간소화).

import type { Player, Position } from '../types';
import type { Rng } from './rng';
import { overall } from './overall';
import { ROSTER_IDEAL } from './aiGM';

/**
 * 1라운드 순번 = 하위 팀 가중 추첨.
 * worstFirst: 성적 하위→상위 팀 id. 하위일수록 앞 순번 확률↑.
 */
export function lotteryRound1(worstFirst: string[], rng: Rng): string[] {
  // 가중치: 하위(앞)일수록 큼 (n, n-1, ... ,1)
  const pool = worstFirst.map((id, i) => ({ id, w: worstFirst.length - i }));
  const order: string[] = [];
  while (pool.length) {
    const total = pool.reduce((s, p) => s + p.w, 0);
    let r = rng.next() * total;
    let idx = 0;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].w;
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    order.push(pool[idx].id);
    pool.splice(idx, 1);
  }
  return order;
}

/** 팀별 빈 자리 수 (현재 로스터 vs 이상 구성) */
export function teamNeeds(rosterIds: string[], snapshot: Record<string, Player>): number {
  const total = Object.values(ROSTER_IDEAL).reduce((a, b) => a + b, 0);
  return Math.max(0, total - rosterIds.length);
}

/** 부족 포지션 (이상 대비) */
export function neededPositions(rosterIds: string[], snapshot: Record<string, Player>): Position[] {
  const have: Record<Position, number> = { S: 0, OH: 0, OP: 0, MB: 0, L: 0 };
  for (const id of rosterIds) {
    const p = snapshot[id];
    if (p) have[p.position]++;
  }
  const out: Position[] = [];
  (Object.keys(ROSTER_IDEAL) as Position[]).forEach((pos) => {
    for (let i = 0; i < ROSTER_IDEAL[pos] - have[pos]; i++) out.push(pos);
  });
  return out;
}

/** AI 지명: 필요 포지션 우선, 그 중 종합 가치(현재+포텐) 최고 */
export function aiDraftPick(
  available: Player[],
  rosterIds: string[],
  snapshot: Record<string, Player>,
): Player | null {
  if (available.length === 0) return null;
  const needs = new Set(neededPositions(rosterIds, snapshot));
  const value = (p: Player) => {
    const pot = Math.max(...Object.values(p.potential));
    return overall(p) * 0.4 + pot * 0.6; // 신인은 포텐 비중↑
  };
  const needed = available.filter((p) => needs.has(p.position));
  const pool = needed.length > 0 ? needed : available;
  return pool.slice().sort((a, b) => value(b) - value(a))[0];
}
