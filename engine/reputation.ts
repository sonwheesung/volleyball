// 감독 명성(시장 가치) — 경력 로그 → 명성 순수 파생. 언론 예상 순위 + 연봉 프리미엄. (STAFF_SYSTEM §9.2~§9.4, 스태프 3.0 Phase B)
//   ★ 결정론·React 무의존·store 무의존(engine leaf: overall+rng+types만). 명성 숫자는 저장 안 함 — 로그(+renown)의 순수 함수.
//   평가 주축 = "기대 대비"(예상 순위 vs 실제 순위, 리그 합 제로섬). 절대 순위는 하락 트리거 아님(§9.2).

import type { Player, Position } from '../types';
import { overallRaw } from './overall';
import { strSeed } from './rng';

// ── 경력 로그 스키마(영속 — 명성의 유일한 진실) ──
export type PlayoffResult = 'none' | 'po' | 'final' | 'champion';
/** 감독 1인의 한 시즌 경력 사실 1행(시즌 종료 시 append). 명성=이 로그의 순수 fold. */
export interface CoachCareerRow {
  season: number;
  coachId: string;
  teamId: string;
  predictedRank: number;   // 언론 예상 순위(1-based)
  actualRank: number;      // 실제 정규리그 순위(1-based)
  playoff: PlayoffResult;  // 플옵 성과
  champion: boolean;       // 우승 여부
  midSeasonFired: boolean; // 시즌 중 경질 여부(하락 트리거 §9.2)
}

/** 언론 예상 순위 영속 엔트리(시즌별) — 개막 뉴스·경력 로그 예상순위의 공통 기준선. */
export interface MediaPredictionEntry { season: number; order: string[] } // order[0] = 예상 1위(teamId)
/** 시즌 중 경질 캡처(내 팀 fireCoach) — endSeason이 경력 로그 midSeasonFired 행으로 소비 후 리셋. */
export interface MidFire { season: number; coachId: string; teamId: string }

// ── 언론 예상 순위(프리시즌 전력 → 결정론 순위) ──
const STARTER_NEED: [Position, number][] = [['S', 1], ['OH', 2], ['MB', 2], ['OP', 1], ['L', 1]];
const STARTER_FLOOR = 45; // 결측 주전 자리 raw OVR 하한(포지션 구멍 페널티)
const BENCH_WEIGHT = 0.5; // 벤치 뎁스 가중(주전 대비 소폭)

/** 팀 프리시즌 전력 지수(결정론) — 포지션별 최적 라인업 raw OVR 합 + 벤치 상위4 평균×가중.
 *  외국인 OP는 OP 풀에서 자연 선발(전력에 반영). 나이/경험은 overallRaw(현 능력)에 이미 반영. */
export function preseasonStrength(players: Player[]): number {
  const byPos: Record<string, number[]> = {};
  for (const p of players) (byPos[p.position] ??= []).push(overallRaw(p));
  for (const k of Object.keys(byPos)) byPos[k].sort((a, b) => b - a);
  const consumed: Record<string, number> = {};
  let starters = 0;
  for (const [pos, n] of STARTER_NEED) {
    const arr = byPos[pos] ?? [];
    for (let i = 0; i < n; i++) starters += i < arr.length ? arr[i] : STARTER_FLOOR;
    consumed[pos] = n;
  }
  const bench: number[] = [];
  for (const pos of Object.keys(byPos)) for (let i = consumed[pos] ?? 0; i < byPos[pos].length; i++) bench.push(byPos[pos][i]);
  bench.sort((a, b) => b - a);
  const top = bench.slice(0, 4);
  const benchAvg = top.length ? top.reduce((a, b) => a + b, 0) / top.length : STARTER_FLOOR;
  return starters + benchAvg * BENCH_WEIGHT;
}

/** 전 팀 예상 순위(teamId[], index0=예상 1위) — 전력 내림차순, 동점=teamId 오름차순(결정론). */
export function predictRanks(entries: { teamId: string; players: Player[] }[]): string[] {
  return entries
    .map((e) => ({ teamId: e.teamId, s: preseasonStrength(e.players) }))
    .sort((a, b) => b.s - a.s || (a.teamId < b.teamId ? -1 : 1))
    .map((e) => e.teamId);
}

