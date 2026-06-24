// 구단주 레이어 (OWNER_SYSTEM) — 선수 면담·감독 벤치 건의·인기/팬심. 순수 + 시드 결정론.
// 불만은 저장하지 않는다: FA 성향(faPref)과 현실의 불일치에서 그때그때 파생.
// 면담 결과만 로그로 저장(store) → FA 잔류/이탈 판정의 입력이 된다.

import type { Player } from '../types';
import { createRng, strSeed } from './rng';
import { prefWeightsOf } from './faMarket';

// ─── 불만 (파생, 저장 없음) ───────────────────────────────────

export type DiscontentTopic = 'win' | 'minutes' | 'money' | 'hometown';

/** 선수가 코트에 못/안 나오는 사유 (ROTATION_MORALE B). 'rested'는 #3 구현 전까지 휴면. */
export type SitCause = 'starter' | 'injured' | 'suspended' | 'rested' | 'ownerBenched' | 'outclassed';
/** 선수 기분 (ROTATION_MORALE C) — 불만 / 무감정 / 긍정 */
export type Mood = 'discontent' | 'neutral' | 'positive';

export const SIT_CAUSE_KO: Record<SitCause, string> = {
  starter: '주전 출전', injured: '부상 결장', suspended: '징계 결장',
  rested: '체력 안배(휴식)', ownerBenched: '구단주 벤치 지시', outclassed: '주전 경쟁 밀림',
};

export interface DiscontentCtx {
  recentRankAvg: number;   // 팀 최근 2시즌 평균 순위(1=1위)
  teamCount: number;
  playRatio: number;       // 최근 10경기 출전 비율 0..1
  salaryRatio: number;     // 연봉 / 시장가치
  myTeamId: string;
  sitCause?: SitCause;     // 왜 벤치/출전인지 — 출전 불만을 사유로 분기(없으면 구버전 playRatio 폴백)
  expectsPlay?: number;    // 주전 기대치 0..1 — 주전감(OVR·경력)일수록↑. 약체 후보는 벤치를 당연히 받아들임(불만 억제)
}

/** 출전 불만 — 사유 × **주전 기대치(실력/경력)** 로 분기.
 *  부상·징계·휴식·주전은 불만 없음(구단 탓 아님). 구단주 벤치는 전부·실력밀림은 절반, 둘 다 기대치로 스케일.
 *  → OVR 낮고 경력 짧은 후보(기대치≈0)는 못 나와도 불만 없음("아직 부족하지"). 에이스 벤치(기대치≈1)는 부글부글. */
function minutesGrievance(cause: SitCause | undefined, playRatio: number, expectsPlay = 1): { unmet: boolean; scale: number } {
  if (!cause) return { unmet: playRatio < 0.34, scale: 1 }; // 구버전 호환(사유 모르면 출전율만)
  switch (cause) {
    case 'ownerBenched': return { unmet: true, scale: 1 * expectsPlay };   // 부당 벤치 — 주전감일수록 분노
    case 'outclassed':   return { unmet: true, scale: 0.7 * expectsPlay }; // 실력 밀림 — 주전 문턱 가까울수록(±3 OVR) 출전형은 불만(어디서든 주전 원함). 부당벤치(1.0)보단 약함
    default:             return { unmet: false, scale: 0 };  // starter·injured·suspended·rested → 불만 없음
  }
}

/** 성향-현실 불일치 → 불만 주제. 없으면 null(충성파거나 만족 상태). 출전 불만은 사유+성격(w.play) 가중. */
export function discontentOf(p: Player, ctx: DiscontentCtx): DiscontentTopic | null {
  const w = prefWeightsOf(p);
  const min = minutesGrievance(ctx.sitCause, ctx.playRatio, ctx.expectsPlay);
  // 가장 강한 동기 순으로 불일치를 검사 — 한 사람의 불만은 하나로 수렴시킨다(면담 장면용)
  const checks: { topic: DiscontentTopic; weight: number; unmet: boolean }[] = [
    { topic: 'win', weight: w.win, unmet: ctx.recentRankAvg > ctx.teamCount * 0.6 },
    { topic: 'minutes', weight: w.play * min.scale, unmet: min.unmet },
    { topic: 'money', weight: w.money, unmet: ctx.salaryRatio < 0.75 },
    { topic: 'hometown', weight: w.home, unmet: !!p.faPref?.preferredTeamId && p.faPref.preferredTeamId !== ctx.myTeamId },
  ];
  const hit = checks.filter((c) => c.unmet && c.weight >= 0.25).sort((a, b) => b.weight - a.weight)[0];
  return hit ? hit.topic : null;
}

