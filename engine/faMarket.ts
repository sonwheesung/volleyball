// FA 시장 — 자격·등급·요구연봉 (FA_SYSTEM 2장). 순수 함수.
// 협상/수락·보상은 후속(2b/2c). 여기선 "누가 FA가 되고, 어느 등급이며, 얼마를 원하나".

import type { FAArchetype, FAPref, FAWeights, Player } from '../types';
import type { Rng } from './rng';

export type FAGrade = 'A' | 'B' | 'C';

// ─── FA 성향 프로필 (선수마다 다른 이적 동기) ───

/** 아키타입별 기준 가중치(합 1.0). 한 동기를 크게, 나머지는 옅게. */
// rel(인간관계) — 은은하게(사용자 결정). 충성·연고형이 동료를 좀 더 중시. 정규화로 합 1.
// rel(인간관계) — 은은하게(사용자 결정). 충성·연고형이 동료를 좀 더 중시. 정규화로 합 1.
// (parity 보호: 친구 연쇄가 컨텐더에 몰리는 집중을 줄이려 가중을 작게 — 2026-06-26 측정 튜닝)
const ARCH_BASE: Record<FAArchetype, FAWeights> = {
  money:    { money: 0.55, win: 0.15, loyalty: 0.05, play: 0.15, home: 0.10, rel: 0.02 },
  winnow:   { money: 0.20, win: 0.42, loyalty: 0.13, play: 0.15, home: 0.10, rel: 0.02 },
  loyal:    { money: 0.15, win: 0.10, loyalty: 0.55, play: 0.10, home: 0.10, rel: 0.04 },
  minutes:  { money: 0.20, win: 0.10, loyalty: 0.05, play: 0.55, home: 0.10, rel: 0.02 },
  hometown: { money: 0.20, win: 0.15, loyalty: 0.10, play: 0.10, home: 0.45, rel: 0.04 },
};

/** 리그 평균에 가까운 기본 가중치(faPref 없는 선수 폴백) */
export const DEFAULT_FA_WEIGHTS: FAWeights = { money: 0.4, win: 0.3, loyalty: 0.15, play: 0.1, home: 0.05, rel: 0.03 };

// allowHometown=false(외국인): 연고(hometown)는 V리그 연고 개념이 없어 부여 안 함 → 나머지 4개로 재분배.
function rollArchetype(r: number, allowHometown = true): FAArchetype {
  if (!allowHometown) {            // 외국인 — hometown 제외(10%를 4개에 비례 재분배)
    if (r < 0.38) return 'money';
    if (r < 0.56) return 'winnow';
    if (r < 0.84) return 'loyal';
    return 'minutes';
  }
  if (r < 0.34) return 'money';   // 34% 머니
  if (r < 0.50) return 'winnow';  // 16% 윈나우 (부익부 억제 위해 축소)
  if (r < 0.76) return 'loyal';   // 26% 충성 (parity 위해 확대)
  if (r < 0.90) return 'minutes'; // 14% 출전
  return 'hometown';              // 10% 연고
}

/** 선수 1명의 FA 성향(결정론). teamCount 로 선호팀 1곳 지정.
 *  isForeign: 외국인/아시아쿼터는 연고(hometown) 성향·선호팀 없음(V리그 연고 개념 없음 — EC-DOM-01). 국내는 기존 그대로(결정론 보존). */
export function rollFAPref(rng: Rng, teamCount: number, isForeign = false): FAPref {
  const archetype = rollArchetype(rng.next(), !isForeign);
  const base = ARCH_BASE[archetype];
  const keys: (keyof FAWeights)[] = ['money', 'win', 'loyalty', 'play', 'home', 'rel'];
  const noisy = {} as FAWeights;
  let sum = 0;
  for (const k of keys) { const v = Math.max(0, (base[k] ?? 0) + (rng.next() - 0.5) * 0.1); noisy[k] = v; sum += v; }
  const w = {} as FAWeights;
  for (const k of keys) w[k] = (noisy[k] ?? 0) / (sum || 1);
  const preferredTeamId = (!isForeign && teamCount > 0) ? `t${rng.int(0, teamCount - 1)}` : undefined;
  return { archetype, w, preferredTeamId };
}

/** 선수의 동기 가중치(없으면 기본) */
export function prefWeightsOf(p: Player): FAWeights {
  return p.faPref?.w ?? DEFAULT_FA_WEIGHTS;
}

export const FIRST_FA_SEASONS = 6; // 최초 FA 자격(이후 다년 계약 만료마다 재자격)

/** FA 자격: 경력 6시즌 이상 + 계약 만료 임박(잔여 1년 이하). 외인은 비대상(트라이아웃 전용) */
export function isFAEligible(p: Player): boolean {
  return !p.isForeign && p.career.seasons >= FIRST_FA_SEASONS && p.contract.remaining <= 1;
}

/** 이번 시즌 종료 시 FA가 될 선수(경력+1≥6, 잔여-1≤0 예정) — UI 예고용. 외인은 국내 FA 비대상(트라이아웃 전용). */
export function willBeFA(p: Player): boolean {
  return !p.isForeign && p.career.seasons >= FIRST_FA_SEASONS - 1 && p.contract.remaining <= 1;
}

