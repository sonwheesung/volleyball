// 구단주 레이어 (OWNER_SYSTEM) — 선수 면담·감독 벤치 건의·인기/팬심. 순수 + 시드 결정론.
// 불만은 저장하지 않는다: FA 성향(faPref)과 현실의 불일치에서 그때그때 파생.
// 면담 결과만 로그로 저장(store) → FA 잔류/이탈 판정의 입력이 된다.

import type { Player } from '../types';
import { createRng, strSeed } from './rng';
import { prefWeightsOf } from './faMarket';
import { SEASON_DAYS } from './calendar';

// ─── 불만 (파생, 저장 없음) ───────────────────────────────────

export type DiscontentTopic = 'win' | 'minutes' | 'money' | 'hometown';

/** 선수가 코트에 못/안 나오는 사유 (ROTATION_MORALE B). 'rested'(#3 로드매니지먼트)는 구현·활성(data/rotation.ts restedOnDay). */
export type SitCause = 'starter' | 'injured' | 'suspended' | 'rested' | 'ownerBenched' | 'outclassed';
/** 선수 기분 (ROTATION_MORALE C) — 불만 / 무감정 / 긍정 */
export type Mood = 'discontent' | 'neutral' | 'positive';

export const SIT_CAUSE_KO: Record<SitCause, string> = {
  starter: '주전 출전', injured: '부상 결장', suspended: '징계 결장',
  rested: '체력 안배(휴식)', ownerBenched: '구단주 벤치 지시', outclassed: '주전 경쟁 밀림',
};

