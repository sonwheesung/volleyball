// 성장 리포트 — 두 날짜 사이 내 팀 **모든 스탯(15종 원본 훈련 스탯)** 변화 diff (TRAINING §성장리포트, 2026-07-04).
// 엔진 무변경: evolveOnDay(id, from) vs (…, to)의 원본 스탯 diff. 저장 없음(결정론 재계산).
// 종합 6개(deriveRatings)는 여러 스탯의 조합이라 잘 안 바뀜 → 사용자 요청으로 밑단(점프·기술치 등)까지 전부 표시.
// 원본 스탯은 정수(XP 바가 1 채우면 +1) → 선수 상세 StatBar 표시값과 정확히 일치.
import { evolveOnDay, currentRosters } from './league';
import { overallRaw, displayOvr } from '../engine/overall';
import { planNextAction } from '../engine/advance';
import { CAMP_COURSES, CAMP_LEGACY_CUR_GAIN, type CampCourse } from '../engine/diamonds';
import type { Fixture, MatchResult } from '../types';

export interface StatDelta { label: string; delta: number; from: number; to: number } // +면 성장(초록) / -면 노쇠(빨강). from→to 이전·이후 값
/** 입단 이후 커리어 누적(있을 때만 — debut 필드 도입 후 생성 선수). OVR·스탯별 누적(전지훈련 구매분 차감 = 순수 성장). */
export interface CareerGrowth { debutOvr: number; curOvr: number; deltaOvr: number; statDeltas: StatDelta[] }
export interface PlayerGrowth { id: string; name: string; position: string; deltas: StatDelta[]; career?: CareerGrowth }

/** 전지훈련 로그 최소 형태(store CampEntry의 표시용 부분집합 — 레이어 격리 위해 로컬 정의). */
export interface CampLogLike { playerId: string; course?: CampCourse; stats?: string[]; cur?: number }

// 선수 상세(app/player/[id].tsx StatBar)와 동일 라벨·순서(신체→공통→멘탈→기술)
const STAT_ROWS: [string, string][] = [
  ['jump', '점프력'], ['agility', '민첩성'], ['staminaMax', '체력'], ['staminaRegen', '체젠'],
  ['reaction', '반응속도'], ['positioning', '위치선정'],
  ['focus', '집중력'], ['consistency', '기복'], ['vq', 'VQ'],
  ['skSpike', '공격기술'], ['skBlock', '블로킹기술'], ['skDig', '디그기술'],
  ['skReceive', '리시브기술'], ['skSet', '세팅기술'], ['skServe', '서브기술'],
];

/** 선수별 전지훈련 현재치(cur) 상승 합(스탯키별) — 커리어 누적에서 "구매분"을 빼기 위함(TRAINING §성장리포트 정정, 2026-07-11).
 *  course형: 코스 3스탯에 cur(구매 임베드 or 레거시 2) 가산 · 구 stats[]형: 지정 스탯 +1(구 개별선택 모델). */
function campCurGains(campLog: CampLogLike[], playerId: string): Record<string, number> {
  const g: Record<string, number> = {};
  for (const e of campLog) {
    if (e.playerId !== playerId) continue;
    if (e.course && CAMP_COURSES[e.course]) {
      const gain = e.cur ?? CAMP_LEGACY_CUR_GAIN;
      for (const s of CAMP_COURSES[e.course].stats) g[s] = (g[s] ?? 0) + gain;
    } else if (e.stats) {
      const gain = e.cur ?? 1; // 구 개별선택 모델(부위당 +1)
      for (const s of e.stats) g[s] = (g[s] ?? 0) + gain;
    }
  }
  return g;
}

/** teamId 로스터의 [fromDay, toDay] 구간 모든 스탯 변화. 변화 없는 선수는 제외.
 *  career(누적)는 debut→현재. campLog를 주면 전지훈련 구매분(cur)을 스탯별로 차감해 **순수(유기적) 성장**만 남긴다. */
