// 구단주 레이어 셀렉터 (OWNER_SYSTEM) — 불만 파생·면담 대사·컨디션. UI와 store가 공유.
// 불만은 저장하지 않는다: FA 성향과 현실(순위·출전·연봉)의 불일치에서 그때그때 파생.

import type { Player, SeasonAwards, FAArchetype, Contract } from '../types';
import {
  discontentOf, moodOf, popularityOf, fanbase, playerFans, fanOverlapRatio,
  interviewEffects, refuseResignProb, sustainedBenchRefuse, sinkingShipBias,
  starterPromised, PROMISE_BREACH_REFUSE, releaseUnrestBias,
  lowOfferRefuse, guaranteeRelief, MINUTES_RELIEF_FLOOR,
  type DiscontentTopic, type Mood, type SitCause, type Fanbase, type InterviewLog, type OwnerFx,
} from '../engine/owner';
import { prefWeightsOf } from '../engine/faMarket';
import { affinity, pairKey } from '../engine/relationships';
import { relationBonds } from './relationships';
import { SEASON_DAYS } from '../engine/calendar';
import { buildLineup } from '../engine/lineup';
import { overall } from '../engine/overall';
import { marketValue, resignOptions } from '../engine/salary';
import { salaryEraNow, marketVal } from './awardSalary';
import { formFactor, formGrade } from '../engine/form';
import { awardHistoryOf } from './awards';
import { computeStandings } from './standings';
import { leagueProduction, getPlayerProduction } from './production';
import { formFactorOnDay, rosterIdsOnDay, seasonScandals, injuredOnDay, suspendedOnDay, availableTeamPlayers, getTxContext } from './dynamics';
import { restedOnDay } from './rotation';
import { SCANDAL_POP_FACTOR } from '../engine/scandal';
import { evolveOnDay, coachDvPhilosophyOf, coachLeadershipOf } from './league';

const GAME_EVERY = 4.6;
const SEASON_END_DAY = SEASON_DAYS;

/** 선수가 코트에 못/안 나오는 사유 판정 (ROTATION_MORALE B) — 부상·징계·구단주벤치·실력밀림·주전.
 *  'rested'(#3 휴식)는 restedOnDay로 구현·활성(아래 반영). 실제 경기 라인업(availableTeamPlayers→buildLineup)과 일치. */
export function benchCauseOf(p: Player, myTeamId: string, day: number): SitCause {
  const d = day > 0 ? day : 0;
  if (injuredOnDay(d).has(p.id)) return 'injured';
  if (suspendedOnDay(d).has(p.id)) return 'suspended';
  const avail = availableTeamPlayers(myTeamId, d);
  if (!avail.some((x) => x.id === p.id)) return 'ownerBenched'; // 부상·징계 아닌데 가용 명단 밖 = 벤치 지시
  const rest = restedOnDay(myTeamId, d); // 로드매니지먼트(#3) — 순위 굳어 감독이 쉬게 한 선수
  if (rest.has(p.id)) return 'rested';
  const lu = buildLineup(avail.filter((x) => !rest.has(x.id)), coachDvPhilosophyOf(myTeamId, d)); // 휴식 제외 실제 출전 라인업(육성 철학 U23 에지 §9.6-D — match와 일치)
  const starters = new Set<string>([...lu.six.map((x) => x.id), ...(lu.libero ? [lu.libero.id] : [])]);
  return starters.has(p.id) ? 'starter' : 'outclassed';
}

const EXPECT_GAP = 9; // 동포지션 최약 주전보다 OVR 이만큼 아래면 '아직 못 뛴다'고 받아들임(기대치≈0)

/** 주전 기대치 0..1 — 동포지션 최약 주전과의 OVR 격차 + 경력. 약체 후보(기대치≈0)는 벤치를 당연히 받아들임.
 *  → 사용자 지적: OVR 낮고 경력 짧은 선수가 출전율만 낮다고 불만 품는 비현실 차단. */
