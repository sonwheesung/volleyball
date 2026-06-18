// 수상 → 연봉 프리미엄 (SALARY 2장). 가벼운 컨텍스트 모듈 — data/league 무의존(순환 import 방지).
// 스토어가 archive 변화 시 setAwardScores 로 주입(setTxContext/setOwnerContext 패턴) → marketVal 이
// UI·AI·오프시즌 어디서든 같은 프리미엄을 적용한다(전역 일관).

import type { Player, SeasonAwards } from '../types';
import { marketValue } from '../engine/salary';
import type { ProdLine } from '../engine/production';

type AwardsArchive = { season: number; awards?: SeasonAwards }[];

// 통산 수상을 가중 합산 → 0~1. MVP가 가장 무겁고 라운드MVP는 가볍게. ~3 MVP급이면 만점.
export function awardSalaryScore(archive: AwardsArchive, playerId: string): number {
  let s = 0;
  for (const a of archive) {
    const w = a.awards; if (!w) continue;
    if (w.mvp?.playerId === playerId) s += 1.0;
    if (w.finalsMvp?.playerId === playerId) s += 0.7;
    if (w.rookie?.playerId === playerId) s += 0.3;
    if (w.mostImproved?.playerId === playerId) s += 0.3;
    for (const t of Object.values(w.titles)) if (t?.playerId === playerId) s += 0.4;
    if (w.best7.some((b) => b.winner?.playerId === playerId)) s += 0.5;
    s += 0.12 * w.roundMvps.filter((m) => m?.playerId === playerId).length;
  }
  return Math.max(0, Math.min(1, s / 3));
}

let awardScoreMap = new Map<string, number>();
export function setAwardScores(archive: AwardsArchive): void {
  const ids = new Set<string>();
  for (const a of archive) {
    const w = a.awards; if (!w) continue;
    for (const id of [w.mvp?.playerId, w.finalsMvp?.playerId, w.rookie?.playerId, w.mostImproved?.playerId]) if (id) ids.add(id);
    for (const t of Object.values(w.titles)) if (t?.playerId) ids.add(t.playerId);
    for (const b of w.best7) if (b.winner?.playerId) ids.add(b.winner.playerId);
    for (const m of w.roundMvps) if (m?.playerId) ids.add(m.playerId);
  }
  const next = new Map<string, number>();
  for (const id of ids) next.set(id, awardSalaryScore(archive, id));
  awardScoreMap = next;
}
export const awardScoreOf = (id: string): number => awardScoreMap.get(id) ?? 0;

/** 시장가치(수상 프리미엄 반영) — 게임 전반에서 marketValue 대신 사용. */
export function marketVal(p: Player, prod?: ProdLine): number {
  return marketValue(p, prod, awardScoreOf(p.id));
}
