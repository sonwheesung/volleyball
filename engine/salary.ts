// 연봉·시장가치 산정 (SALARY_SYSTEM 2·3장). 순수 함수.
// 단위: 만원. OVR을 직접 쓰지 않고 나이·포지션·실적·외국인을 주동력으로,
// 연봉은 "서명 시점" 가치로 고착 → 현재 능력과 어긋난다.
// SOLID: 생산은 ProdLine 형태에만 의존(생산 구현 몰라도 됨).

import type { Player, Position } from '../types';
import type { Rng } from './rng';
import type { ProdLine } from './production';
import { overall } from './overall';
import { clampSalary } from './cap';

const BASE = 24000;          // 중립 배수에서 ~2.4억
const MIN_SALARY = 3000;     // 최저 (0.3억)

// 서비스 팩터 — 서명/현재 나이별 연속 곡선(루키 할인 → 전성기 시장가 → 노장 할인).
// 하드 루키캡(절벽) 제거: 22→23세 점프 없이 점진. 능력(abilityMul)이 주도하도록 진폭은 절제.
function serviceFactor(age: number): number {
  if (age <= 19) return 0.58;
  if (age <= 27) return 0.58 + (age - 19) * 0.0525; // 19→0.58 … 23→0.79 … 27→1.0 (점진, 절벽 없음)
  if (age <= 31) return 1.0 - (age - 27) * 0.04;     // 27→1.0 … 31→0.84
  return Math.max(0.5, 0.84 - (age - 31) * 0.06);
}

const POSITION_MUL: Record<Position, number> = { S: 1.12, OP: 1.18, OH: 1.05, MB: 0.92, L: 0.82 };

// 능력 배수 — 연봉이 OVR을 따라가도록 가파르게(좁은 원시 OVR 밴드를 넓게 벌림).
//   raw 56→0.40 · 69→0.86 · 78→1.18 · 84→1.40 (clamp 0.35~2.0)
function abilityMul(p: Player): number {
  return Math.max(0.35, Math.min(2.0, 0.35 + (overall(p) - 55) / 28));
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
  const v = BASE * abilityMul(p) * serviceFactor(p.age) * POSITION_MUL[p.position] * foreignMul(p) * perfFactor(p, prod);
  return clampSalary(roundTo100(Math.max(MIN_SALARY, v)), p);
}

/**
 * 계약 연봉 — 서명 시점 나이 기준으로 고정(능력은 서명 시점 능력).
 * 루키 할인은 serviceFactor 안에서 점진(하드 캡 절벽 제거). rng 있으면 협상 난수(±).
 */
export function computeSalary(p: Player, signedAtAge: number, rng?: Rng): number {
  const noise = rng ? rng.range(0.9, 1.12) : 1.0;
  const v = BASE * abilityMul(p) * serviceFactor(signedAtAge) * POSITION_MUL[p.position] * foreignMul(p) * noise;
  return clampSalary(roundTo100(Math.max(MIN_SALARY, v)), p);
}

export type ContractStatus = '저평가' | '적정' | '고평가';

/** 연봉 vs 시장가치 평가 — 자산 가치 관점(구단 운영 게임 톤). 연봉<시장=저평가(구단 이득)·연봉>시장=고평가(부담) */
export function contractStatus(salary: number, market: number): ContractStatus {
  const ratio = salary / market;
  if (ratio <= 0.8) return '저평가';
  if (ratio >= 1.25) return '고평가';
  return '적정';
}

/** 만원 → "X.X억" / "XXXX만" 표기 */
export function formatMoney(won: number): string {
  if (won >= 10000) return `${(won / 10000).toFixed(1)}억`;
  return `${won}만`;
}
