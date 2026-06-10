// 부상 (INJURY_SYSTEM). 순수 확률 모델 — 발생/심각도 1차 함수.
// ★ 결정론·격리 원칙: 부상은 simMatch 안에 넣지 않는다. "그날 출전 가능 명단"을
//   결정론으로 깎는 시즌 계층(data/injury.ts)에서 소비한다 → 엔진 골든 테스트 보존.

import type { Rng } from './rng';
import type { Trait } from '../types';
import { injuryTraitMult } from './traits';

export const INJURY_BASE = 0.009;   // 선발 1인·1경기 기저 부상 확률
export const CONCURRENT_CAP = 3;    // 팀 동시 부상 상한(뎁스 붕괴·라인업 파탄 방지)

/** 부상 확률(0~) — 나이↑·체력↓·유리몸↑. 경미 위주가 되도록 낮게. */
export function injuryRisk(age: number, staminaMax: number, traits?: Trait[]): number {
  const ageF = age <= 25 ? 0.8 : age <= 29 ? 1 : age <= 32 ? 1.4 : 2;
  const stamF = Math.max(0.7, Math.min(1.6, 1 + (60 - staminaMax) / 100));
  return Math.min(0.06, INJURY_BASE * ageF * stamF * injuryTraitMult(traits));
}

export type Severity = 'minor' | 'moderate' | 'major' | 'season';
export interface Injury { missMatches: number; severity: Severity; }

export const SEVERITY_KO: Record<Severity, string> = {
  minor: '경미', moderate: '중기', major: '중상', season: '시즌아웃',
};

/** 심각도/결장 경기 수 — 경미(1~2) 대부분, 중상·시즌아웃은 드물게 */
export function rollSeverity(rng: Rng): Injury {
  const r = rng.next();
  if (r < 0.65) return { missMatches: 1 + rng.int(0, 1), severity: 'minor' };
  if (r < 0.90) return { missMatches: 3 + rng.int(0, 3), severity: 'moderate' };
  if (r < 0.985) return { missMatches: 7 + rng.int(0, 8), severity: 'major' };
  return { missMatches: 99, severity: 'season' };
}
