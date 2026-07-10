// 유망주 등급 = 단장 직관 라벨 (UI_RULES DL-4 / ② UX 개선) — 순수·결정론·reveal-gated·무저장.
//
// "1라운드급/2라운드급" 같은 정답을 흘리는 숫자 라운드 등급을 폐기하고, 단장이 리포트를 보고 내리는
// **직관 판단**(어떤 종류의 자원인가)을 라벨로 준다. 순위(시장 평가)는 DL-5(draftProjection)가 담당.
//
// 두 하드룰(prospectReport 확장):
//   ① 스포일러 금지 — 숨은 maxPot·미래 스탯 절대 미참조. 입력은 **공개 재료만**:
//      fogOvr(현재)의 근거인 overall(p) + potentialEstimate(p, reveal)(reveal-gated, prospectScout).
//      reveal↓이면 potentialEstimate≈현재라 상승여지가 안 새어 자동으로 '즉시 전력감/평가 유보'로 눌린다(안개 내장).
//   ② 날조 금지 — 라벨은 값→표현 결정론 매핑뿐(성격·사연 창작 없음).
//
// 밴드 컷은 절대 컷이 아니라 **드래프트 클래스 백분위**(prospectStars 정신)로, tools/_dv_prospectgrade.ts가
// N≥10,000 클래스 누적으로 라벨 분포를 실측해 캘리브레이션한 값이다(placeholder 아님).
import type { Player } from '../types';
import { overall } from '../engine/overall';
import { potentialEstimate } from './prospectScout';

export type ProspectGrade = 'ready' | 'develop' | 'project' | 'unknown';

export const GRADE_LABEL: Record<ProspectGrade, string> = {
  ready: '즉시 전력감',
  develop: '육성 가치 높음',
  project: '장기 프로젝트',
  unknown: '평가 유보',
};

// ── 클래스 백분위로 캘리브레이션된 컷 (N=12,000명 · draftClass · 엔진 커밋 eed47f5 · 2026-07-10) ──
//   실측: 유망주는 어리다 → 현재 overall(p) 43~62(median 52), 공개 상승여지(reveal1) median 18.7(전원 upside).
//   그래서 "절대 성장치"가 아니라 **클래스 상대 밴드**로 컷. 풀공개(reveal 1.0) 라벨 분포:
//     ready 10.9% · develop 19.0% · project 36.8% · unknown 33.3% (한쪽 쏠림 없음).
//   안개 내장(reveal↓): develop 19%→5%(0.6)→0%(0.3) — 상승여지가 안 보이면 develop이 unknown/project로 눌림.
//   ready는 reveal 무관 일정(현재 강함은 fogOvr로 늘 보임 — 숨은 포텐 아님).
const CUR_HIGH = 56; // overall(p) ≥ 56 → 즉시 전력감 (현재 강함 상위 ~11%)
const CUR_LOW = 51;  // overall(p) ≤ 51 → 원석 후보(장기 프로젝트 쪽, 하위 밴드)
const GROW_BIG = 22; // 공개 상승여지 ≥ 22 → 육성 가치 높음 (reveal1 상위 ~25% upside)

/** 공개 상승여지(≥0, reveal 단조) — reveal-gated 천장 pos-avg − 무공개(현재) pos-avg. 숨은 포텐 미참조. */
export function visibleGrowth(p: Player, reveal: number): number {
  return potentialEstimate(p, reveal) - potentialEstimate(p, 0);
}

/** 단장 직관 등급(성격) — 오직 공개 재료(현재 OVR + reveal-gated 상승여지). 숨은 maxPot 절대 미참조. */
export function prospectGrade(p: Player, reveal: number): ProspectGrade {
  const cur = overall(p);              // 공개 현재 실력(fogOvr 근거)
  const grow = visibleGrowth(p, reveal); // 공개 상승여지(reveal↓ → 0으로 눌림 = 안개 내장)
  if (cur >= CUR_HIGH) return 'ready';            // 지금 당장 1군 — 천장과 무관하게 강함이 보임
  if (grow >= GROW_BIG) return 'develop';         // 공개 상승여지 큼 → 키우면 주전감
  if (cur <= CUR_LOW && grow < GROW_BIG) return 'project'; // 현재 낮음(raw) + 공개 상승여지 불확실 → 원석 베팅
  return 'unknown';                               // 판단 재료 부족(reveal 낮음·중간대) — 평가 유보
}

export function prospectGradeLabel(p: Player, reveal: number): string {
  return GRADE_LABEL[prospectGrade(p, reveal)];
}