export function growthReport(teamId: string, fromDay: number, toDay: number, campLog: CampLogLike[] = []): PlayerGrowth[] {
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
    // 입단 이후 커리어 누적(debut 있을 때만) — 보조. 전지훈련 구매분(cur)은 차감해 순수 성장만.
    let career: CareerGrowth | undefined;
    if (after.debut) {
      const curOvr = Math.round(displayOvr(overallRaw(after)));
      const camp = campCurGains(campLog, id);
      const statDeltas: StatDelta[] = [];
      for (const [k, label] of STAT_ROWS) {
        const from = after.debut.stats[k as keyof typeof after.debut.stats] ?? 0;
        const raw = (a[k] ?? 0) - from;      // 입단→현재(전지훈련 구매분 포함)
        const organic = raw - (camp[k] ?? 0); // 구매분 차감 = 순수 성장
        if (organic !== 0) statDeltas.push({ label, delta: organic, from, to: from + organic });
      }
      career = { debutOvr: after.debut.ovr, curOvr, deltaOvr: curOvr - after.debut.ovr, statDeltas };
    }
    if (deltas.length) out.push({ id, name: after.name, position: after.position, deltas, career });
  }
  return out;
}

// ── 성장 리포트 트리거 게이트 (TRAINING §성장리포트, 2026-07-08 버그수정) ──
// 문제: onAdvance가 경기 진입 직전 setDay(경기일)로 currentDay를 올리므로, 1세트만 보고
//   "이어보기"(handleResume — recordResult·setDay 안 함)로 이탈하면 그 경기 result는 미기록인데
//   currentDay는 이미 경기일 → 일정 복귀 시 currentDay>lastGrowthDay가 성립해 **미완 경기에** 성장 모달이 떴다.
// 해결(A안 — 결정론·날짜흐름 무변경, 표시 게이트만): 성장 표시·bump를 "직전 진행 경기가 실제로 완료
//   (results 기록)됐을 때"에만 한다. currentDay가 아직 안 치른 경기일에 올라가 있으면(planNextAction이
//   currentDay 이하의 미기록 경기를 반환) 그 구간은 **다음 완료 때까지 보류**(show=false·bumpTo=null).
//   경기 완료 시 recordResult는 currentDay를 안 바꾸므로 planNextAction이 더 늦은 경기(또는 seasonOver)를
//   반환 → 게이트 통과 → 보류됐던 구간 [lastGrowthDay, currentDay]가 그때 표시된다.
export interface GrowthTrigger {
  show: boolean;               // 모달을 띄울지(변화가 있고 게이트 통과)
  report: PlayerGrowth[];      // 표시할 성장 diff(show일 때만 채움)
  bumpTo: number | null;       // lastGrowthDay를 이 값으로 bump(null=보류, 건드리지 않음)
}

/** 성장 모달 트리거 판정(순수). 호출측(schedule.tsx useFocusEffect)이 결과대로 setLastGrowthDay/모달 처리. */
export function growthTrigger(
  season: Fixture[],
  teamId: string,
  results: Record<string, MatchResult>,
  lastGrowthDay: number,
  currentDay: number,
  campLog: CampLogLike[] = [],
): GrowthTrigger {
  // 미초기화(-1) → currentDay로 조용히 세팅(밀린 catch-up 폭탄 방지). 표시 없음.
  if (lastGrowthDay < 0) return { show: false, report: [], bumpTo: currentDay };
  // 새 구간 없음.
  if (currentDay <= lastGrowthDay) return { show: false, report: [], bumpTo: null };
  // 미완 경기로 진입(이어보기 이탈 등): currentDay 이하의 미기록 내 팀 경기가 남아 있으면 보류.
  //   (onAdvance는 currentDay를 항상 "다음 미치름 경기일"로 올리므로, 그 경기가 results에 없으면 아직 미완이다.)
  const pending = planNextAction(season, teamId, results);
  if (pending.kind === 'match' && pending.fixture.dayIndex <= currentDay) {
    return { show: false, report: [], bumpTo: null };
  }
  // 완료됨 → 그 구간 성장 표시 + bump.
  const report = growthReport(teamId, lastGrowthDay, currentDay, campLog);
  return { show: report.length > 0, report, bumpTo: currentDay };
}
