// 로스터 합성 (셀렉터 계층). 기본 선수 위에 단장 거래(방출·재계약)를 합성한다.
// SOLID: 순수 변환만. 스토어/엔진을 모른다(타입에만 의존).

import type { Contract, Player } from '../types';

export function effectiveContract(p: Player, overrides: Record<string, Contract>): Contract {
  return overrides[p.id] ?? p.contract;
}

/** 방출 선수 제외 + 재계약 반영한 활성 로스터 */
export function activeRoster(
  players: Player[],
  overrides: Record<string, Contract>,
  released: string[],
): Player[] {
  const out: Player[] = [];
  for (const p of players) {
    if (released.includes(p.id)) continue;
    out.push(overrides[p.id] ? { ...p, contract: overrides[p.id] } : p);
  }
  return out;
}

export function payroll(players: Player[]): number {
  return players.reduce((s, p) => s + p.contract.salary, 0);
}

/** 국내 선수만 연봉 합산 — 외인은 샐러리캡 제외(FOREIGN_SYSTEM 2장). lookup: id → Player|undefined */
export function domesticPayroll(ids: string[], lookup: (id: string) => Player | undefined): number {
  return ids.reduce((s, id) => { const p = lookup(id); return s + (p && !p.isForeign ? p.contract.salary : 0); }, 0);
}