/** 직전 연봉 순위로 A/B/C 등급 (상위 35% A · 다음 35% B · 나머지 C) */
export function assignFAGrades(pool: Player[]): Map<string, FAGrade> {
  const sorted = [...pool].sort((a, b) => b.contract.salary - a.contract.salary);
  const n = sorted.length;
  const grades = new Map<string, FAGrade>();
  sorted.forEach((p, i) => {
    const frac = n <= 1 ? 0 : i / (n - 1);
    grades.set(p.id, frac <= 0.35 ? 'A' : frac <= 0.7 ? 'B' : 'C');
  });
  return grades;
}

const PREMIUM: Record<FAGrade, number> = { A: 1.25, B: 1.15, C: 1.1 };

/** FA 요구 연봉 = 시장가치 × 등급 프리미엄 */
export function askingPrice(market: number, grade: FAGrade): number {
  return Math.round((market * PREMIUM[grade]) / 100) * 100;
}

// ─── 선수의 오퍼 평가(수락 판정) ───
export interface OfferCtx {
  teamOvr: number;     // 영입 구단 전력
  prestige: number;    // 영입 구단 최근 성적(우승권) 0..1
  posGap: number;      // 그 팀의 해당 포지션 부족도(출전 기회)
  isOriginal: boolean; // 원소속 구단인가
  isFranchise: boolean;// 프랜차이즈(원소속 장기근속)인가
  isPreferred: boolean;// 선수의 선호/연고 팀인가
  offerSalary: number; // 제시 연봉
  asking: number;      // 요구 연봉
  w: FAWeights;        // 선수의 동기 가중치(prefWeightsOf)
  rand: number;        // 0~1 결정론 난수
  talkBias?: number;   // 구단주 면담 보정(OWNER_SYSTEM) — 설득 성공 +, 결렬 −. 내 팀 오퍼에만
  relT?: number;       // 인간관계 affinity −1..1 (친구 +·싫은 선수 −) — RELATIONSHIP_SYSTEM
}

// FA 수락 = 점수→확률 (FA_SYSTEM 2.7). offerScore는 [0,~1] 가중합 → acceptProb가 완만 S곡선으로.
const SIT_FLOOR = 0.22;   // 이하 거의 거절(확률 0 부근)
const CERTAIN = 0.60;     // 이상 거의 확정(확률 1 부근)
export const SIT_OUT = 0.14; // 최고 점수도 이 미만이면 시즌 아웃(FA 잔류) — 드물게

/** 점수(offerScore, [0,~1]) → 수락 확률(완만 S곡선 smoothstep) */
export function acceptProb(score: number): number {
  const t = Math.max(0, Math.min(1, (score - SIT_FLOOR) / (CERTAIN - SIT_FLOOR)));
  return t * t * (3 - 2 * t);
}

/**
 * 선수가 한 오퍼를 얼마나 선호하는지(높을수록 수락).
 * 각 동기 항을 0..1로 정규화해 선수별 가중치(w)로 합산 → 같은 오퍼도 선수마다 다르게 평가.
 */
export function offerScore(c: OfferCtx): number {
  const ratio = Math.max(0.6, Math.min(1.6, c.offerSalary / Math.max(1, c.asking)));
  const moneyT = (ratio - 0.6) / 1.0;                                   // 0.6~1.6 → 0..1
  const strength = Math.max(0, Math.min(1, (c.teamOvr - 58) / 18));     // 전력
  // 우승권 매력 = 현재 전력 위주 + 최근 성적 소폭. prestige(우승 기록)는 자기강화 항이라
  // 비중을 낮춰야 왕조 부익부 루프가 폭주하지 않는다(밸런싱: 200시즌 parity).
  const winT = Math.max(0, Math.min(1, 0.7 * strength + 0.3 * c.prestige));
  const playT = c.posGap > 0 ? Math.min(1, 0.4 + 0.25 * c.posGap) : 0.15;     // 출전 기회
  const loyT = c.isOriginal ? (c.isFranchise ? 1 : 0.5) : 0;            // 잔류
  const homeT = c.isPreferred ? 1 : 0;                                  // 연고/선호팀
  const w = c.w;
  // 인간관계 항: relT(−1..1) × w.rel. 친구 있는 팀 +, 싫은 선수 있는 팀 −(감점). RELATIONSHIP_SYSTEM.
  const relTerm = (w.rel ?? 0) * (c.relT ?? 0);
  return w.money * moneyT + w.win * winT + w.loyalty * loyT + w.play * playT + w.home * homeT + relTerm + 0.05 * c.rand + (c.talkBias ?? 0);
}

/** 자격 FA 목록 + 등급 (한 오프시즌 스냅샷) */
export function listFreeAgents(players: Player[]): { player: Player; grade: FAGrade }[] {
  const pool = players.filter(isFAEligible);
  const grades = assignFAGrades(pool);
  return pool.map((player) => ({ player, grade: grades.get(player.id)! }));
}
