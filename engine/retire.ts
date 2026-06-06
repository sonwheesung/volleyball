// 은퇴 판정 (FA_SYSTEM 1.2). 순수 함수 + 시드 결정론.
// 나이 + 능력(OVR). 노장일수록·벤치 자원(저능력)일수록 일찍 은퇴.

import type { Player } from '../types';
import type { Rng } from './rng';
import { overall } from './overall';

/** 한 시즌 종료 시 은퇴 확률(0~1) */
export function retireChance(age: number, ovr: number): number {
  if (age < 30) return 0;
  let c: number;
  if (age <= 32) c = 0.04;
  else if (age <= 34) c = 0.12;
  else if (age <= 36) c = 0.3;
  else if (age <= 38) c = 0.55;
  else c = 0.85;
  // 능력 낮으면 가속(주전 경쟁력 상실)
  c *= ovr < 62 ? 1.8 : ovr < 70 ? 1.2 : 1.0;
  // 40세 이상은 사실상 은퇴
  if (age >= 40) c = Math.max(c, 0.95);
  return Math.min(0.97, c);
}

export function retires(p: Player, rng: Rng): boolean {
  return rng.chance(retireChance(p.age, overall(p)));
}

/**
 * 롤오버 후 로스터에서 은퇴자를 제거한 새 로스터 + 은퇴자 id 목록.
 * snapshot = 나이 반영된 선수들(레지스트리). 순수.
 */
export function applyRetirements(
  rosters: Record<string, string[]>,
  snapshot: Record<string, Player>,
  rng: Rng,
): { rosters: Record<string, string[]>; retired: string[] } {
  const nextRosters: Record<string, string[]> = {};
  const retired: string[] = [];
  for (const teamId of Object.keys(rosters)) {
    const keep: string[] = [];
    for (const id of rosters[teamId]) {
      const p = snapshot[id];
      if (p && retires(p, rng)) retired.push(id);
      else keep.push(id);
    }
    nextRosters[teamId] = keep;
  }
  return { rosters: nextRosters, retired };
}