/** 기분 — 불만이 있으면 discontent, 주전+상위권이면 positive(만족), 그 외 neutral(무감정). */
export function moodOf(ctx: DiscontentCtx, topic: DiscontentTopic | null): Mood {
  if (topic) return 'discontent';
  if (ctx.sitCause === 'starter' && ctx.recentRankAvg <= ctx.teamCount * 0.5) return 'positive';
  return 'neutral';
}

// ─── 면담 (Interview) ────────────────────────────────────────

/** 구단주의 약속 카드 */
export type TalkCard = 'reinforce' | 'starter' | 'raise' | 'franchise';

export const CARD_KO: Record<TalkCard, string> = {
  reinforce: '전력을 보강하겠다',
  starter: '주전을 보장하겠다',
  raise: '재계약 때 성의를 보이겠다',
  franchise: '당신은 이 구단의 심장이다',
};

/** 카드 ↔ 불만 주제 매칭(0..1) — 맞는 약속을 해야 통한다 */
export function cardMatch(card: TalkCard, topic: DiscontentTopic, p: Player): number {
  const M: Record<DiscontentTopic, TalkCard> = { win: 'reinforce', minutes: 'starter', money: 'raise', hometown: 'franchise' };
  if (M[topic] === card) return 1;
  if (card === 'franchise' && p.clubTenure >= 4) return 0.5; // 장기근속이면 정서 카드가 절반은 통함
  return 0;
}

export interface InterviewLog {
  playerId: string;
  season: number;       // 0-based
  day: number;
  topic: DiscontentTopic;
  card: TalkCard;
  ok: boolean;
}

/** 면담·건의 쿨다운(일) — 같은 선수를 하루에도 여러 번 들볶지 못하게(OWNER_SYSTEM).
 *  GAME_INTERVAL=4 기준 면담 ~6경기·건의 ~4경기 간격. 시즌말 currentDay 리셋과 함께 초기화. */
export const TALK_COOLDOWN_DAYS = 24;
export const BENCH_COOLDOWN_DAYS = 16;

/** 면담의 문은 선수가 연다 — 들볶을수록·실망시켰을수록 닫힌다 */
export function meetAccept(playerId: string, season: number, nThisSeason: number, lastFailed: boolean): boolean {
  const refuse = Math.min(0.9, 0.10 + 0.25 * nThisSeason + (lastFailed ? 0.30 : 0));
  const rng = createRng(strSeed(`talk-door:${playerId}:${season}:${nThisSeason}`));
  return rng.next() >= refuse;
}

/** 설득 판정 — 카드 매칭 + 구단 성적 보정 − 누적 실패 */
export function persuade(
  playerId: string, season: number, nThisSeason: number,
  match: number,          // cardMatch 0..1
  perfT: number,          // 구단 성적 보정 0..1 (상위권일수록 말에 힘이 실림)
  failsBefore: number,    // 이 선수와의 누적 실패 횟수(시즌 무관)
): boolean {
  const p = Math.max(0.1, Math.min(0.9, 0.35 + 0.4 * match + 0.1 * perfT - 0.15 * failsBefore));
  const rng = createRng(strSeed(`talk:${playerId}:${season}:${nThisSeason}`));
  return rng.next() < p;
}

/** 면담 로그 → FA 판정 보정. refuse=내 재계약 거부 가중(±), offer=FA 시장 내 오퍼 가중(±) */
export function interviewEffects(logs: InterviewLog[], season: number): {
  refuseBias: Record<string, number>;
  offerBias: Record<string, number>;
} {
  const refuseBias: Record<string, number> = {};
  const offerBias: Record<string, number> = {};
  for (const l of logs) {
    if (l.season !== season) continue;
    const d = l.ok ? 1 : -0.7; // 실패는 역효과 — 진심을 확인하고 실망
    refuseBias[l.playerId] = Math.max(-0.3, Math.min(0.3, (refuseBias[l.playerId] ?? 0) - d * 0.18));
    offerBias[l.playerId] = Math.max(-0.15, Math.min(0.15, (offerBias[l.playerId] ?? 0) + d * 0.10));
  }
  return { refuseBias, offerBias };
}