export function expectsPlayOf(p: Player, myTeamId: string, day: number): number {
  const d = day > 0 ? day : 0;
  const avail = availableTeamPlayers(myTeamId, d);
  const lu = buildLineup(avail, coachDvPhilosophyOf(myTeamId, d)); // 육성 철학 U23 에지(§9.6-D)
  const starters = [...lu.six, ...(lu.libero ? [lu.libero] : [])].filter((s) => s.position === p.position);
  if (!starters.length) return 0.5;
  const weakest = Math.min(...starters.map((s) => overall(s)));
  let e = Math.max(0, Math.min(1, 1 - (weakest - overall(p)) / EXPECT_GAP)); // 양수 격차=내가 더 약함→기대↓
  if (p.career.seasons >= 6) e = Math.max(e, 0.5); // 베테랑은 역할 기대
  if (p.career.seasons <= 1) e *= 0.5;             // 신인은 배우는 자세(기대↓)
  // 주전 보장 레버 대가(FA_SYSTEM §2.8 Phase2) — '주전 보장'으로 데려온 선수는 OVR·경력과 무관하게 주전을 기대한다.
  //   → 벤치 시 minutesGrievance가 확실히 발화(무명에게 주전 약속하고 앉히는 공짜 회피 차단). 미보장=undefined면 무변(0드리프트).
  if (p.contract.starterGuarantee) e = 1;
  return e;
}

/** 사유+기분 → UI 한 줄(선수가 자기 상황을 어떻게 받아들이는가) */
function moodLabel(cause: SitCause, mood: Mood, topic: DiscontentTopic | null): string {
  if (mood === 'discontent') {
    if (topic === 'minutes') return cause === 'ownerBenched' ? '구단주 벤치 — 출전 불만' : '주전 경쟁서 밀림 — 출전 불만';
    if (topic === 'win') return '우승 갈망 — 성적 불만';
    if (topic === 'money') return '연봉 불만';
    return '연고 향수 — 고향 팀 그리움';
  }
  if (mood === 'positive') return '주전 활약 — 만족';
  switch (cause) { // neutral(무감정) — 사유별 받아들임
    case 'injured': return '부상 결장 — 묵묵히 복귀 준비';
    case 'suspended': return '징계 결장 — 자숙 중';
    case 'rested': return '체력 안배 — 관리 양해';
    case 'outclassed': return '주전 경쟁 — 묵묵히 준비';
    default: return '특별한 동요 없음';
  }
}

/** 선수의 현재 마음 — 사유(왜 벤치인가)+성격으로 불만/무감정/긍정 + 면담용 주제·가중. 시즌 진행 시점(day) 기준 */
export function discontentNow(
  p: Player, myTeamId: string, day: number,
  overrides?: Record<string, Contract>, // 대기 중 인시즌 재계약(§2.5c D안 2단계) — 있으면 그 연봉으로 money 불만 재평가
): { topic: DiscontentTopic | null; weight: number; mood: Mood; cause: SitCause; label: string; playRatio: number } {
  // 시즌 시작 전(day≤0, 구단 선택·온보딩 currentDay=0)은 경기가 0 → 불만의 근거(출전율·성적)가 없다.
  // 여기서 옛 폴백은 refDay=MAX였는데, computeStandings(MAX)·leagueProduction(MAX)가 '전 시즌 미래 경기'를
  // 통째로 시뮬(콜드 ~844ms/dev, 폰 ~15s) — ① 첫 선수 상세만 15s 멈춤 ② 안 치른 경기 스포일러.
  // popularityNow의 day-guard(day>0?day:-1)와 같은 취지로, 무거운 셀렉터 호출 전에 중립(불만 없음)으로 단락.
  // ※ MAX→-1로만 바꾸면 prod undefined→playRatio=0→모든 선수 '안 뛰어서 불만' 오탐이 되므로 중립 리턴이 정답.
  // ★ 성능(2026-07-07): benchCauseOf조차 부르면 안 된다 — benchCauseOf→restedOnDay→computeStandings(0)이
  //   콜드 시즌 시뮬(폰 ~15s)을 트리거해 온보딩 첫 선수 상세가 얼어붙는다(콜드 측정으로 확인, 워밍 후 측정은 캐시에
  //   가려 0.28ms 허위 PASS였음). 프리게임은 경기가 0 → 벤치 상황 자체가 없으므로 사유를 '계산'하지 말고
  //   중립 상수 'starter'(벤치 이슈 없음)를 그대로 반환한다. moodLabel은 순수 문자열 맵이라 값싸다.
  if (day <= 0) {
    const cause: SitCause = 'starter'; // 프리게임=경기0=벤치 상황 없음. 시뮬 유발 함수 호출 금지(콜드 15s freeze)
    return { topic: null, weight: 0, mood: 'neutral', cause, label: moodLabel(cause, 'neutral', null), playRatio: 1 };
  }
  const refDay = day > 0 ? day : Number.MAX_SAFE_INTEGER;
  const standings = computeStandings(refDay);
  const rank = Math.max(1, standings.findIndex((s) => s.teamId === myTeamId) + 1);
  const prod = leagueProduction(refDay).get(p.id);
  const games = Math.max(1, Math.round((day > 0 ? day : SEASON_END_DAY) / GAME_EVERY));
  const playRatio = Math.min(1, (prod?.matches ?? 0) / games);
  const cause = benchCauseOf(p, myTeamId, day);
  const ctx = {
    recentRankAvg: rank,
    teamCount: standings.length,
    playRatio,
    // money 불만은 **대기 중 override(인시즌 재계약) 연봉이 있으면 그 값**으로 평가(§2.5c D안 2단계) — '후하게'가 연봉
    //   불만을 실제로 풀고 '짧게'(−15%)는 불씨를 남긴다. override 없으면 현재 계약 연봉(기존). win/minutes/hometown 불만은 무영향(돈 면역).
    salaryRatio: (overrides?.[p.id]?.salary ?? p.contract.salary) / Math.max(1, marketValue(p, salaryEraNow())),
    myTeamId,
    sitCause: cause,
    expectsPlay: expectsPlayOf(p, myTeamId, day),
  };
  const topic = discontentOf(p, ctx);
  const mood = moodOf(ctx, topic);
  const w = prefWeightsOf(p);
  const weight = !topic ? 0 : topic === 'win' ? w.win : topic === 'minutes' ? w.play : topic === 'money' ? w.money : w.home;
  return { topic, weight, mood, cause, label: moodLabel(cause, mood, topic), playRatio };
}