// ── 초기 명성(renown, birth 속성 — 구 starRep 흡수 §9.2) ──
export const LEGEND_RENOWN = 72; // 레전드 선수 출신 승격(명장 — "왕년의 명장")
export const PROMO_RENOWN = 38;  // 일반 코치 승격(주목)
/** 시드/프리 감독 초기 명성 — id 시드 파생 12~45(무명~주목 하위). 명성은 대체로 코트에서 번다. */
export const seedRenown = (id: string): number => 12 + (strSeed(`renown:${id}`) % 34);
/** 신임/대행 감독 초기 명성 — 8~17(무명). */
export const interimRenown = (id: string): number => 8 + (strSeed(`renown:${id}`) % 10);
/** renown 누락(구세이브·손상) 폴백 — seedRenown과 동일 밴드(결정론). */
export const fallbackRenown = (id: string): number => seedRenown(id);

// ── 명성 산식(로그 → 0~100 순수 fold) ──
const EXP_GAIN = 3;      // 기대(예상−실제 순위) 계수(주축). 7팀 기준 최대 ±6칸 → ±18/시즌
// 보조 축은 소폭(§9.2) — 주축(기대) 대비 작게 유지해 "매년 우승=자동 거장"으로 축이 뒤바뀌지 않게(dist ②로 실측 튜닝).
const CHAMP_BONUS = 6;   // 우승(특별 업적, 보조)
const FINAL_BONUS = 3;   // 준우승
const PO_BONUS = 1;      // 봄배구 진출
const REG1_BONUS = 4;    // 정규리그 1위(특별 업적, 보조)
const FIRE_PENALTY = 18; // 시즌 중 경질(하락 트리거)

const clampRep = (n: number): number => (n < 0 ? 0 : n > 100 ? 100 : n);

/** 한 경력 행의 명성 변화량(예상 대비 + 보조 − 경질). 절대 순위는 미사용(§9.2). */
export function rowDelta(r: CoachCareerRow): number {
  let d = (r.predictedRank - r.actualRank) * EXP_GAIN; // + = 기대 이상, − = 기대 미달
  if (r.champion) d += CHAMP_BONUS;
  else if (r.playoff === 'final') d += FINAL_BONUS;
  else if (r.playoff === 'po') d += PO_BONUS;
  if (r.actualRank === 1) d += REG1_BONUS;
  if (r.midSeasonFired) d -= FIRE_PENALTY;
  return d;
}

/** 감독 명성(0~100) — renown 기준선에서 시즌 오름차순 로그를 fold(매 스텝 clamp). 로그·renown의 순수 함수(무저장). */
export function reputationOf(log: CoachCareerRow[], coach: { id: string; renown?: number }): number {
  const rows = log.filter((r) => r.coachId === coach.id).sort((a, b) => a.season - b.season);
  let rep = clampRep(typeof coach.renown === 'number' && Number.isFinite(coach.renown) ? coach.renown : fallbackRenown(coach.id));
  for (const r of rows) rep = clampRep(rep + rowDelta(r));
  return Math.round(rep);
}

// ── 티어(0~100 → 라벨·별) ──
export interface RepTier { min: number; label: string; stars: number }
export const REP_TIERS: RepTier[] = [
  { min: 80, label: '거장', stars: 5 },
  { min: 60, label: '명장', stars: 4 },
  { min: 40, label: '인정받는 감독', stars: 3 },
  { min: 20, label: '주목', stars: 2 },
  { min: 0, label: '무명', stars: 1 },
];
export function reputationTier(rep: number): RepTier {
  for (const t of REP_TIERS) if (rep >= t.min) return t;
  return REP_TIERS[REP_TIERS.length - 1];
}
export const repStars = (rep: number): string => '★'.repeat(reputationTier(rep).stars);

// ── 연봉 프리미엄(base + 명성 프리미엄, 상한 캡 — §9.4 대체 금지) ──
export const REP_PREMIUM_PER = 0.4; // rep 100 → round(40)×100 = +4.0k(캡)
/** 명성 프리미엄(만원) — base 위에 얹는다(base를 갈아치우지 않음). rep 0 → +0. */
export const reputationPremium = (rep: number): number => Math.round(REP_PREMIUM_PER * clampRep(rep)) * 100;

/** 요구 연봉 상승 이유(경력 로그 파생 사실만 — 없는 인과 금지 §9.4). 최근 시즌 우선, 최대 2사유. */
export function raiseReasons(log: CoachCareerRow[], coachId: string): string[] {
  const rows = log.filter((r) => r.coachId === coachId).sort((a, b) => b.season - a.season);
  const reasons: string[] = [];
  const push = (s: string) => { if (!reasons.includes(s) && reasons.length < 2) reasons.push(s); };
  for (const r of rows) {
    if (r.champion) push('우승');
    else if (r.playoff === 'final') push('준우승');
    if (r.actualRank === 1) push('정규리그 1위');
    if (r.predictedRank - r.actualRank >= 2) push('기대 이상의 성적');
    if (reasons.length >= 2) break;
  }
  return reasons;
}
