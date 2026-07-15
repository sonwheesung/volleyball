// FA 보상 (FA_SYSTEM 2.3). 순수 함수.
// A/B 등급 FA 영입 시 원소속팀이 영입팀의 비보호 선수 1명을 보상선수로 지명.

import type { Player } from '../types';
import type { FAGrade } from './faMarket';
import { overall } from './overall';

export const PROTECT_COUNT = 6; // 보호선수 명단 인원

/** 보상선수가 필요한 등급(A·B). C는 보상 없음 */
export function needsCompensationPlayer(grade: FAGrade): boolean {
  return grade === 'A' || grade === 'B';
}

/** 등급별 보상금(직전 연봉 배수) — 보상선수 동반 시 */
export function compensationMoney(grade: FAGrade, salary: number): number {
  const mult = grade === 'A' ? 2.0 : grade === 'B' ? 1.0 : 0;
  return Math.round((salary * mult) / 100) * 100;
}

/** '돈만' 보상(보상선수 면제) 배수 — 선수단 보호 대가로 더 큰 보상금. A 3.0× · B 2.0×.
 *  (보상선수 동반 A 2.0×/B 1.0×보다 1배 더. 캡 외 운영 자금에서만 지불 — 부자 구단의 레버)
 *  UI 표시(%)는 이 상수에서 파생(Math.round(x*100)) — 리터럴 하드코딩 금지(UI_RULES UV-11). */
export const MONEY_ONLY_MULT: Record<'A' | 'B', number> = { A: 3.0, B: 2.0 };

export function compensationMoneyOnly(grade: FAGrade, salary: number): number {
  const mult = grade === 'A' ? MONEY_ONLY_MULT.A : grade === 'B' ? MONEY_ONLY_MULT.B : 0;
  return Math.round((salary * mult) / 100) * 100;
}

/**
 * 원소속팀이 가져갈 보상선수 = 영입팀 비보호 선수 중 가치 최고.
 * protectedIds·alreadyTaken·exclude 제외. 없으면 null.
 */
export function pickCompensation(
  signingRosterIds: string[],
  protectedIds: string[],
  snapshot: Record<string, Player>,
  exclude: string[],
): string | null {
  const skip = new Set([...protectedIds, ...exclude]);
  let best: string | null = null;
  let bestVal = -1;
  for (const id of signingRosterIds) {
    if (skip.has(id)) continue;
    const p = snapshot[id];
    if (!p) continue;
    if (p.isForeign) continue; // 외국인은 보상선수 대상 불가 — 1년 트라이아웃 계약·팀당 1명 슬롯(FOREIGN_SYSTEM). 넘기면 받는 팀이 외인 2명이 된다
    const v = overall(p);
    if (v > bestVal) {
      bestVal = v;
      best = id;
    }
  }
  return best;
}