// 인간관계 재계약 계수(RELATIONSHIP §3.2 — 은은하게)
const REL_LEAVE_K = 0.15;  // 친한 동료 방출 1명당 거부 가산(affinity×) — 절친(0.7)≈+0.10

/** 시즌말 FA 판정용 ownerFx 조립 — store.endSeason과 FA/드래프트 센터 미리보기가 공유(미리보기=결과) */
export function buildOwnerFx(
  interviews: InterviewLog[], season: number, myTeamId: string, fanScore: number,
  overrides: Record<string, Contract> = {}, // 대기 중 인시즌 재계약(§2.5c D안 2단계) — money 불만 재평가에 반영. 6개 호출처 동일 전달 = 미리보기=결과.
): OwnerFx {
  const fx = interviewEffects(interviews, season);
  const refuseProb: Record<string, number> = {};
  // 핵심·충성 동료 방출 → 남은 선수단 동요(TRANSACTION_SYSTEM 0.5④). 이번 시즌 내 방출자의 명성(career·근속)으로 팀 단위 거부 가중.
  const releasedTx = getTxContext().playerTx.filter((t) => t.kind === 'release' && t.teamId === myTeamId);
  const releasedStatures = releasedTx.map((t) => { const rp = evolveOnDay(t.playerId, SEASON_END_DAY); return rp && !rp.isForeign ? popularityOf(rp.career.points, 0, rp.clubTenure, 0) : 0; });
  const unrest = releaseUnrestBias(releasedStatures);
  // 인간관계(RELATIONSHIP §3.2): 친한 동료 방출 → 그 친구만 거부↑(uniform unrest 위에 가산).
  //  "친구 잔류 → 거부↓"는 별도 항을 안 둔다 — 만료자가 FA로 풀리면 Phase 2 FA 시장의 relT(내 팀 친구)가 재계약 확률을 올려 자연 처리.
  const bonds = relationBonds();
  const releasedPlayers = releasedTx.map((t) => evolveOnDay(t.playerId, SEASON_END_DAY)).filter((rp): rp is Player => !!rp && !rp.isForeign);
  for (const id of rosterIdsOnDay(myTeamId, SEASON_END_DAY)) {
    const p = evolveOnDay(id, SEASON_END_DAY);
    if (!p || p.contract.remaining > 1) continue; // 이번 오프시즌 만료자만 거부권 행사
    const { topic, weight, playRatio } = discontentNow(p, myTeamId, SEASON_END_DAY, overrides);
    // 누적(C.4): 시즌 내내 부당하게 앉아있던 만큼(낮은 출전율) 정 떨어져 거부↑. 출전 불만일 때만. 리더십 소폭 완화(§9.6-D).
    const accum = topic === 'minutes' ? sustainedBenchRefuse(playRatio, weight, coachLeadershipOf(myTeamId, SEASON_END_DAY)) : 0;
    // 공약 파기(OWNER_SYSTEM 1.3 · FA_SYSTEM §2.8 Phase2): '주전 보장' 약속(면담 카드 OR FA 오퍼 레버)을 했는데
    //   여전히 출전 불만(=벤치) → 배신. 거부 급등(성공 보정 상쇄+α). FA 보장은 계약 flag(p.contract.starterGuarantee)가
    //   두 번째 출처 — faOffers가 오프시즌 후 비워져도 계약에 남아 이후 시즌 벤치까지 파기를 물린다. 미보장=undefined면 무변.
    // 파기(breach) 채널 = **기존 계약**의 주전보장(이번 시즌 배신) — 면담 카드 OR p.contract.starterGuarantee. 이번 오퍼로 세탁 불가.
    const promisedStarter = starterPromised(interviews, season, id) || !!p.contract.starterGuarantee;
    const breach = topic === 'minutes' && promisedStarter ? PROMISE_BREACH_REFUSE : 0;
    // 방출된 친한 동료(positive affinity)만큼 추가 동요(+) — 절친 방출일수록 강하게.
    let friendLeave = 0;
    for (const rp of releasedPlayers) friendLeave += Math.max(0, affinity(p, rp, bonds[pairKey(id, rp.id)] ?? 0, false));
    const relTerm = REL_LEAVE_K * friendLeave;
    const refuseBias = fx.refuseBias[id] ?? 0;
    // 오퍼 레버(FA §2.5c-격상, resignOutlookNow와 **공유 primitive** — 미리보기=결과). 대기 중 override(이번 오퍼)에만 반응.
    //   저연봉 가산(lowOfferRefuse) + 주전보장 완화(guaranteeRelief). 무오퍼·표준(1.0×·보장off)이면 둘 다 0 → 전후 bit-동일(0드리프트).
    const offer = overrides[id];
    let lowRefuse = 0, relief = 0;
    if (offer) {
      const mkt = marketVal(p, getPlayerProduction(id, SEASON_END_DAY));
      lowRefuse = lowOfferRefuse(offer.salary / Math.max(1, mkt), prefWeightsOf(p).money);
      // 완화 채널 = **이번 오퍼**의 주전보장(override.starterGuarantee) — minutes 불만만 완화(breach는 위 기존 계약 flag, 무관).
      if (topic === 'minutes' && offer.starterGuarantee) relief = guaranteeRelief(refuseBias);
    }
    let prob: number;
    if (relief > 0) {
      // 완화는 minutes 기여(refuseResignProb+accum)에만. breach·팀단위 항(sinking/unrest/relTerm)·lowRefuse는 불변. 잔여 하한 유지.
      const relaxed = Math.max(MINUTES_RELIEF_FLOOR, refuseResignProb(topic, weight, refuseBias) + accum - relief);
      prob = relaxed + sinkingShipBias(fanScore) + breach + unrest + relTerm + lowRefuse;
    } else {
      // relief 0·lowRefuse 0(무오퍼/표준)이면 `+ 0.0`이라 기존 식과 bit-동일.
      prob = refuseResignProb(topic, weight, refuseBias) + sinkingShipBias(fanScore) + accum + breach + unrest + relTerm + lowRefuse;
    }
    if (prob > 0) refuseProb[id] = Math.min(0.95, prob);
  }
  return { refuseProb, offerBias: fx.offerBias };
}

