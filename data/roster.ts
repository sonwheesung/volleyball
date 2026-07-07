// 로스터 합성 (셀렉터 계층). 기본 선수 위에 단장 거래(방출·재계약)를 합성한다.
// SOLID: 프리미티브(effectiveContract/activeRoster/payroll/domesticPayroll)는 순수 변환(타입만 의존).
//   capPayroll(§7 캡 단일화)만 평가 모듈(marketVal·inSeasonCost)을 합성한다 — data→data/engine 정방향(순환 없음).

import type { Contract, Player } from '../types';
import { marketVal } from './awardSalary';
import { inSeasonCost } from '../engine/transactions';

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

/** 국내 선수만 연봉 합산(base) — 외인은 샐러리캡 제외(FOREIGN_SYSTEM 2장). lookup: id → Player|undefined.
 *  캡 게이트/표시는 `capPayroll`(override·시즌영입비 반영)을 쓴다 — 이건 base 연봉 원시 합 프리미티브. */
export function domesticPayroll(ids: string[], lookup: (id: string) => Player | undefined): number {
  return ids.reduce((s, id) => { const p = lookup(id); return s + (p && !p.isForeign ? p.contract.salary : 0); }, 0);
}

/** 캡에 잡히는 국내 연봉 합 — 재계약 override·시즌 중 영입비까지 단일 규칙(TRANSACTION_SYSTEM §7). 순수.
 *  · `players` = 그날 유효 로스터(진화됨, 시즌 중 영입 포함·방출 제외; 외인 포함해도 내부에서 국내만 합산).
 *  · `inSeasonSigned` = 내 팀 시즌 중 영입 선수 id 집합 → **`inSeasonCost(marketVal, betrayed)`**(취득가, 배신 웃돈 포함).
 *  · 그 외 선수 → **override 연봉이 있으면 그 값, 없으면 base `contract.salary`**(재계약 반영).
 *  · 외인은 캡 제외(FOREIGN_SYSTEM 2장). 명단 소스(정적/날짜인지)는 호출부 책임 — 여기선 평가 규칙만 단일화. */
export function capPayroll(
  players: Player[],
  overrides: Record<string, Contract>,
  inSeasonSigned: ReadonlySet<string>,
  isBetrayed: (id: string) => boolean,
): number {
  let sum = 0;
  for (const p of players) {
    if (p.isForeign) continue;
    if (inSeasonSigned.has(p.id)) sum += inSeasonCost(marketVal(p), isBetrayed(p.id));
    else sum += overrides[p.id]?.salary ?? p.contract.salary;
  }
  return sum;
}
