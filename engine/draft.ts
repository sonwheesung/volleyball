// 신인 드래프트 (FA_SYSTEM 3장). 순수 함수.
// 순번: 하위 팀 가중 추첨(1라운드) → 이후 라운드 동일 순서(KOVO식 간소화).
// 해석: 내 위시리스트 우선(순번 내에서) + 나머지는 AI 자동 지명.

import type { CoachStyle, Player, Position } from '../types';
import { type Rng, strSeed } from './rng';
import { overall } from './overall';
import { positionGap, ROSTER_IDEAL, needWeight, styleWeight, personalityFactor } from './aiGM';

/** 한 AI 픽의 사유 — wish(인간 위시) / super(특급 BPA) / need(부족 포지션) / best(필요없음→OVR+성격) */
export type PickReason = 'wish' | 'super' | 'need' | 'best';

type Lookup = (id: string) => Player | undefined;

/** 스카우팅 평가 노이즈 — 공개도(reveal) 낮을수록 유망주 가치 오판↑. 결정론(id+팀 해시). */
const SCOUT_NOISE = 0.2;
const hash01 = (s: string): number => (strSeed(s) % 100000) / 100000;
function scoutMult(playerId: string, teamId: string, reveal: number): number {
  if (reveal >= 1) return 1;
  return 1 + (hash01(`${playerId}:${teamId}`) * 2 - 1) * SCOUT_NOISE * (1 - reveal);
}

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

/** 특급(슈퍼) 유망주 컷 — 드래프트가치 ≥ 81(클래스 상위 ~10%, 측정 보정). 이상이면 포지션 무관 BPA(FA_SYSTEM 3.1).
 *  maxPot 단독(클래스 71%가 ≥88)은 변별 불가라 prospectValue(현재+포텐 0.6)로 정의. */
export const SUPER_PV = 81;
export const isSuperProspect = (p: Player): boolean => prospectValue(p) >= SUPER_PV;

/** 유망주 별 등급 — 드래프트가치(prospectValue) 기준(측정 보정): ★★★ 상위~11%(특급)·★★ ~33%·★ ~56%·· 그 외.
 *  구 maxPot 기준(★★★ 71% 포화)을 대체 — 별이 실제 희소도를 반영. */
export function prospectStars(p: Player): string {
  const v = prospectValue(p);
  return v >= SUPER_PV ? '★★★' : v >= 78 ? '★★' : v >= 75 ? '★' : '·';
}

function bestBy(arr: Player[], score: (p: Player) => number): Player {
  let best = arr[0];
  let bs = -Infinity;
  for (const p of arr) { const s = score(p); if (s > bs) { bs = s; best = p; } }
  return best;
}

/**
 * AI 픽(3티어, 사유 포함 — FA_SYSTEM 3.1):
 *  1) 슈퍼 유망주(prospectValue≥81=SUPER_PV) 있으면 포지션 무관 BPA(reason=super)
 *  2) 없으면 부족 포지션(gap>0)만 보고 가치×부족도×성향(reason=need)
 *  3) 부족 포지션 없으면 OVR×성격×성향(reason=best)
 */
export function pickWithReason(
  available: Player[],
  rosterIds: string[],
  get: Lookup,
  style: CoachStyle,
  teamId = '',
  reveal = 1,
): { player: Player; reason: PickReason } | null {
  if (available.length === 0) return null;
  const gap = positionGap(rosterIds, get);
  const styleScout = (p: Player) => styleWeight(p.position, style) * scoutMult(p.id, teamId, reveal);
  // 1) 특급 유망주 — 포지션 무관 베스트(BPA)
  const supers = available.filter(isSuperProspect);
  if (supers.length) return { player: bestBy(supers, (p) => prospectValue(p) * styleScout(p)), reason: 'super' };
  // 2) 부족 포지션 우선 — 잉여 포지션은 보지 않음(aiFillFromPool과 동일 정책)
  const needed = available.filter((p) => gap[p.position] > 0);
  if (needed.length) return { player: bestBy(needed, (p) => prospectValue(p) * needWeight(gap[p.position]) * styleScout(p)), reason: 'need' };
  // 3) 부족 없음 — 현재 실력(OVR) + 성격
  return { player: bestBy(available, (p) => overall(p) * personalityFactor(p) * styleScout(p)), reason: 'best' };
}

/** AI 지명(사유 없이 선수만) — 기존 호출부 호환. 내부는 3티어 pickWithReason. */
export function aiDraftPick(
  available: Player[],
  rosterIds: string[],
  get: Lookup,
  style: CoachStyle,
  teamId = '',
  reveal = 1, // 스카우팅 공개도(1=정밀, 낮을수록 오판)
): Player | null {
  return pickWithReason(available, rosterIds, get, style, teamId, reveal)?.player ?? null;
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
  revealOf: (teamId: string) => number = () => 1, // 팀 스카우팅 공개도(기본 1=정밀)
): { rosters: Record<string, string[]>; picked: Player[]; sequence: { teamId: string; playerId: string; reason: PickReason }[] } {
  const rosters: Record<string, string[]> = {};
  for (const k of Object.keys(rostersIn)) rosters[k] = [...rostersIn[k]];
  const clsById = new Map(cls.map((p) => [p.id, p]));
  const get: Lookup = (id) => snapshotLookup(id) ?? clsById.get(id);

  const available = [...cls];
  const wl = [...wishlist];
  const picked: Player[] = [];
  const sequence: { teamId: string; playerId: string; reason: PickReason }[] = [];

  for (const teamId of order) {
    let chosen: Player | null = null;
    let reason: PickReason = 'best';
    if (teamId === myTeam) {
      for (const id of wl) {
        const idx = available.findIndex((a) => a.id === id);
        if (idx >= 0) { chosen = available[idx]; reason = 'wish'; break; }
      }
    }
    if (!chosen) {
      const r = pickWithReason(available, rosters[teamId] ?? [], get, styleOf(teamId), teamId, revealOf(teamId));
      if (r) { chosen = r.player; reason = r.reason; }
    }
    if (!chosen) continue;
    const idx = available.findIndex((a) => a.id === chosen!.id);
    available.splice(idx, 1);
    rosters[teamId] = [...(rosters[teamId] ?? []), chosen.id];
    picked.push(chosen);
    sequence.push({ teamId, playerId: chosen.id, reason });
  }
  return { rosters, picked, sequence };
}