/** 면담 장면에서 선수가 하는 말 */
export const TOPIC_SPEECH: Record<DiscontentTopic, string> = {
  win: '"구단주님, 저는 우승이 하고 싶습니다. 지금 우리 순위로는…"',
  minutes: '"주전으로 뛰고 싶습니다. 기회만 주시면 증명하겠습니다."',
  money: '"제 가치를 인정받고 싶습니다. 시장은 저를 다르게 평가합니다."',
  hometown: '"고향 팀에서 뛰는 게 오랜 꿈이었습니다."',
};

export const TOPIC_BADGE: Record<DiscontentTopic, string> = {
  win: '우승 갈망', minutes: '출전 불만', money: '연봉 불만', hometown: '연고 향수',
};

/** 재계약 잔류 전망(계약 관리 UI — FA §2.5c-보완 3단계). **엔진 산출 위임**: `discontentNow(currentDay)` + `refuseResignProb`
 *  + 누적/공약파기 가산항(`buildOwnerFx`와 동일 primitive)을 그대로 재사용해 **재구현이 아니라 조립**한다.
 *  ★ 시즌 종료(SEASON_END_DAY) 파생을 시즌 중 부르면 미래 경기 시뮬(스포일러·콜드 수초)이라, 여기선 **currentDay** 입력만 쓴다
 *    → 팀단위 SEASON_END_DAY 항(친구 방출 unrest·침몰선 sinkingShip)은 제외(그건 시즌말 확정 시 반영). 표시엔 "시즌 종료 시 확정" 캡션 필수.
 *  overrides = 대기 중 인시즌 재계약 연봉(§2.5c-보완 ② — '후하게'가 money 불만을 실제로 풀어 전망을 낮춤). */
