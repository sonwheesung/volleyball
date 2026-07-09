// AI 구단 의사결정 (FA_SYSTEM 4장). 순수 함수.
// 영입/지명은 "무조건 OVR"이 아니라 팀 사정(포지션 부족도) + 감독 성향(공격/수비)으로 결정.

import type { CoachStyle, Player, Position } from '../types';
import { MED_REF, overall } from './overall';
import { TRAITS } from './traits';
import { ROSTER_FLOOR, ROSTER_FLOOR_TOTAL } from './transactions';

// 팀 포지션 이상 구성(16인) — 공용. 드래프트/FA가 floor(12)↔ideal(16) 간극을 능동 채움(FA_SYSTEM §1.6).
export const ROSTER_IDEAL: Record<Position, number> = { S: 3, OH: 5, OP: 2, MB: 4, L: 2 };

// 특급(슈퍼) 유망주 컷은 draft.ts(`SUPER_PV`·`isSuperProspect`)에 둔다 — prospectValue(현재+포텐) 기반.
//  maxPot(스탯 최대) 단독은 포화(클래스 71%가 ≥88)라 변별 불가 → 드래프트가치 상위 ~10%로 정의(FA_SYSTEM 3.1).

/** 성격 계수(드래프트 3티어 — 필요 포지션 없을 때 OVR과 함께). 멘탈(집중·기복·VQ)+특성(긍정+/부정−). ~0.85~1.15. placeholder. */
export function personalityFactor(p: Player): number {
  const mental = (p.focus + p.consistency + p.vq) / 3; // ~25..99
  let traitAdj = 0;
  for (const t of p.traits ?? []) traitAdj += TRAITS[t]?.good ? 1 : -1;
  const s = Math.max(0, Math.min(1, mental / 100 + 0.06 * traitAdj));
  return 0.85 + 0.3 * s;
}
export const ROSTER_TOTAL = Object.values(ROSTER_IDEAL).reduce((a, b) => a + b, 0);

// ── AI 로스터 크기 자율 관리(FA_SYSTEM §1.5~1.7, Phase 1.5 2026-07-09) ──
//   로스터가 상한(20)으로 팽창하지 않고 **팀 상황별 목표(12~18)** 에 앉게 — 우승권/명문=두껍게, 하위/리빌딩/신생=얇게.
//   목표는 **직전 순위(성적) 기반 = 평균회귀**(우승권이 곧 상위팀 → 두꺼움; 몰락하면 얇아짐)라 permanent 서열고착이 없다.
//   정체성은 소폭 nudge(±1, bench 1명 = 코트 무영향)로만 색을 입힌다 — parity A/B로 무회귀 확인(엔진 무파급 기둥6 유지).
export const AI_TARGET_MIN = 12; // = 포지션 floor 총합(경기 성립 하한). 어떤 팀도 이 밑을 목표하지 않음.
export const AI_TARGET_MAX = 18; // 우승권·명문 상한(두꺼운 선수층). 계약 상한 20보다 낮춰 여유(부상 수혈 버퍼).
/** AI 목표 로스터 크기 — 직전 순위(1=최고) 기반 평균회귀 + 정체성 bias(±1). rank 1-based, n=팀수.
 *  s: 최고순위 1 … 꼴찌 0. base 12 + 5·s → 12(꼴찌)~17(1위), bias로 ±1(명문/신흥 +1·약체/신생/리빌딩 −1). [12,18] 클램프. */
export function aiRosterTarget(rank: number, n: number, bias = 0): number {
  const s = n <= 1 ? 0.5 : Math.max(0, Math.min(1, 1 - (rank - 1) / (n - 1)));
  return Math.max(AI_TARGET_MIN, Math.min(AI_TARGET_MAX, Math.round(AI_TARGET_MIN + 5 * s + bias)));
}

type Lookup = (id: string) => Player | undefined;

// 감독 성향별 포지션 선호(원하는 선수 색깔)
const STYLE_WEIGHT: Record<CoachStyle, Record<Position, number>> = {
  attack: { OP: 1.3, OH: 1.15, MB: 1.1, S: 1.0, L: 0.85 },
  defense: { L: 1.3, MB: 1.15, OH: 1.1, S: 1.0, OP: 0.9 },
  balanced: { S: 1, OH: 1, OP: 1, MB: 1, L: 1 },
};
export function styleWeight(pos: Position, style: CoachStyle): number {
  return STYLE_WEIGHT[style][pos];
}

/** 포지션별 부족도(대비 target, 기본=이상 구성). 음수면 잉여 */
export function positionGap(rosterIds: string[], get: Lookup, target: Record<Position, number> = ROSTER_IDEAL): Record<Position, number> {
  const have: Record<Position, number> = { S: 0, OH: 0, OP: 0, MB: 0, L: 0 };
  for (const id of rosterIds) {
    const p = get(id);
    if (p) have[p.position]++;
  }
  return { S: target.S - have.S, OH: target.OH - have.OH, OP: target.OP - have.OP, MB: target.MB - have.MB, L: target.L - have.L };
}

