// 신인 드래프트 (FA_SYSTEM 3장). 순수 함수.
// 순번: 하위 팀 가중 추첨(1라운드) → 이후 라운드 동일 순서(KOVO식 간소화).
// 해석: 내 위시리스트 우선(순번 내에서) + 나머지는 AI 자동 지명.

import type { CoachStyle, Player, Position } from '../types';
import type { Rng } from './rng';
import { overall } from './overall';
import { positionGap, ROSTER_IDEAL, wantScore } from './aiGM';

type Lookup = (id: string) => Player | undefined;

/** 1라운드 순번 = 하위 팀 가중 추첨 */
export function lotteryRound1(worstFirst: string[], rng: Rng): string[] {
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

/** 전체 지명 순번(슬롯별 teamId) — 라운드 반복, 빈자리 채울 때까지 */
export function buildDraftOrder(
  round1: string[],
  holes: Record<string, number>,
  maxSlots: number,
): string[] {
  const remaining: Record<string, number> = { ...holes };
  const order: string[] = [];
  let any = true;
  while (any && order.length < maxSlots) {
    any = false;
    for (const t of round1) {
      if ((remaining[t] ?? 0) > 0 && order.length < maxSlots) {
        order.push(t);
        remaining[t]--;
        any = true;
      }
    }
  }
  return order;
}

export function neededPositions(rosterIds: string[], get: Lookup): Position[] {
  const have: Record<Position, number> = { S: 0, OH: 0, OP: 0, MB: 0, L: 0 };
  for (const id of rosterIds) {
    const p = get(id);
    if (p) have[p.position]++;
  }
  const out: Position[] = [];
  (Object.keys(ROSTER_IDEAL) as Position[]).forEach((pos) => {
    for (let i = 0; i < ROSTER_IDEAL[pos] - have[pos]; i++) out.push(pos);
  });
  return out;
}

/** 신인 종합 가치 = 현재 + 포텐(포텐 비중↑) */
export function prospectValue(p: Player): number {
  const pot = Math.max(...Object.values(p.potential));
  return overall(p) * 0.4 + pot * 0.6;
}

/** AI 지명: 팀 부족도 + 감독 성향 + 신인 가치(포텐 비중) 종합으로 "원하는 선수" 선택 */
export function aiDraftPick(
  available: Player[],
  rosterIds: string[],
  get: Lookup,
  style: CoachStyle,
): Player | null {
  if (available.length === 0) return null;
  const gap = positionGap(rosterIds, get);
  let best: Player | null = null;
  let bestScore = -1;
  for (const p of available) {
    const sc = wantScore(p, prospectValue(p), gap, style);
    if (sc > bestScore) {
      bestScore = sc;
      best = p;
    }
  }
  return best;
}

/**
 * 드래프트 해석(순수). 순번대로 진행:
 * - 내 슬롯: 위시리스트(우선순위) 중 남아있는 첫 선수, 없으면 AI 로직
 * - AI 슬롯: aiDraftPick
 * 반환: 갱신 로스터 + 지명된 선수 목록(레지스트리 추가용)
 */
export function resolveDraft(
  order: string[],
  cls: Player[],
  rostersIn: Record<string, string[]>,
  snapshotLookup: Lookup,
  myTeam: string,
  wishlist: string[],
  styleOf: (teamId: string) => CoachStyle,
): { rosters: Record<string, string[]>; picked: Player[] } {
  const rosters: Record<string, string[]> = {};
  for (const k of Object.keys(rostersIn)) rosters[k] = [...rostersIn[k]];
  const clsById = new Map(cls.map((p) => [p.id, p]));
  const get: Lookup = (id) => snapshotLookup(id) ?? clsById.get(id);

  const available = [...cls];
  const wl = [...wishlist];
  const picked: Player[] = [];

  for (const teamId of order) {
    let chosen: Player | null = null;
    if (teamId === myTeam) {
      for (const id of wl) {
        const idx = available.findIndex((a) => a.id === id);
        if (idx >= 0) {
          chosen = available[idx];
          break;
        }
      }
    }
    if (!chosen) chosen = aiDraftPick(available, rosters[teamId] ?? [], get, styleOf(teamId));
    if (!chosen) continue;
    const idx = available.findIndex((a) => a.id === chosen!.id);
    available.splice(idx, 1);
    rosters[teamId] = [...(rosters[teamId] ?? []), chosen.id];
    picked.push(chosen);
  }
  return { rosters, picked };
}