export type ResignBand = 'stable' | 'fluid' | 'risk';
export interface ResignOutlook { prob: number; band: ResignBand; topic: DiscontentTopic | null; chips: string[] }
export function resignOutlookNow(
  p: Player, myTeamId: string, day: number,
  interviews: InterviewLog[], season: number,
  overrides?: Record<string, Contract>,
): ResignOutlook {
  const { topic, weight, playRatio } = discontentNow(p, myTeamId, day, overrides);
  const fx = interviewEffects(interviews, season);
  const refuseBias = fx.refuseBias[p.id] ?? 0;
  const accum = topic === 'minutes' ? sustainedBenchRefuse(playRatio, weight, coachLeadershipOf(myTeamId, day)) : 0; // 리더십 소폭 완화(§9.6-D)
  // 파기(breach) 채널 = **기존 계약**의 주전보장(이번 시즌 배신) — 이번 오퍼로 세탁 불가(채널 분리).
  const promisedStarter = starterPromised(interviews, season, p.id) || !!p.contract.starterGuarantee;
  const breach = topic === 'minutes' && promisedStarter ? PROMISE_BREACH_REFUSE : 0;
  // 오퍼 레버(FA §2.5c-격상) — buildOwnerFx와 **공유 primitive**(미리보기=결과). 이번 오퍼(override)에만 반응.
  //   무오퍼·표준(1.0×·보장off)이면 lowRefuse·relief 둘 다 0 → `+ 0.0`이라 기존 식과 bit-동일(0드리프트).
  const offer = overrides?.[p.id];
  let lowRefuse = 0, relief = 0;
  if (offer) {
    const mkt = marketVal(p, getPlayerProduction(p.id, day));
    lowRefuse = lowOfferRefuse(offer.salary / Math.max(1, mkt), prefWeightsOf(p).money);
    // 완화 채널 = **이번 오퍼**의 주전보장(override.starterGuarantee). minutes 불만만 완화(breach 무관).
    if (topic === 'minutes' && offer.starterGuarantee) relief = guaranteeRelief(refuseBias);
  }
  const minutesPortion = refuseResignProb(topic, weight, refuseBias) + accum;
  const relaxed = relief > 0 ? Math.max(MINUTES_RELIEF_FLOOR, minutesPortion - relief) : minutesPortion;
  const prob = Math.min(0.95, relaxed + breach + lowRefuse);
  const band: ResignBand = prob >= 0.45 ? 'risk' : prob >= 0.15 ? 'fluid' : 'stable';
  const chips: string[] = [];
  if (topic) chips.push(TOPIC_BADGE[topic]);          // 불만 주제(연봉/출전/우승/연고)
  if (breach > 0) chips.push('주전 공약 파기');        // 주전 보장 약속 후 벤치 = 배신(거부 급등)
  if (relief > 0) chips.push('주전보장 약속');          // 이번 오퍼의 주전보장이 출전 불만을 달램(완화)
  if (lowRefuse > 0.01) chips.push('저연봉 제안');      // 시장가 아래 오퍼 = 거부 가산(레버 대가)
  if (accum > 0.12) chips.push('출전 누적 불만');       // 시즌 내내 묵힌 출전 불만
  if (refuseBias > 0.01) chips.push('면담 역효과');     // 실패 면담이 정을 떨어뜨림
  else if (refuseBias < -0.01) chips.push('면담으로 달램'); // 성공 면담이 마음을 붙잡음
  return { prob, band, topic, chips };
}

