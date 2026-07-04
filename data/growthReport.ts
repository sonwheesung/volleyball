// 성장 리포트 — 두 날짜 사이 내 팀 종합 스탯 변화 diff (TRAINING §성장리포트, 2026-07-04).
// 엔진 무변경: deriveRatings(evolveOnDay(id, from)) vs (…, to) 순수 diff. 저장 없음(결정론 재계산).
// 카드에 보이는 6종합(정수)만 비교 → 사용자가 카드에서 보는 +1/-1과 정확히 일치(성장 체감).
import type { Ratings } from '../engine/ratings';
import { deriveRatings } from '../engine/ratings';
import { evolveOnDay, currentRosters } from './league';

export interface StatDelta { label: string; delta: number } // delta +면 성장(초록) / -면 노쇠(빨강)
export interface PlayerGrowth { id: string; name: string; deltas: StatDelta[] }

// 카드 순서와 동일한 6종합 라벨
const RATING_LABEL: [keyof Ratings, string][] = [
  ['spike', '스파이크'], ['block', '블로킹'], ['dig', '디그'],
  ['receive', '리시브'], ['set', '세팅'], ['serve', '서브'],
];

/** teamId 로스터의 [fromDay, toDay] 구간 종합 스탯 변화. 변화 없는 선수는 제외. */
export function growthReport(teamId: string, fromDay: number, toDay: number): PlayerGrowth[] {
  if (!teamId || toDay <= fromDay || fromDay < 0) return [];
  const ids = currentRosters()[teamId] ?? [];
  const out: PlayerGrowth[] = [];
  for (const id of ids) {
    const before = evolveOnDay(id, fromDay);
    const after = evolveOnDay(id, toDay);
    if (!before || !after) continue;
    const rb = deriveRatings(before), ra = deriveRatings(after);
    const deltas: StatDelta[] = [];
    for (const [k, label] of RATING_LABEL) {
      const d = ra[k] - rb[k]; // deriveRatings는 정수(Math.round) → 카드 표시값 그대로
      if (d !== 0) deltas.push({ label, delta: d });
    }
    if (deltas.length) out.push({ id, name: after.name, deltas });
  }
  return out;
}
