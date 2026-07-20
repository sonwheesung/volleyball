// 감독 명성(시장 가치) — 경력 로그 → 명성 순수 파생. 언론 예상 순위 + 연봉 프리미엄. (STAFF_SYSTEM §9.2~§9.4, 스태프 3.0 Phase B)
//   ★ 결정론·React 무의존·store 무의존(engine leaf: overall+rng+types만). 명성 숫자는 저장 안 함 — 로그(+renown)의 순수 함수.
//   평가 주축 = "기대 대비"(예상 순위 vs 실제 순위, 리그 합 제로섬). 절대 순위는 하락 트리거 아님(§9.2).

import type { Player, Position } from '../types';
import { overallRaw } from './overall';
import { createRng, strSeed } from './rng';
import { headType3, type HeadType3 } from './staff';

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
  // 유망주 육성 보조축(§9.2·§9.6-D, additive — 구 로그는 undefined=0). 로그 기록 가능한 사실만.
  u23Starters?: number;    // 그 시즌 U23 주전 안착 수(경기 절반 이상 출전한 U23)
  rookieAward?: boolean;   // 그 팀 소속 선수가 신인상 수상
}

/** 언론 예상 순위 영속 엔트리(시즌별) — 개막 뉴스·경력 로그 예상순위의 공통 기준선. */
export interface MediaPredictionEntry { season: number; order: string[] } // order[0] = 예상 1위(teamId)

/** 전문 코치 경량 경력 1행(§9.2·§9.6-D B이월, additive 영속) — 승격 시 coachRep(§6.3 상수 50 청산)·초기 명성 환산 입력.
 *  감독 경력 로그와 별도(코치는 순위 대비 성과가 아니라 재직·소속팀 성적만 — 코치는 기용/운영 주체가 아님). */
export interface CoachAsstCareerRow { season: number; coachId: string; teamId: string; teamRank: number } // teamRank 1-based
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

// ── 전문 코치 명성(coachRep, §6.3 상수 50 청산 — §9.6-D) : 경력 로그(재직 시즌·소속팀 성적) → 0~100 순수 파생 ──
//   headWorthiness(rating, coachRep, starRep)의 coachRep에 주입 + 승격 초기 명성(renown) 환산에도 반영.
//   재직 시즌이 없으면 CoachRep 기준선(=구 상수 50과 동일)을 반환해 무경력 코치는 기존 승격률 보존(회귀 방어).
export const COACH_REP_BASE = 50;      // 무경력 기준선(구 headWorthiness 상수 50 등가)
const COACH_REP_TENURE = 3;            // 재직 1시즌당 가산(오래 지도할수록 인정)
const COACH_REP_TOPHALF = 2;           // 상위 절반 팀 시즌당 추가 가산(성과)
const COACH_REP_CAP = 90;              // 코치 명성 상한(감독 명성과 달리 신중)
/** 전문 코치 명성(0~COACH_REP_CAP) — 재직 시즌 + 소속팀 성적(상위 절반) 파생. 무경력=COACH_REP_BASE(구 상수 등가). */
export function assistantCoachRep(log: CoachAsstCareerRow[], coachId: string, teamCount = 7): number {
  const rows = log.filter((r) => r.coachId === coachId);
  if (!rows.length) return COACH_REP_BASE;
  let rep = COACH_REP_BASE;
  for (const r of rows) {
    rep += COACH_REP_TENURE;
    if (r.teamRank <= Math.ceil(teamCount / 2)) rep += COACH_REP_TOPHALF;
  }
  return Math.round(clampRep(Math.min(COACH_REP_CAP, rep)));
}

// ── 명성 산식(로그 → 0~100 순수 fold) ──
const EXP_GAIN = 3;      // 기대(예상−실제 순위) 계수(주축). 7팀 기준 최대 ±6칸 → ±18/시즌
// 보조 축은 소폭(§9.2) — 주축(기대) 대비 작게 유지해 "매년 우승=자동 거장"으로 축이 뒤바뀌지 않게(dist ②로 실측 튜닝).
const CHAMP_BONUS = 6;   // 우승(특별 업적, 보조)
const FINAL_BONUS = 3;   // 준우승
const PO_BONUS = 1;      // 봄배구 진출
const REG1_BONUS = 4;    // 정규리그 1위(특별 업적, 보조)
const FIRE_PENALTY = 18; // 시즌 중 경질(하락 트리거)
// 유망주 육성 보조축(§9.2·§9.6-D) — 기대(주축) 대비 소폭. 육성 서사가 명성에 "약간" 반영(축 뒤집기 금지).
const U23_STARTER_BONUS = 0.5;   // U23 주전 안착 1명당(상한 U23_STARTER_CAP개)
const U23_STARTER_CAP = 3;       // 한 시즌 최대 3명분(＝최대 +1.5)
const ROOKIE_AWARD_BONUS = 1.5;  // 신인상 배출(육성 성과 상징)