export interface DiscontentCtx {
  recentRankAvg: number;   // 팀 현 시즌 현재 순위(1=1위). ※호출처(data/owner.discontentNow)는 computeStandings(refDay)의 당해 순위를 넣는다 — "최근 2시즌 평균"은 미구현(F3 발견 2026-07-15)
  teamCount: number;
  playRatio: number;       // 시즌 누적 출전율 0..1(=출전경기/기대경기, C.4 정합). ※"최근 10경기"가 아님 — 창 슬라이딩 미구현(F13 발견 2026-07-15)
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
    { topic: 'hometown', weight: w.home, unmet: !p.isForeign && !!p.faPref?.preferredTeamId && p.faPref.preferredTeamId !== ctx.myTeamId }, // 외국인=연고 개념 없음(EC-DOM-01, 기존 세이브 게이트)
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

/** 감독 리더십 면담 성공률 보정 상한(STAFF §9.6-D) — 리더십 100이면 설득 확률 +0.06(소폭). leadership 50→0. */
export const LEADERSHIP_PERSUADE = 0.06;
export function leadershipPersuadeBonus(leadership: number): number {
  return LEADERSHIP_PERSUADE * Math.max(0, (leadership - 50) / 50);
}

/** 설득 판정 — 카드 매칭 + 구단 성적 보정 − 누적 실패 + 감독 리더십 소폭 보정(§9.6-D) */
export function persuade(
  playerId: string, season: number, nThisSeason: number,
  match: number,          // cardMatch 0..1
  perfT: number,          // 구단 성적 보정 0..1 (상위권일수록 말에 힘이 실림)
  failsBefore: number,    // 이 선수와의 누적 실패 횟수(시즌 무관)
  leadership = 50,        // 감독 리더십(0~100, STAFF §9.6-D) — 소폭 성공률 가산. 기본 50=무보정(byte-동일).
): boolean {
  const p = Math.max(0.1, Math.min(0.9, 0.35 + 0.4 * match + 0.1 * perfT - 0.15 * failsBefore + leadershipPersuadeBonus(leadership)));
  const rng = createRng(strSeed(`talk:${playerId}:${season}:${nThisSeason}`));
  return rng.next() < p;
}

/** 공약 파기 시 재계약 거부 가산 — 성공 면담의 −0.18 바이어스를 압도(배신은 칭찬보다 크게). OWNER_SYSTEM 1.3. */
export const PROMISE_BREACH_REFUSE = 0.5;
/** '주전 보장'(starter) 약속을 성공시킨 적이 있나 — 그 시즌. (파기 판정 = 이 약속 + 여전히 출전 불만) */
export function starterPromised(logs: InterviewLog[], season: number, playerId: string): boolean {
  return logs.some((l) => l.season === season && l.playerId === playerId && l.card === 'starter' && l.ok);
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

/** 감독 리더십 불만 축적 완화 상한(STAFF §9.6-D) — 리더십 100이면 누적 출전 불만을 20% 완화(소폭). leadership 50→0. */
export const LEADERSHIP_UNREST_RELIEF = 0.20;
export function leadershipUnrestFactor(leadership: number): number {
  return 1 - LEADERSHIP_UNREST_RELIEF * Math.max(0, (leadership - 50) / 50); // 50→1.0, 100→0.8
}

/** 누적 출전 불만 → 재계약 거부 가산 (ROTATION_MORALE C.4) — 시즌 내내 앉아있을수록(낮은 출전율) 정 떨어진다.
 *  출전 불만(topic==='minutes', 사유·성격·기대치 게이트를 통과한 진짜 불만)일 때만 가산. 부상 결장(불만 아님)은 무관.
 *  @param leadership 감독 리더십(0~100, STAFF §9.6-D) — 소폭 완화. 기본 50=무완화(byte-동일). */
export function sustainedBenchRefuse(playRatio: number, weight: number, leadership = 50): number {
  return Math.min(0.35, Math.max(0, 1 - playRatio) * 0.45 * weight * leadershipUnrestFactor(leadership));
}

// ── 재계약 오퍼 레버(FA §2.5c-격상, 2026-07-11) — 저연봉 오퍼 거부 가산 + 주전보장 완화. 공유 primitive. ──
// buildOwnerFx(data/owner)·resignOutlookNow가 이 두 순수 함수를 그대로 써 **미리보기=결과**를 자동 보장한다(재구현 금지).

/** 저연봉 재계약 오퍼 거부 가산 — 오퍼 연봉이 시장가(R0) 아래일수록, w.money에 비례해 거부↑.
 *  기존 money 문턱(`discontentOf`: salaryRatio<0.75 && w.money≥0.25)과 **독립 가산**: 비-money 아키타입도 w.money만큼
 *  반응해 '최저가+주전보장' 콤보의 공짜 락업(우회)을 막는다. salaryRatio ≥ R0(표준=시장가=1.0×)이면 **정확히 0**
 *  → 표준 오퍼·무오퍼 경로 0드리프트(bit-동일). K·R0는 밸런스 측정(`tools/_ms_resignfeedback.ts` ④)으로 고정. */
export const LOW_OFFER_R0 = 0.95;   // 이 배율(시장가 대비) 미만 오퍼부터 거부 가산 시작. 표준(1.0×)은 무가산.
export const LOW_OFFER_K = 2.0;     // 가산 계수(측정 고정 — 0.8× vs 1.0× 델타 단조·유의)
export function lowOfferRefuse(salaryRatio: number, wMoney: number): number {
  return LOW_OFFER_K * Math.max(0, wMoney) * Math.max(0, LOW_OFFER_R0 - salaryRatio);
}

/** 재계약 오퍼 '주전 보장' 레버 = **출전 불만(minutes) 완화량**. 완화 대상 = `refuseResignProb`의 minutes 기여 +
 *  `sustainedBenchRefuse`뿐 — **breach(파기)·lowOffer·비-minutes 불만엔 무영향**(채널 분리: 파기=기존 계약 flag의
 *  이번 시즌 배신, 완화=이번 오퍼 flag의 미래 약속. 보장→벤치→재보장 세탁 봉인).
 *  면담 starter 카드 하향(refuseBias<0)과 **합산 상한 `GUARANTEE_RELIEF_CAP`**(과완화·중복 하향 차단). 완화 후에도
 *  `MINUTES_RELIEF_FLOOR` 잔여 거부를 남긴다(약속=확정 잔류 금지). */
export const MINUTES_GUARANTEE_RELIEF = 0.25; // 오퍼 보장이 상쇄하는 출전 불만(원값)
export const GUARANTEE_RELIEF_CAP = 0.25;     // (면담 카드 하향 + 보장 완화) 합산 상한(≈−0.25급)
export const MINUTES_RELIEF_FLOOR = 0.05;     // 완화해도 남는 잔여 거부(약속 ≠ 확정 잔류)
export function guaranteeRelief(refuseBias: number): number {
  const cardRelief = Math.max(0, -refuseBias);  // 면담 성공 카드의 하향분(음수 refuseBias) — 이미 base에 반영됨
  return Math.max(0, Math.min(MINUTES_GUARANTEE_RELIEF, GUARANTEE_RELIEF_CAP - cardRelief));
}

// ─── 감독 벤치 건의 ───────────────────────────────────────────

export type BenchReason = 'noResign' | 'form' | 'prospect';

export const BENCH_REASON_KO: Record<BenchReason, string> = {
  noResign: '내년에 우리와 함께하지 않을 선수입니다',
  form: '최근 폼이 너무 떨어졌습니다',
  prospect: '유망주에게 기회를 주고 싶습니다',
};

/** 벤치 지시. fromDay = 적용 시작 매치데이(forward-only). toDay(옵셔널) = **마지막으로 유효한 날**(철회 종결일) —
 *  unbench가 삭제 대신 종결일을 박아 **이미 관전·기록한 경기의 라인업을 소급 변경하지 않는다**(A3, 서사 보존).
 *  없으면(=null) 아직 활성. 리플레이 필터는 `fromDay <= day <= (toDay ?? Infinity)`, 슬롯/중복/뉴스/표시는 `toDay==null`(활성)만. */
export interface BenchDirective { playerId: string; fromDay: number; toDay?: number }

/** 동시 벤치 지시 상한 — 전원 벤치 같은 악용 차단 */
export const BENCH_MAX = 2;

/**
 * 감독의 수락 판정 — 합리(대체자 격차)와 소신(리더십·에이스 보호) 사이.
 * @param ovrGapT   0..1 — 벤치 대상 vs 대체자 OVR 격차가 작을수록 1(수긍 쉬움)
 * @param aceRank   팀 내 OVR 순위(0=에이스)
 * ★ 감독 계수 = **leadership**(선수단 관리·건의 반응, STAFF §9.6-B/§9.6-D). Phase A~B는 matchOps(구 charisma 이관값)를
 *   임시 사용했으나 Phase D에서 leadership으로 이관 — 벤치/선발 건의는 "경기 운영"이 아니라 "선수단 장악"의 영역.
 */
const clampP = (v: number): number => Math.max(0.05, Math.min(0.95, v));

/** 벤치 건의 수락 확률(RNG 전, 결정론 입력만) — 수락 판정·거절 사유의 단일 출처(중복 수식 금지). @param leadership 감독 리더십(구 charisma→leadership 이관, §9.6-D). */
export function benchP(leadership: number, ovrGapT: number, aceRank: number, reason: BenchReason): number {
  const aceGuard = aceRank === 0 ? 0.4 : aceRank === 1 ? 0.2 : 0;
  const reasonT = reason === 'noResign' ? 0.2 : reason === 'form' ? 0.1 : 0.05;
  return clampP(0.5 + 0.3 * ovrGapT - aceGuard - 0.2 * ((leadership - 50) / 50) + reasonT);
}
export function benchAccept(
  playerId: string, season: number, day: number,
  leadership: number, ovrGapT: number, aceRank: number, reason: BenchReason,
): boolean {
  return createRng(strSeed(`bench:${playerId}:${season}:${day}`)).next() < benchP(leadership, ovrGapT, aceRank, reason);
}

/** 선발 기용 건의 수락 확률(RNG 전). @param gapT 건의 선수가 현 주전과 비등/우위일수록 1. @param leadership 감독 리더십(구 charisma→leadership 이관, §9.6-D). */
export function startP(leadership: number, gapT: number): number {
  return clampP(0.35 + 0.5 * gapT - 0.3 * ((leadership - 50) / 50));
}
export function startSuggestAccept(playerId: string, season: number, day: number, leadership: number, gapT: number): boolean {
  return createRng(strSeed(`start:${playerId}:${season}:${day}`)).next() < startP(leadership, gapT);
}

// ── 거절 사유 (OWNER §2.2 ★) — 고정 우선순위 금지. **실제 감점량이 가장 큰 요인** + p 게이팅. UI 반환용 ephemeral. ──
export type OwnerRejectReason = 'ace' | 'ability' | 'conviction' | 'coachCall' | 'postseason'; // postseason: 플옵 엔트리 동결(SEASON §5.0) — 성향 무관 무조건 거절
const GATE_P = 0.55;        // 이 이상이었는데 거절 = 시드 운 → 구조적 원인 없음 → coachCall
const MIN_SHORTFALL = 0.03; // 최대 감점이 이보다 작으면 "원인"이라 하기 미미 → coachCall
export function benchRejectReason(leadership: number, ovrGapT: number, aceRank: number, reason: BenchReason): OwnerRejectReason {
  if (benchP(leadership, ovrGapT, aceRank, reason) >= GATE_P) return 'coachCall';
  const ace = aceRank === 0 ? 0.4 : aceRank === 1 ? 0.2 : 0;   // 에이스 보호 감점
  const ability = 0.3 * (1 - ovrGapT);                          // 실력차(대체자와 벌어질수록↑) 감점
  const conviction = Math.max(0, 0.2 * ((leadership - 50) / 50)); // 감독 소신 감점(리더십>50만)
  const m = Math.max(ace, ability, conviction);
  if (m < MIN_SHORTFALL) return 'coachCall';
  return m === ace ? 'ace' : m === ability ? 'ability' : 'conviction';
}
export function startRejectReason(leadership: number, gapT: number): OwnerRejectReason {
  if (startP(leadership, gapT) >= GATE_P) return 'coachCall';
  const ability = 0.5 * (1 - gapT);
  const conviction = Math.max(0, 0.3 * ((leadership - 50) / 50));
  if (Math.max(ability, conviction) < MIN_SHORTFALL) return 'coachCall';
  return ability >= conviction ? 'ability' : 'conviction';
}

/** 빅매치 판정 — 보러 갈 이유. 상위권 맞대결이거나, 종반의 순위 직결 매치업 */
export function isBigMatch(myRank: number, oppRank: number, dayIndex: number, seasonEndDay = SEASON_DAYS): boolean {
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

/** 스타 방출의 팬 분노(OWNER_SYSTEM §3.2 — 설계엔 있었으나 fanScore에 누락됐던 항). 입력은 **안정 명성**
 *  (career·수상·근속 기반 인기 — 시즌 production 같은 휘발치 제외, 결정론). 무명 방출은 0, 프랜차이즈 레전드는 큰 타격.
 *  명성 범위 0~75(career 30·수상 30·근속 15) 기준 구간. TRANSACTION_SYSTEM 0.5③. */
export function releaseAngerPenalty(stature: number): number {
  if (stature < 30) return 0;   // 무명·신인 — 팬 무관심
  if (stature < 45) return 5;   // 중견
  if (stature < 60) return 10;  // 인기 스타
  return 16;                    // 프랜차이즈 레전드
}

/** 핵심·충성 동료 방출이 남은 선수단에 주는 동요(TRANSACTION_SYSTEM 0.5④) — 재계약 거부 확률에 더해지는 팀 단위 항.
 *  stature = 동료 명성(career·근속 기반, 0~45 — 수상·시즌 제외 / 매치 밸런스 불변, 호감도 경로만). 무명 방출은 0. 상한 0.25. */
export function releaseUnrestBias(statures: number[]): number {
  let u = 0;
  for (const s of statures) u += s >= 38 ? 0.10 : s >= 25 ? 0.06 : s >= 14 ? 0.03 : 0;
  return Math.min(0.25, u);
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
