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
  // 명장 열전 표시 사실(§9.6-E Phase E, additive — 구 로그는 undefined → 열전 우아 강등). 은퇴로 풀에서 사라진 감독을 로그만으로 조회 가능하게.
  coachName?: string;      // 감독 이름(풀 제거 후 표시용 — 결측 시 열전 제외)
  renown?: number;         // 초기 명성(birth 속성 — 은퇴 감독 명성 정확 재계산용. 결측 시 fallbackRenown(id))
  wins?: number;           // 그 시즌 정규 승(통산 승률용)
  losses?: number;         // 그 시즌 정규 패
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

// ════════════════════════════════════════════════════════════════════
// 명장 열전(감독 명예의전당) + 감독 코멘트 + 감독 뉴스 — 스태프 3.0 Phase E(§9.6-E).
//   ★ 전부 경력 로그(+renown)의 순수 파생. 무저장 재계산(ACHIEVEMENT 철학) — 명성 저장 안 함과 동일 척추.

/** 감독 1인의 경력 로그를 시즌 오름차순으로 fold하며 [최종 명성, 최고 명성] 반환. renown 없으면 fallbackRenown(id). */
function foldReputation(rows: CoachCareerRow[], coachId: string, renown?: number): { final: number; peak: number } {
  const ordered = rows.filter((r) => r.coachId === coachId).sort((a, b) => a.season - b.season);
  const base = clampRep(typeof renown === 'number' && Number.isFinite(renown) ? renown : fallbackRenown(coachId));
  let rep = base, peak = base;
  for (const r of ordered) { rep = clampRep(rep + rowDelta(r)); if (rep > peak) peak = rep; }
  return { final: Math.round(rep), peak: Math.round(peak) };
}

// ── 명장 열전(입성 판정식 — 경력 로그 파생) ──
export const HALL_MIN_SEASONS = 5;   // 최소 재직 시즌(단명 감독 배제 — 하한 게이트)
export const HALL_CHAMP_W = 8;       // 우승 1회 가중
export const HALL_WINRATE_W = 30;    // (승률−0.5) 가중 — 통산 승률 반영
export const HALL_SCORE_MIN = 68;    // 입성 점수 하한(명장급 최고 명성 ± 우승/승률)

/** 명장 열전 입성 점수 — peakRep·우승·통산 승률 전부 단조↑(더 나은 커리어 ≥ 입성, 게이트 b). */
export function coachHallScore(peakRep: number, champions: number, winRate: number): number {
  return peakRep + champions * HALL_CHAMP_W + (winRate - 0.5) * HALL_WINRATE_W;
}

export interface CoachHallEntry {
  coachId: string;
  name: string;
  seasons: number;         // 재직 시즌 수(로그 행 수)
  champions: number;       // 우승 횟수
  peakRep: number;         // 최고 명성(progressive fold max)
  peakTier: RepTier;
  finalRep: number;        // 은퇴 시점 명성
  wins: number; losses: number; winRate: number;
  teamIds: string[];       // 재직 팀(시즌 등장순 고유)
  lastTeamId: string;      // 마지막 재직 팀
  lastSeason: number;      // 마지막 재직 시즌(헌액 뉴스 타이밍)
  best?: { season: number; teamId: string; predictedRank: number; actualRank: number; champion: boolean }; // 대표 시즌
  score: number;
}

/** 명장 열전 — 은퇴 감독(로그엔 있으나 현 풀 activeIds엔 없음) 중 입성 판정식 통과자. 무저장 재계산·결정론.
 *  이름(coachName) 캡처가 없는 감독은 표시 불가 → 우아 강등(제외, 크래시 0). 점수 내림차순 정렬. */