const clampRep = (n: number): number => (n < 0 ? 0 : n > 100 ? 100 : n);

/** 한 경력 행의 명성 변화량(예상 대비 + 보조 − 경질 + 유망주 육성 소폭). 절대 순위는 미사용(§9.2). */
export function rowDelta(r: CoachCareerRow): number {
  let d = (r.predictedRank - r.actualRank) * EXP_GAIN; // + = 기대 이상, − = 기대 미달
  if (r.champion) d += CHAMP_BONUS;
  else if (r.playoff === 'final') d += FINAL_BONUS;
  else if (r.playoff === 'po') d += PO_BONUS;
  if (r.actualRank === 1) d += REG1_BONUS;
  if (r.midSeasonFired) d -= FIRE_PENALTY;
  // 유망주 육성 보조축(소폭, §9.6-D B이월) — U23 주전 안착·신인상 배출.
  if (r.u23Starters) d += U23_STARTER_BONUS * Math.min(U23_STARTER_CAP, Math.max(0, r.u23Starters));
  if (r.rookieAward) d += ROOKIE_AWARD_BONUS;
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

// ════════════════════════════════════════════════════════════════════
// 시장(감독 영입 경쟁·선호·관심 구단·카운터오퍼) — 스태프 3.0 Phase C(§9.4·§9.6-C).
//   ★ 전부 시드 순수 함수(id/시즌 시드 — 메인 rng 불간섭, 게이트 ⑥). React·store 무의존.
//   선호는 **새 랜덤 속성이 아니라 명성 티어 + 유형(3축 argmax) 파생**(§9.4). 공석 폴백은 호출측(advanceCoaches)이
//   선호를 무시하고 반드시 채워 데드락 0(게이트 ④) — 여기 순수 함수는 "누가 우선권을 갖나"만 정한다.

/** 감독 선호 — young(젊은 로스터)·contender(컨텐더)·none(무선호). */
export type CoachPref = 'young' | 'contender' | 'none';
/** 팀 상황(선호 판정 입력) — 결측·전력·나이는 호출측이 로스터에서 산출. */
export interface TeamContext { teamId: string; avgAge: number; predictedRank: number }
/** 감독 시장 매물(프리 감독) — reputation·선호·firedFrom은 호출측이 산출해 주입. */
export interface MarketCoach { id: string; matchOps: number; reputation: number; pref: CoachPref; firedFrom: string[] }

export const YOUNG_AGE = 26.5;   // 육성형 명장이 선호하는 "젊은 로스터" 평균연령 상한
const PREF_TIER_STARS = 4;       // 이 티어(명장★4) 이상만 선호가 까다로움. 하위=무선호(아무 팀 OK)

/** 선호 파생(명성 티어 + 유형) — §9.4 선호 파생표. 명장·거장만 까다롭다. */
export function coachPreference(coach: { matchOps: number; dvPhilosophy: number; leadership: number }, reputation: number): CoachPref {
  if (reputationTier(reputation).stars < PREF_TIER_STARS) return 'none';
  const t: HeadType3 = headType3(coach);
  if (t === 'developmental') return 'young';
  if (t === 'competitive') return 'contender';
  return 'none'; // organizational = 무선호
}

/** 팀이 감독 선호에 맞는가 — 무선호는 항상 true(폴백 감독이 어떤 팀도 수락하는 근거). */
export function coachSuits(pref: CoachPref, ctx: TeamContext, teamCount: number): boolean {
  if (pref === 'young') return ctx.avgAge <= YOUNG_AGE;
  if (pref === 'contender') return ctx.predictedRank <= Math.ceil(teamCount / 2);
  return true; // none
}

/** 선호별 감독의 최적 행선지(경쟁 중인 팀들 중 하나를 고름) — contender=예상순위 최상, young=최연소, none=예상순위 최상. */
function pickTeamFor(pref: CoachPref, cand: TeamContext[]): TeamContext {
  const cmp = pref === 'young'
    ? (a: TeamContext, b: TeamContext) => a.avgAge - b.avgAge || (a.teamId < b.teamId ? -1 : 1)
    : (a: TeamContext, b: TeamContext) => a.predictedRank - b.predictedRank || (a.teamId < b.teamId ? -1 : 1);
  return [...cand].sort(cmp)[0];
}

/** AI 영입 경쟁 판정(결정론) — 공석 AI 팀 × 프리 감독 매칭. 반환 teamId→coachId(매칭된 것만; 나머지는 폴백).
 *  감독 매력 내림차순으로 우선권(reputation→matchOps→id), 각 감독은 선호 맞는 공석 팀 중 최적을 고른다(=경쟁 행선지). */
export function resolveCoachMarket(openTeams: TeamContext[], coaches: MarketCoach[], teamCount: number): Record<string, string> {
  const assigned: Record<string, string> = {};
  const order = [...coaches].sort((a, b) => b.reputation - a.reputation || b.matchOps - a.matchOps || (a.id < b.id ? -1 : 1));
  for (const c of order) {
    const cand = openTeams.filter((t) => !(t.teamId in assigned) && !c.firedFrom.includes(t.teamId) && coachSuits(c.pref, t, teamCount));
    if (!cand.length) continue; // 선호 맞는 공석 없음 → FA 잔류(다음 팀/시즌 대기)
    assigned[pickTeamFor(c.pref, cand).teamId] = c.id;
  }
  return assigned;
}

// ── 관심 구단(명성 티어별 상한 + 선호 적합) ──
/** 명성 티어(별 1~5)별 관심 구단 상한 — 단조↑, 무명=0·거장=다수(§9.4). */
export function interestCapForTier(stars: number): number {
  return [0, 0, 1, 2, 3, 5][Math.max(1, Math.min(5, stars))]; // stars 1→0 · 2→1 · 3→2 · 4→3 · 5→5
}

/** 감독을 노리는 관심 구단(teamId[], 결정론) — 티어 상한 + 선호 적합(+100) + id 시드 지터(0~49) 정렬. */
export function interestedClubs(
  coach: { id: string; matchOps: number; dvPhilosophy: number; leadership: number; firedFrom?: string[] },
  reputation: number,
  allTeams: TeamContext[],
  teamCount: number,
  excludeTeamId?: string,
): string[] {
  const cap = interestCapForTier(reputationTier(reputation).stars);
  if (cap <= 0) return [];
  const pref = coachPreference(coach, reputation);
  const fired = coach.firedFrom ?? [];
  const scored = allTeams
    .filter((t) => t.teamId !== excludeTeamId && !fired.includes(t.teamId))
    .map((t) => ({ teamId: t.teamId, score: (coachSuits(pref, t, teamCount) ? 100 : 0) + (strSeed(`interest:${coach.id}:${t.teamId}`) % 50) }))
    .sort((a, b) => b.score - a.score || (a.teamId < b.teamId ? -1 : 1));
  return scored.slice(0, cap).map((s) => s.teamId);
}

// ── 카운터오퍼(1회 판정, §9.4) ──
const CO_BASE = 0.95;    // 무할인·무명·무관심 기준 수락 확률
const CO_GAP_W = 1.1;    // 할인폭(gap) 계수 — 많이 깎을수록 결렬↑
const CO_REP_W = 0.4;    // 명성 계수 — 명장일수록 결렬↑
const CO_RIVAL_W = 0.06; // 관심 구단 계수 — 노리는 팀 많을수록 결렬↑
const CO_RIVAL_CAP = 5;
const CO_FLOOR = 0.05;
const CO_CAP = 0.95;

/** 카운터오퍼 수락 확률(0~1, 결정론 입력) — 명성↑·관심↑·할인폭↑ → 낮아짐(결렬↑). */
export function counterOfferAcceptProb(demand: number, offered: number, reputation: number, rivalCount: number): number {
  if (offered >= demand) return 1; // 할인 아님 → 무조건 수락
  const gap = demand > 0 ? (demand - offered) / demand : 0;
  const p = CO_BASE - CO_GAP_W * gap - CO_REP_W * (clampRep(reputation) / 100) - CO_RIVAL_W * Math.min(Math.max(0, rivalCount), CO_RIVAL_CAP);
  return p < CO_FLOOR ? CO_FLOOR : p > CO_CAP ? CO_CAP : p;
}

/** 카운터오퍼 1회 판정(결정론 시드 — 재시도해도 동일 = 흥정 루프 봉인). */
export function counterOfferOutcome(
  demand: number, offered: number, reputation: number, rivalCount: number, seed: string,
): { accept: boolean; prob: number } {
  const prob = counterOfferAcceptProb(demand, offered, reputation, rivalCount);
  const roll = createRng(strSeed(seed)).next();
  return { accept: roll < prob, prob };
}