/** 부족할수록 더 원함, 잉여면 거의 안 원함 */
export function needWeight(gap: number): number {
  return gap > 0 ? 1 + 0.6 * gap : 0.25;
}

/** AI가 한 후보를 얼마나 원하는지: 가치 × 부족도 × 성향 */
export function wantScore(p: Player, value: number, gap: Record<Position, number>, style: CoachStyle): number {
  return value * needWeight(gap[p.position]) * styleWeight(p.position, style);
}

/** AI가 자기 FA를 잔류시킬지(이진, 레거시) — 어리고 잘하면 잔류. ※ 절벽 컷이라 `aiRetainProb`(확률)로 대체(2026-06-25). */
export function aiKeepsFA(p: Player): boolean {
  if (p.age >= 32) return false;
  if (overall(p) < 70) return false;
  return true;
}

// 시대 상대 앵커(MED_REF·medianOvr)는 engine/overall.ts 단일 출처 — 연봉(salary)과 공유(2026-07-02).
export { MED_REF, medianOvr } from './overall';

/** AI 재계약 의향 확률(0~1, FA_SYSTEM 4) — 절벽 컷 대신 OVR·나이 연속 함수.
 *  엘리트는 노쇠에도 소프트 플로어(프랜차이즈 본능 — 32세 에이스를 칼같이 안 버림). 가끔 노장 잔류·영건 이탈 = 리그 생동.
 *  medOvr = 리그 국내 OVR 중앙값(호출부가 medianOvr로 계산) — 성장 C의 분포 하향으로 절대 앵커가 암묵 강화돼
 *  순잔류 60%→39%(24시즌)로 과이탈하던 것을 시대 보정으로 흡수(2026-07-02, "분포 이동 vs 절대 임계" 사각).
 *  aiKeepsForeign(domesticAvg+15)과 같은 상대 패턴. rng 롤은 호출부(offseason): keep = rng < aiRetainProb(p, med). */
export function aiRetainProb(p: Player, medOvr: number): number {
  const ovr = overall(p) - (medOvr - MED_REF); // 시대 보정: 리그 중앙값 이동분만큼 평행이동
  const a = p.age;
  const q = Math.max(0, Math.min(1, (ovr - 62) / 16));   // 품질 0~1: 62→0, 78→1 (MED_REF=72 시대 기준)
  const base = q * q * (3 - 2 * q);                       // smoothstep(S커브) — 양 끝 완만
  const ageMul = a <= 29 ? 1 : a <= 31 ? 0.92 : a <= 33 ? 0.74 : a <= 35 ? 0.48 : 0.26;
  let prob = base * ageMul;
  // 엘리트(에이스) 프랜차이즈 본능 — 1 쪽으로 곱셈 당김(나이 반영 유지=단조 보존, 32세 에이스 칼버림 방지)
  if (ovr >= 82) prob = prob + (1 - prob) * 0.3;
  return Math.max(0, Math.min(1, prob));
}

/**
 * AI 팀들이 FA 풀에서 팀 사정·성향에 맞춰 충원(myTeam 제외).
 * 잉여 포지션은 거의 안 뽑고, 부족 포지션 + 성향 선호를 우선.
 */
export function aiFillFromPool(
  rosters: Record<string, string[]>,
  pool: string[],
  snapshot: Record<string, Player>,
  myTeam: string,
  styleOf: (teamId: string) => CoachStyle,
): { rosters: Record<string, string[]>; remaining: string[] } {
  const remaining = [...pool];
  const next: Record<string, string[]> = {};
  const get: Lookup = (id) => snapshot[id];

  for (const teamId of Object.keys(rosters)) {
    const ids = [...rosters[teamId]];
    if (teamId !== myTeam) {
      const style = styleOf(teamId);
      // floor(12)까지만 자동 수혈 — floor↔ideal(16) 간극은 드래프트/FA로 단장(AI)이 능동 확보(FA_SYSTEM §1.6).
      while (ids.length < ROSTER_FLOOR_TOTAL && remaining.length) {
        const gap = positionGap(ids, get, ROSTER_FLOOR);
        if (!Object.values(gap).some((g) => g > 0)) break; // floor 다 채웠으면 그만
        let bestIdx = -1;
        let bestScore = -1;
        for (let i = 0; i < remaining.length; i++) {
          const p = snapshot[remaining[i]];
          if (!p) continue;
          if (gap[p.position] <= 0) continue; // floor 충족 포지션은 자동 충원 안 함
          const sc = wantScore(p, overall(p), gap, style);
          if (sc > bestScore) {
            bestScore = sc;
            bestIdx = i;
          }
        }
        if (bestIdx < 0) break;
        ids.push(remaining[bestIdx]);
        remaining.splice(bestIdx, 1);
      }
    }
    next[teamId] = ids;
  }
  return { rosters: next, remaining };
}