export function hallOfCoaches(log: CoachCareerRow[], activeIds: Set<string>): CoachHallEntry[] {
  const byId = new Map<string, CoachCareerRow[]>();
  for (const r of log) { const a = byId.get(r.coachId); if (a) a.push(r); else byId.set(r.coachId, [r]); }
  const out: CoachHallEntry[] = [];
  for (const [coachId, rowsRaw] of byId) {
    if (activeIds.has(coachId)) continue; // 활동 중(풀 내)·FA 감독은 은퇴 아님
    const rows = [...rowsRaw].sort((a, b) => a.season - b.season);
    const named = rows.find((r) => r.coachName && r.coachName.trim());
    if (!named) continue; // 이름 결측(구세이브) → 우아 강등(제외)
    const renown = rows.map((r) => r.renown).find((v) => typeof v === 'number' && Number.isFinite(v));
    const { final, peak } = foldReputation(rows, coachId, renown);
    const champions = rows.filter((r) => r.champion).length;
    let wins = 0, losses = 0, haveWL = false;
    for (const r of rows) { if (typeof r.wins === 'number' && typeof r.losses === 'number') { wins += r.wins; losses += r.losses; haveWL = true; } }
    const winRate = haveWL && wins + losses > 0 ? wins / (wins + losses) : 0.5;
    const seasons = rows.length;
    const score = coachHallScore(peak, champions, winRate);
    if (seasons < HALL_MIN_SEASONS || score < HALL_SCORE_MIN) continue;
    const teamIds: string[] = [];
    for (const r of rows) if (!teamIds.includes(r.teamId)) teamIds.push(r.teamId);
    // 대표 시즌 = 챔피언 + 최대 기대 상승(예상−실제), 동점 시 최신
    let best = rows[0];
    let bestScore = -Infinity;
    for (const r of rows) {
      const rs = (r.champion ? 100 : 0) + (r.predictedRank - r.actualRank);
      if (rs > bestScore || (rs === bestScore && r.season > best.season)) { bestScore = rs; best = r; }
    }
    const last = rows[rows.length - 1];
    out.push({
      coachId, name: named.coachName!, seasons, champions, peakRep: peak, peakTier: reputationTier(peak),
      finalRep: final, wins, losses, winRate, teamIds, lastTeamId: last.teamId, lastSeason: last.season,
      best: { season: best.season, teamId: best.teamId, predictedRank: best.predictedRank, actualRank: best.actualRank, champion: best.champion },
      score,
    });
  }
  return out.sort((a, b) => b.score - a.score || b.peakRep - a.peakRep || (a.coachId < b.coachId ? -1 : 1));
}

// ── 감독 코멘트(데이터 파생 플레이버 — 없는 인과 금지, 상태 서술만) ──
export interface CoachCommentState {
  expectDelta: number;   // 직전 시즌 예상−실제(>0=기대 이상)
  champion: boolean;     // 직전 시즌 우승
  contractYears: number; // 잔여 계약 연수
  avgAge: number;        // 팀 평균 연령
  tierStars: number;     // 명성 티어 별(1~5)
  interest: number;      // 관심 구단 수
}
const COMMENT_YOUNG_AGE = 25.5;
const COMMENT_VET_AGE = 29;
// 성적 리드(상태로 결정) — champion > 기대이상(δ≥2) > 기대미달(δ≤−2) > 기대대로. 상태 서술만(없는 인과 금지).
const LEAD_CHAMP = '지난 시즌 정상에 오른 팀을 이끈다.';
const LEAD_OVER = '예상을 웃도는 성적을 낸 시즌이었다.';
const LEAD_UNDER = '기대에 못 미친 시즌이었다.';
const LEAD_EVEN = '예상만큼의 시즌을 보냈다.';
// 문맥 꼬리(적합 상태에서만 후보) — seed로 하나 선택.
const TAIL_EXPIRE = '계약이 끝나 거취를 정해야 할 시점이다.';
const TAIL_LASTYEAR = '계약은 한 시즌 남았다.';
const TAIL_YOUNG = '어린 선수가 많은 팀이라 함께 자랄 시간이 필요하다.';
const TAIL_VET = '베테랑이 중심인 팀이라 지금이 승부처다.';
const TAIL_INTEREST = '다른 구단의 관심도 들려온다.';
const TAIL_MASTER = '오랜 시간 쌓아온 이름값이 있는 자리다.';
const TAIL_UNKNOWN = '아직 증명할 것이 많은 감독이다.';

/** 감독 한 줄 심경(결정론) — 성적 리드(상태 결정) + 문맥 꼬리(적합 후보 중 seed 선택). 각 문구는 대응 상태에서만 출현. */
export function coachComment(state: CoachCommentState, seed: string): string {
  const lead = state.champion ? LEAD_CHAMP
    : state.expectDelta >= 2 ? LEAD_OVER
    : state.expectDelta <= -2 ? LEAD_UNDER
    : LEAD_EVEN;
  const tails: string[] = [];
  if (state.contractYears <= 0) tails.push(TAIL_EXPIRE);
  else if (state.contractYears === 1) tails.push(TAIL_LASTYEAR);
  if (state.avgAge <= COMMENT_YOUNG_AGE) tails.push(TAIL_YOUNG);
  else if (state.avgAge >= COMMENT_VET_AGE) tails.push(TAIL_VET);
  if (state.interest >= 1) tails.push(TAIL_INTEREST);
  if (state.tierStars >= 5) tails.push(TAIL_MASTER);
  else if (state.tierStars <= 1) tails.push(TAIL_UNKNOWN);
  if (!tails.length) return lead;
  const tail = tails[strSeed(`comment:${seed}`) % tails.length];
  return `${lead} ${tail}`;
}