// ── 재계약 오퍼 프리뷰·피드백(FA §2.5c-격상, 2026-07-11) — 엔진 위임(resignOutlookNow 재사용, 재구현 아님) ──

/** 재계약 3택 각 옵션의 잔류 전망(밴드) — 옵션 계약을 override로 `resignOutlookNow`에 넣어 산출.
 *  UI는 이 셀렉터만 부른다(옵션별 밴드 재구현 금지 — 가드 _dv_resignfeedback ①이 동일성 A/B로 봉인). */
export interface ResignOptionOutlook { key: 'standard' | 'generous' | 'short'; label: string; salary: number; years: number; note: string; outlook: ResignOutlook }
export function resignOptionOutlooks(
  p: Player, market: number, myTeamId: string, day: number,
  interviews: InterviewLog[], season: number,
): ResignOptionOutlook[] {
  return resignOptions(p, market).map((o) => {
    const ov: Record<string, Contract> = { [p.id]: { salary: o.salary, years: o.years, remaining: o.years, signedAtAge: p.age } };
    return { key: o.key, label: o.label, salary: o.salary, years: o.years, note: o.note, outlook: resignOutlookNow(p, myTeamId, day, interviews, season, ov) };
  });
}

/** 선수 단위 캡션 3분기(step2) — 불만 topic으로 갈린다. money만 옵션으로 갈리므로 옵션별 밴드를 보여주고,
 *  비-money는 "돈 문제 아님"+면담 유도, 무불만은 면담 유도 금지(무불만자 면담=역효과, OWNER 1.2). */
export type ResignCaptionKind = 'noGrievance' | 'nonMoney' | 'money';
export function resignCaptionOf(topic: DiscontentTopic | null): { kind: ResignCaptionKind; text: string; talkPrompt: boolean } {
  if (!topic) return { kind: 'noGrievance', text: '어떤 조건이든 마음은 같습니다 — 조건보다 팀을 봅니다.', talkPrompt: false };
  if (topic === 'money') return { kind: 'money', text: '연봉이 마음에 걸립니다 — 오퍼에 따라 잔류 전망이 갈립니다.', talkPrompt: false };
  return { kind: 'nonMoney', text: `연봉의 문제가 아닙니다 — ${TOPIC_BADGE[topic]}. 면담으로 마음을 들여다보세요.`, talkPrompt: true };
}

/** 제안 직후 결과 반응(step3) — 밴드별 대사. '안정'도 과약속 금지("마음이 기울어" 톤). 최종은 시즌말 확정.
 *  before/after 밴드가 갈리면 전→후를, 안 갈리면 "조건이 마음을 바꾸진 않았다"를. moved=밴드 변화 여부. */
const BAND_REACT: Record<ResignBand, string> = {
  stable: '마음이 우리 쪽으로 기울어 있습니다.',
  fluid: '고민이 남아 있습니다 — 아직 확답은 이릅니다.',
  risk: '표정이 밝지 않습니다 — 시장을 살필 눈치입니다.',
};
export function resignReactionCopy(before: ResignBand, after: ResignBand): { line: string; moved: boolean; remind: string; framing: string } {
  const moved = before !== after;
  const BAND_KO: Record<ResignBand, string> = { stable: '안정', fluid: '유동', risk: '위험' };
  const line = moved
    ? `조건이 마음을 움직였습니다 — 전망이 ${BAND_KO[before]}에서 ${BAND_KO[after]}(으)로 바뀌었습니다. ${BAND_REACT[after]}`
    : `${BAND_REACT[after]} (조건이 마음을 바꾸진 않았습니다.)`;
  return { line, moved, remind: '최종 결정은 시즌 종료 시 내려집니다.', framing: '재계약은 한 시즌을 건 약속입니다.' };
}

/** 선수 성격(FA 동기 아키타입) 표시 라벨 + 벤치 태도 설명 — "왜 이 마음인지" 가독성용(OWNER_SYSTEM).
 *  화면에 성격을 드러내 "얘는 충성형이라 백업도 수용 / 출전형이라 벤치에 민감"이 한눈에 보이게. */
