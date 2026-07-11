// 연봉·시장가치 산정 (SALARY_SYSTEM 2·3장). 순수 함수.
// 단위: 만원. OVR을 직접 쓰지 않고 나이·포지션·실적·외국인을 주동력으로,
// 연봉은 "서명 시점" 가치로 고착 → 현재 능력과 어긋난다.
// SOLID: 생산은 ProdLine 형태에만 의존(생산 구현 몰라도 됨).

import type { Player, Position } from '../types';
import type { Rng } from './rng';
import type { ProdLine } from './production';
import { MED_REF, overall } from './overall';
import { clampSalary, maxSalaryFor } from './cap';
import { capContractYears } from './retire';

const BASE = 24000;          // 중립 배수에서 ~2.4억

/** 재계약 협상 3택(FA_SYSTEM 2.5b·SALARY) — 시장가 일괄 대신 폭을 준다. 연수는 나이 적합(wAge): 노장에 장기계약 안 줌. */
export interface ResignOption { key: 'standard' | 'generous' | 'short'; label: string; salary: number; years: number; note: string; }
export function resignOptions(p: Player, market: number): ResignOption[] {
  const r100 = (x: number) => Math.round(x / 100) * 100;
  const cap = maxSalaryFor(p);                       // 개인 상한(프랜차이즈 11억 / 8억)
  const old = p.age >= 32, young = p.age <= 27;
  // 정년 캡: 재계약은 인시즌 결정 → 다음 시즌(age+1)부터 발효. 39세까지만(RETIRE_AGE−(age+1)). 노장 다년계약 차단.
  const cy = (y: number) => capContractYears(p.age + 1, y);
  const genYears = cy(old ? 2 : young ? 5 : 4);      // 나이 적합 — 노장 후하게도 단기
  const shortYears = cy(old ? 1 : 2);
  return [
    { key: 'standard', label: '표준', salary: Math.min(cap, r100(market)), years: cy(3), note: `시장가 · ${cy(3)}년` },
    // 카피(FA §2.5c-보완 3단계): '후하게'=엔진상 연봉 불만만 봉쇄(충성은 엔진 무관 삭제) · '짧게'=지연·조건부 불씨(즉시 불만 아님)
    { key: 'generous', label: '후하게', salary: Math.min(cap, r100(market * 1.15)), years: genYears, note: `+15% · ${genYears}년 — 연봉 불만 봉쇄·FA 늦춤(캡 부담)` },
    { key: 'short', label: '짧게', salary: Math.min(cap, r100(market * 0.85)), years: shortYears, note: `−15% · ${shortYears}년 — 싸게·다음 시즌 시장가 오르면 연봉 불만 불씨` },
  ];
}

// 재계약 오퍼 빌더(FA §2.5c-격상, 2026-07-11) — 3 프리셋을 FA식 슬라이더로. 연봉=시장가 배율 0.8×~1.3×(개인상한 클램프).
//   기본값(원탭)=표준=min(cap, r100(market))(1.0×) 그대로. 레버는 옵트인(관전형). FA offerSalaryBounds와 같은 결(배율 레인지·상한 클램프).
export const RESIGN_MULT_MIN = 0.8;
export const RESIGN_MULT_MAX = 1.3;
export const RESIGN_MULT_STEP = 0.05;
export function resignSalaryBounds(p: Player, market: number): { min: number; max: number; step: number; standard: number } {
  const r100 = (x: number) => Math.round(x / 100) * 100;
  const cap = maxSalaryFor(p);                              // 개인 상한(프랜차이즈 11억 / 8억)
  return {
    min: Math.min(cap, Math.max(MIN_SALARY, r100(market * RESIGN_MULT_MIN))),
    max: Math.min(cap, Math.max(r100(market), r100(market * RESIGN_MULT_MAX))), // 상한은 최소 시장가엔 도달(캡이 시장가보다 낮은 초거물 예외)
    step: Math.max(100, r100(market * RESIGN_MULT_STEP)),
    standard: Math.min(cap, r100(market)),                  // 원탭 기본값(표준=시장가)
  };
}

const MIN_SALARY = 3000;     // 최저 (0.3억)
const AWARD_BONUS = 0.25;    // 수상 이력 최대 프리미엄(+25%) — MVP·베스트7 누적 스타는 몸값↑(SALARY 2장)

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
//   MED_REF=72 시대 기준: raw 56→0.40 · 69→0.86 · 78→1.18 · 84→1.40 (clamp 0.35~2.0)
// 시대 보정(2026-07-02, SALARY 2장): 연봉 = 리그 내 상대 가치 — medOvr(리그 국내 중앙값) 이동만큼 앵커 평행이동.
//   절대 캡(35억=현실 KOVO 고정)과 정합하려면 연봉이 상대여야 캡 압박이 시대 불변(성장 C −11% 디플레 교훈).
function abilityMul(p: Player, medOvr: number): number {
  const ovr = overall(p) - (medOvr - MED_REF); // 시대 보정
  return Math.max(0.35, Math.min(2.0, 0.35 + (ovr - 55) / 28));
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
 * medOvr = 리그 국내 OVR 중앙값(시대 앵커, 필수 — 기본값 없음: 누락 호출부는 컴파일 에러로 드러난다.
 *   게임 전반은 data/awardSalary.marketVal(주입 컨텍스트)을 쓰고, 엔진 내부·시드는 명시 전달).
 */
export function marketValue(p: Player, medOvr: number, prod?: ProdLine, awardScore = 0): number {
  const award = 1 + AWARD_BONUS * Math.max(0, Math.min(1, awardScore)); // 통산 수상 누적 프리미엄
  const v = BASE * abilityMul(p, medOvr) * serviceFactor(p.age) * POSITION_MUL[p.position] * foreignMul(p) * perfFactor(p, prod) * award;
  return clampSalary(roundTo100(Math.max(MIN_SALARY, v)), p);
}

/**
 * 계약 연봉 — 서명 시점 나이 기준으로 고정(능력은 서명 시점 능력).
 * 루키 할인은 serviceFactor 안에서 점진(하드 캡 절벽 제거). rng 있으면 협상 난수(±).
 * medOvr = 서명 시점 리그 국내 OVR 중앙값(시드 생성은 MED_REF — 시대 0).
 */
export function computeSalary(p: Player, medOvr: number, signedAtAge: number, rng?: Rng): number {
  const noise = rng ? rng.range(0.9, 1.12) : 1.0;
  const v = BASE * abilityMul(p, medOvr) * serviceFactor(signedAtAge) * POSITION_MUL[p.position] * foreignMul(p) * noise;
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
