// 성장 리포트 — 두 날짜 사이 내 팀 **모든 스탯(15종 원본 훈련 스탯)** 변화 diff (TRAINING §성장리포트, 2026-07-04).
// 엔진 무변경: evolveOnDay(id, from) vs (…, to)의 원본 스탯 diff. 저장 없음(결정론 재계산).
// 종합 6개(deriveRatings)는 여러 스탯의 조합이라 잘 안 바뀜 → 사용자 요청으로 밑단(점프·기술치 등)까지 전부 표시.
// 원본 스탯은 정수(XP 바가 1 채우면 +1) → 선수 상세 StatBar 표시값과 정확히 일치.
import { evolveOnDay, currentRosters } from './league';
import { overallRaw, displayOvr } from '../engine/overall';

export interface StatDelta { label: string; delta: number; from: number; to: number } // +면 성장(초록) / -면 노쇠(빨강). from→to 이전·이후 값
/** 입단 이후 커리어 누적(있을 때만 — debut 필드 도입 후 생성 선수). OVR·스탯별 누적. */
export interface CareerGrowth { debutOvr: number; curOvr: number; deltaOvr: number; statDeltas: StatDelta[] }
export interface PlayerGrowth { id: string; name: string; position: string; deltas: StatDelta[]; career?: CareerGrowth }

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
      const from = a[k] != null && b[k] != null ? b[k] : 0;
      const to = a[k] ?? 0;
      const d = to - from;
      if (d !== 0) deltas.push({ label, delta: d, from, to });
    }
    // 입단 이후 커리어 누적(debut 있을 때만) — "내가 이 선수를 이렇게 키웠다"의 주인공
    let career: CareerGrowth | undefined;
    if (after.debut) {
      const curOvr = Math.round(displayOvr(overallRaw(after)));
      const statDeltas: StatDelta[] = [];
      for (const [k, label] of STAT_ROWS) {
        const from = after.debut.stats[k as keyof typeof after.debut.stats] ?? 0;
        const to = a[k] ?? 0;
        const d = to - from;
        if (d !== 0) statDeltas.push({ label, delta: d, from, to });
      }
      career = { debutOvr: after.debut.ovr, curOvr, deltaOvr: curOvr - after.debut.ovr, statDeltas };
    }
    if (deltas.length) out.push({ id, name: after.name, position: after.position, deltas, career });
  }
  return out;
}