export const ARCHETYPE_KO: Record<FAArchetype, { label: string; emoji: string; note: string }> = {
  money:    { label: '연봉 중시', emoji: '💰', note: '보상이 1순위 — 대우만 맞으면 역할은 받아들이는 편.' },
  winnow:   { label: '우승 갈망', emoji: '🏆', note: '우승이 1순위 — 강팀이라면 벤치도 감수한다.' },
  loyal:    { label: '팀 충성', emoji: '🤝', note: '소속감이 1순위 — 팀에 헌신하며 백업도 묵묵히 받아들인다.' },
  minutes:  { label: '출전 갈망', emoji: '🔥', note: '코트가 1순위 — 어디서든 주전을 원한다. 주전급인데 벤치면 불만이 크다.' },
  hometown: { label: '연고 애착', emoji: '🏠', note: '연고가 1순위 — 역할보다 어디서 뛰는지를 더 본다.' },
};

// 표시용 성격 — 외국인/아시아쿼터는 연고(hometown) 개념이 없다(EC-DOM-01). 새 선수는 생성 단계(rollFAPref)에서
// hometown을 안 받지만, 기존 세이브엔 박혀 있을 수 있어 읽는 쪽에서도 매핑(외국인 hometown→winnow: 우승 갈망 용병).
export function effectiveArchetypeOf(p: Player): FAArchetype {
  const a = p.faPref?.archetype ?? 'money';
  return p.isForeign && a === 'hometown' ? 'winnow' : a;
}

/** 선수 인기(0~100) — 통산·수상·근속·올해 활약에서 파생. 이번 시즌 사고 치면 팬이 떠난다(×0.6) */
export function popularityNow(p: Player, day: number, archive: { season: number; awards?: SeasonAwards }[]): number {
  // 시즌 시작 전(day≤0)은 올해 경기가 0 → 현시즌 생산 0(통산·수상·근속만으로 인기). 구 폴백은 MAX(전 시즌 전체
  // 시뮬)라 ① 안 치른 경기 스포일러 ② 콜드 ~2.8s(폰 15s, 구단 선택 플로우 선수 화면). −1=빈 구간(생산 가드)로 즉시.
  const prod = leagueProduction(day > 0 ? day : -1).get(p.id);
  const pop = popularityOf(p.career.points, awardHistoryOf(archive, p.id).length, p.clubTenure, prod?.points ?? 0);
  // 사건·사고 페널티는 시즌 진행 중에만 — seasonScandals()는 dyn()(전 시즌 재생)을 타므로 시작 전(day≤0)엔
  // 부르지 않는다(시작 전 사고 0). 안 그러면 생산 가드를 해도 여기서 콜드 시뮬이 돈다(2026-06-28).
  const scandaled = day > 0 && seasonScandals().some((s) => s.playerId === p.id);
  return scandaled ? Math.round(pop * SCANDAL_POP_FACTOR) : pop;
}

/** 구단 팬덤(명) — 팀팬 + 선수팬 − 겹침. top: 팬 많은 선수 3인(개인 팬·겹침 비율) */
export function teamFanbaseNow(
  teamId: string, day: number, fan: number,
  archive: { season: number; awards?: SeasonAwards }[],
): Fanbase & { top: { name: string; fans: number; overlap: number }[] } {
  const roster = rosterIdsOnDay(teamId, day)
    .map((id) => evolveOnDay(id, day))
    .filter((p): p is Player => !!p);
  const entries = roster.map((p) => ({ p, pop: popularityNow(p, day, archive) }));
  const fb = fanbase(teamId, fan, entries.map((e) => ({ pop: e.pop, tenure: e.p.clubTenure })));
  const top = entries
    .map((e) => ({ name: e.p.name, fans: playerFans(e.pop), overlap: fanOverlapRatio(e.p.clubTenure) }))
    .sort((a, b) => b.fans - a.fans)
    .slice(0, 3);
  return { ...fb, top };
}

/** 컨디션(경기감각) — 점 색·라벨. factor는 formFactorOnDay 결과 */
export function conditionOf(teamId: string, playerId: string, day: number): { factor: number; grade: ReturnType<typeof formGrade>; color: string; label: string } {
  const factor = day > 0 ? formFactorOnDay(teamId, playerId, day) : formFactor(1, 1);
  const grade = formGrade(factor);
  return {
    factor, grade,
    color: grade === 'sharp' ? '#4ade80' : grade === 'dull' ? '#fbbf24' : '#f87171',
    label: grade === 'sharp' ? '경기감각 좋음' : grade === 'dull' ? '감각 살짝 무뎌짐' : '실전 감각 녹슮',
  };
}