/** FA 판정에 주입되는 구단주 레이어 효과 — offseason은 이 타입만 안다(구현 비의존) */
export interface OwnerFx {
  refuseProb: Record<string, number>; // 내 팀 만료자: 재계약 거부 확률(불만+면담 결과)
  offerBias: Record<string, number>;  // FA 시장: 내 팀 오퍼에 대한 선수의 가중(면담 결과)
}

/** 불만 선수의 재계약 거부 확률 — 면담 보정(refuseBias) 가산. 만족 선수는 거부하지 않는다 */
export function refuseResignProb(topic: DiscontentTopic | null, weight: number, refuseBias: number): number {
  if (!topic) return 0;
  return Math.max(0, Math.min(0.9, 0.25 + 0.5 * weight + refuseBias));
}

/** 누적 출전 불만 → 재계약 거부 가산 (ROTATION_MORALE C.4) — 시즌 내내 앉아있을수록(낮은 출전율) 정 떨어진다.
 *  출전 불만(topic==='minutes', 사유·성격·기대치 게이트를 통과한 진짜 불만)일 때만 가산. 부상 결장(불만 아님)은 무관. */
export function sustainedBenchRefuse(playRatio: number, weight: number): number {
  return Math.min(0.35, Math.max(0, 1 - playRatio) * 0.45 * weight);
}

// ─── 감독 벤치 건의 ───────────────────────────────────────────

export type BenchReason = 'noResign' | 'form' | 'prospect';

export const BENCH_REASON_KO: Record<BenchReason, string> = {
  noResign: '내년에 우리와 함께하지 않을 선수입니다',
  form: '최근 폼이 너무 떨어졌습니다',
  prospect: '유망주에게 기회를 주고 싶습니다',
};

export interface BenchDirective { playerId: string; fromDay: number }

/** 동시 벤치 지시 상한 — 전원 벤치 같은 악용 차단 */
export const BENCH_MAX = 2;

/**
 * 감독의 수락 판정 — 합리(대체자 격차)와 소신(카리스마·에이스 보호) 사이.
 * @param ovrGapT   0..1 — 벤치 대상 vs 대체자 OVR 격차가 작을수록 1(수긍 쉬움)
 * @param aceRank   팀 내 OVR 순위(0=에이스)
 */
export function benchAccept(
  playerId: string, season: number, day: number,
  charisma: number, ovrGapT: number, aceRank: number, reason: BenchReason,
): boolean {
  const aceGuard = aceRank === 0 ? 0.4 : aceRank === 1 ? 0.2 : 0;
  const reasonT = reason === 'noResign' ? 0.2 : reason === 'form' ? 0.1 : 0.05;
  const p = Math.max(0.05, Math.min(0.95,
    0.5 + 0.3 * ovrGapT - aceGuard - 0.2 * ((charisma - 50) / 50) + reasonT));
  const rng = createRng(strSeed(`bench:${playerId}:${season}:${day}`));
  return rng.next() < p;
}

/** 선발 기용 건의 — "이 선수를 선발로 써주시죠". 합리(건의 선수 vs 현 주전 격차)와 소신 사이.
 *  @param gapT 0..1 — 건의 선수가 현 주전과 비등/우위일수록 1(수긍 쉬움) */
export function startSuggestAccept(playerId: string, season: number, day: number, charisma: number, gapT: number): boolean {
  const p = Math.max(0.05, Math.min(0.95, 0.35 + 0.5 * gapT - 0.3 * ((charisma - 50) / 50)));
  const rng = createRng(strSeed(`start:${playerId}:${season}:${day}`));
  return rng.next() < p;
}

/** 빅매치 판정 — 보러 갈 이유. 상위권 맞대결이거나, 종반의 순위 직결 매치업 */
export function isBigMatch(myRank: number, oppRank: number, dayIndex: number, seasonEndDay = 164): boolean {
  const topClash = myRank <= 3 && oppRank <= 3;
  const rankClose = Math.abs(myRank - oppRank) <= 1;
  const lateSeason = dayIndex >= seasonEndDay * 0.65;
  return topClash || (rankClose && lateSeason);
}

