// 성장 리포트 — 두 날짜 사이 내 팀 **모든 스탯(15종 원본 훈련 스탯)** 변화 diff (TRAINING §성장리포트, 2026-07-04).
// 엔진 무변경: evolveOnDay(id, from) vs (…, to)의 원본 스탯 diff. 저장 없음(결정론 재계산).
// 종합 6개(deriveRatings)는 여러 스탯의 조합이라 잘 안 바뀜 → 사용자 요청으로 밑단(점프·기술치 등)까지 전부 표시.
// 원본 스탯은 정수(XP 바가 1 채우면 +1) → 선수 상세 StatBar 표시값과 정확히 일치.
import { evolveOnDay, currentRosters } from './league';

export interface StatDelta { label: string; delta: number } // +면 성장(초록) / -면 노쇠(빨강)
export interface PlayerGrowth { id: string; name: string; deltas: StatDelta[] }

// 선수 상세(app/player/[id].tsx StatBar)와 동일 라벨·순서(신체→공통→멘탈→기술)
const STAT_ROWS: [string, string][] = [
  ['jump', '점프력'], ['agility', '민첩성'], ['staminaMax', '체력'], ['staminaRegen', '체젠'],
  ['reaction', '반응속도'], ['positioning', '위치선정'],
  ['focus', '집중력'], ['consistency', '기복'], ['vq', 'VQ'],
  ['skSpike', '공격기술'], ['skBlock', '블로킹기술'], ['skDig', '디그기술'],
  ['skReceive', '리시브기술'], ['skSet', '세팅기술'], ['skServe', '서브기술'],
];

/** teamId 로스터의 [fromDay, toDay] 구간 모든 스탯 변화. 변화 없는 선수는 제외. */
export function growthReport(teamId: string, fromDay: number, toDay: number): PlayerGrowth[] {
  if (!teamId || toDay <= fromDay || fromDay < 0) return [];
  const ids = currentRosters()[teamId] ?? [];
  const out: PlayerGrowth[] = [];
  for (const id of ids) {
    const before = evolveOnDay(id, fromDay);
    const after = evolveOnDay(id, toDay);
    if (!before || !after) continue;
    const b = before as unknown as Record<string, number>;
    const a = after as unknown as Record<string, number>;
    const deltas: StatDelta[] = [];
    for (const [k, label] of STAT_ROWS) {
      const d = (a[k] ?? 0) - (b[k] ?? 0);
      if (d !== 0) deltas.push({ label, delta: d });
    }
    if (deltas.length) out.push({ id, name: after.name, deltas });
  }
  return out;
}