// ── 감독 뉴스 이벤트(경력 로그 + 현 풀 파생 — 명성 티어 게이트) ──
export const COACH_NEWS_TIER_STARS = 4; // 명장(★4)+ 만 뉴스 대상(무명 이동은 뉴스 안 됨 — 빈도 게이트)
export type CoachNewsKind = 'debut' | 'move' | 'expiring' | 'fired' | 'enshrine';
export interface CoachNewsEvent {
  kind: CoachNewsKind;
  season: number;        // 발생/표시 시즌
  day0: boolean;         // true=현재 오프시즌 개막(day=0), false=과거 요약(day 없음)
  coachId: string;
  coachName: string;
  teamId: string;        // 관련 팀(도착팀/현팀/경질팀/마지막팀)
  fromTeamId?: string;   // move: 떠난 팀
  reputation: number;
  tier: RepTier;
  seasons?: number;      // enshrine 요약
  champions?: number;    // enshrine 요약
}
/** 감독 뉴스 산출측 입력(현 감독 풀의 최소 형태 — Coach 구조 부분집합). */
export interface HeadCoachRef {
  id: string; name: string; renown?: number; teamId: string | null; contractYears?: number;
}

/** 감독 뉴스 이벤트(결정론·순수) — 데뷔/이적/만료임박(신선, 풀 vs 직전 로그) + 경질/헌액(로그 파생). 명성 티어 게이트. */
export function coachNewsEvents(log: CoachCareerRow[], activeCoaches: HeadCoachRef[], currentSeason: number): CoachNewsEvent[] {
  const events: CoachNewsEvent[] = [];
  const activeIds = new Set(activeCoaches.map((c) => c.id));
  const byId = new Map<string, CoachCareerRow[]>();
  for (const r of log) { const a = byId.get(r.coachId); if (a) a.push(r); else byId.set(r.coachId, [r]); }
  const sortedRows = (id: string) => (byId.get(id) ?? []).slice().sort((a, b) => a.season - b.season);
  const nameFromLog = (id: string) => { const rows = byId.get(id) ?? []; return rows.map((r) => r.coachName).find((n) => n && n.trim()); };

  // A) 신선 오프시즌 사건(현 감독 풀 vs 직전 로그 행) — day=0·season=currentSeason.
  for (const c of activeCoaches) {
    if (c.teamId == null) continue; // FA/미배정
    const rows = sortedRows(c.id);
    const rep = foldReputation(log, c.id, c.renown).final;
    const tier = reputationTier(rep);
    const gated = tier.stars >= COACH_NEWS_TIER_STARS;
    if (rows.length === 0) { // 승격 데뷔(첫 부임 — 로그 없음). 데뷔 명성=renown.
      if (gated) events.push({ kind: 'debut', season: currentSeason, day0: true, coachId: c.id, coachName: c.name, teamId: c.teamId, reputation: rep, tier });
      continue;
    }
    const last = rows[rows.length - 1];
    if (last.season === currentSeason - 1 && last.teamId !== c.teamId && gated) { // 신선 이적(직전 시즌 팀과 다른 현 팀)
      events.push({ kind: 'move', season: currentSeason, day0: true, coachId: c.id, coachName: c.name, teamId: c.teamId, fromTeamId: last.teamId, reputation: rep, tier });
    }
    if ((c.contractYears ?? 99) <= 1 && gated) { // 계약 만료 임박(전망)
      events.push({ kind: 'expiring', season: currentSeason, day0: true, coachId: c.id, coachName: c.name, teamId: c.teamId, reputation: rep, tier });
    }
  }

  // B) 시즌 중 경질(로그 midSeasonFired 파생 — 플레이어 팀만 발생 §6.4, 희소). 발생 시점 명성.
  for (const r of log) {
    if (!r.midSeasonFired) continue;
    const upto = (byId.get(r.coachId) ?? []).filter((x) => x.season <= r.season);
    const rep = foldReputation(upto, r.coachId, r.renown).final;
    const name = r.coachName || nameFromLog(r.coachId);
    if (!name) continue; // 이름 결측 → 우아 강등
    events.push({ kind: 'fired', season: r.season, day0: false, coachId: r.coachId, coachName: name, teamId: r.teamId, reputation: rep, tier: reputationTier(rep) });
  }

  // C) 명장 열전 헌액(은퇴 감독 입성) — 마지막 재직 시즌 요약.
  for (const h of hallOfCoaches(log, activeIds)) {
    events.push({ kind: 'enshrine', season: h.lastSeason, day0: false, coachId: h.coachId, coachName: h.name, teamId: h.lastTeamId, reputation: h.finalRep, tier: h.peakTier, seasons: h.seasons, champions: h.champions });
  }

  return events;
}
