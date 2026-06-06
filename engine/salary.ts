// 연봉·시장가치 산정 (SALARY_SYSTEM 2·3장). 순수 함수.
// 단위: 만원. OVR을 직접 쓰지 않고 나이·포지션·실적·외국인을 주동력으로,
// 연봉은 "서명 시점" 가치로 고착 → 현재 능력과 어긋난다.
// SOLID: 생산은 ProdLine 형태에만 의존(생산 구현 몰라도 됨).

import type { Player, Position } from '../types';
import type { Rng } from './rng';
import type { ProdLine } from './production';
import { overall } from './overall';
import { clampSalary } from './cap';

const BASE = 28000;          // 중립 배수에서 ~2.8억
const MIN_SALARY = 3000;     // 최저 (0.3억)
const ROOKIE_CAP = 6000;     // 루키스케일 상한 (0.6억)

// 수입 곡선 — 전성기에 피크, 신인/노장은 낮음
function ageEarnMul(age: number): number {
  if (age <= 21) return 0.45;
  if (age <= 23) return 0.7;
  if (age <= 29) return 1.0;
  if (age <= 31) return 0.82;
  if (age <= 33) return 0.62;
  return 0.42;
}

const POSITION_MUL: Record<Position, number> = { S: 1.12, OP: 1.18, OH: 1.05, MB: 0.92, L: 0.82 };

function abilityMul(p: Player): number {
  return Math.max(0.4, Math.min(1.6, 0.5 + (overall(p) - 55) / 45));
}

function foreignMul(p: Player): number {
  return p.isForeign ? 1.6 : 1.0;
}

const roundTo100 = (won: number) => Math.round(won / 100) * 100;

/** 실적 보정 (생산 있으면 ±, 없으면 1.0) — 포지션별 지표 정규화 */
function perfFactor(p: Player, prod?: ProdLine): number {
  if (!prod || prod.matches < 3) return 1.0;
  const pm = prod.matches;
  let raw: number;
  if (p.position === 'S') raw = prod.assists / pm / 22;
  else if (p.position === 'L') raw = prod.digs / pm / 18;
  else raw = prod.points / pm / 16;
  return 0.8 + 0.5 * Math.max(0, Math.min(1, raw));
}

/**
 * 시장가치 — 지금 새로 계약하면 받을 값(현재 나이 기준).
 * 재계약/FA·표시용. prod 있으면 실적 반영.
 */
export function marketValue(p: Player, prod?: ProdLine): number {
  const v = BASE * abilityMul(p) * ageEarnMul(p.age) * POSITION_MUL[p.position] * foreignMul(p) * perfFactor(p, prod);
  return clampSalary(roundTo100(Math.max(MIN_SALARY, v)), p);
}

/**
 * 계약 연봉 — 서명 시점 나이 기준으로 고정. 루키스케일 적용.
 * rng 가 있으면 협상 난수(±).
 */
export function computeSalary(p: Player, signedAtAge: number, rng?: Rng): number {
  const noise = rng ? rng.range(0.9, 1.12) : 1.0;
  let v = BASE * abilityMul(p) * ageEarnMul(signedAtAge) * POSITION_MUL[p.position] * foreignMul(p) * noise;
  // 루키스케일: 어린 나이에 서명한 신인은 상한
  if (signedAtAge <= 22) v = Math.min(v, ROOKIE_CAP);
  return clampSalary(roundTo100(Math.max(MIN_SALARY, v)), p);
}

export type ContractStatus = '꿀계약' | '적정' | '고연봉';

/** 연봉 vs 시장가치 평가 */
export function contractStatus(salary: number, market: number): ContractStatus {
  const ratio = salary / market;
  if (ratio <= 0.8) return '꿀계약';
  if (ratio >= 1.25) return '고연봉';
  return '적정';
}

/** 만원 → "X.X억" / "XXXX만" 표기 */
export function formatMoney(won: number): string {
  if (won >= 10000) return `${(won / 10000).toFixed(1)}억`;
  return `${won}만`;
}