// ─── 인기 · 팬심 ─────────────────────────────────────────────

/** 선수 인기(0..100) — 쌓인 기록에서 파생(저장 없음). 통산 생산 + 수상 + 근속 + 올해 활약 */
export function popularityOf(careerPoints: number, awardCount: number, tenure: number, seasonPoints: number): number {
  const t = 30 * Math.min(1, careerPoints / 3000)
    + 30 * Math.min(1, awardCount / 5)
    + 15 * Math.min(1, tenure / 6)
    + 25 * Math.min(1, seasonPoints / 400);
  return Math.round(Math.max(0, Math.min(100, t)));
}

/** 인기 스타 연속 결장의 팬 분노 — 길어질수록 가속 */
export function benchAngerPenalty(missedStreak: number): number {
  if (missedStreak < 3) return 0;
  if (missedStreak < 6) return 2;
  if (missedStreak < 10) return 5;
  return 10;
}

/**
 * 시즌 팬심(0..100) — 50에서 출발해 성적과 스타 대우로 움직인다.
 * @param winRate    시즌 승률 0..1
 * @param champion   우승 여부
 * @param angerSum   인기 스타 벤치 분노 누적(benchAngerPenalty 합)
 */
export function fanScore(winRate: number, champion: boolean, angerSum: number): number {
  const base = 50 + (winRate - 0.5) * 60 + (champion ? 15 : 0) - angerSum;
  return Math.round(Math.max(0, Math.min(100, base)));
}

/** 팬심 → 다음 시즌 예산 계수(0.92~1.08) */
export const fanBudgetFactor = (fan: number): number => 0.92 + 0.16 * (fan / 100);

// ─── 팬덤 규모(명) — 팀팬 + 선수팬 − 겹침 ────────────────────────
// 팬심(0~100)이 "마음"이라면 팬덤은 "사람 수". 팬에는 셋이 있다:
// 팀팬(구단을 따른다) · 선수팬(선수를 따른다 — 이적하면 떠난다) · 둘 다(겹침 — 잔류).
// 전부 파생(저장 없음): 팀 베이스는 teamId 시드, 선수팬은 인기에서.

/** 연고 팬 베이스(25,000~45,000명) — 팀 고유, 시드 결정론(도시 규모 차이) */
export function teamFanBase(teamId: string): number {
  return 25000 + Math.floor(createRng(strSeed(`fanbase:${teamId}`)).next() * 20000);
}

/** 선수 개인 팬 수 — 인기 비선형(스타일수록 가파르게). pop 100 ≈ 31,800명, 60 ≈ 12,500, 20 ≈ 1,750 */
export const playerFans = (popularity: number): number => Math.round(8 * Math.pow(Math.max(0, popularity), 1.8));

/** 선수팬 중 팀팬과 겹치는 비율 — 근속이 길수록(프랜차이즈) 팬덤이 구단과 융합 */
export const fanOverlapRatio = (tenure: number): number => Math.min(0.75, 0.25 + 0.08 * Math.max(0, tenure));

export interface Fanbase {
  teamFans: number;        // 순수 팀팬(팬심이 마음을 키우고 줄인다)
  playerFansTotal: number; // 선수팬 총합(겹침 포함)
  playerFansNet: number;   // 선수팬 중 팀팬과 안 겹치는 순증(이적 시 떠나는 몫)
  total: number;           // 구단 총 팬덤 = 팀팬 + 선수팬 순증
}

/** 구단 팬덤 합산 — players: 로스터의 (인기, 근속) */
export function fanbase(teamId: string, fan: number, players: { pop: number; tenure: number }[]): Fanbase {
  const teamFans = Math.round(teamFanBase(teamId) * (0.6 + 0.8 * Math.max(0, Math.min(100, fan)) / 100));
  let playerFansTotal = 0, playerFansNet = 0;
  for (const p of players) {
    const f = playerFans(p.pop);
    playerFansTotal += f;
    playerFansNet += Math.round(f * (1 - fanOverlapRatio(p.tenure)));
  }
  return { teamFans, playerFansTotal, playerFansNet, total: teamFans + playerFansNet };
}

/** 팬심 바닥(침몰선 정서) — 전 선수 잔류 의향에 가산되는 거부 보정 */
export const sinkingShipBias = (fan: number): number => (fan < 25 ? 0.08 : 0);
