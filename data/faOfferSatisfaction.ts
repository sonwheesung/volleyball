// FA 오퍼 "선수 만족도" 셀렉터 (FA_SYSTEM §2.8.4 Phase 4) — 순수 UI 셀렉터. 엔진 무변경.
//
// 목적: FA 센터 오퍼 폼에서, 내 오퍼(연봉/연수/주전보장)에 대해 선수가 얼마나 끌리는지를 **실시간 표시**한다.
//   경쟁 입찰이라 단일 acceptProb는 승률이 아니다(§2.8.1 ②) → 라벨은 "선수 만족도"(내 오퍼 단독 수락 성향).
//
// 허위 오라클 방지(§2.8.4 검증): 만족도 표시 경로는 엔진 `offerScore`→`acceptProb`에 **그대로 위임**한다
//   (S곡선·가중합을 UI가 재구현하지 않음). OfferCtx 재료(teamOvr·posGap·isOriginal·asking·relT…)는
//   `resolveFAMarket`이 내 팀 오퍼에 쓰는 것과 **동일 소스**(pre-FA base.off 스냅샷/로스터·prestige·prevTeamOf·ownerFx·bonds)에서 뽑는다.
//   rand는 표시용 0.5 고정(±0.05 rand 항의 중앙값) — 실제 시장 해소는 엔진의 순차 rng 그대로.

import type { FAOffer, FAWeights, Player } from '../types';
import { acceptProb, askingPrice, offerScore, prefWeightsOf, type FAGrade, type OfferCtx } from '../engine/faMarket';
import { isFranchise, maxSalaryFor, LEAGUE_CAP } from '../engine/cap';
import { positionGap } from '../engine/aiGM';
import { teamOverall } from '../engine/overall';
import { marketVal } from './awardSalary';
import { teamAffinityFor } from './offseason';

/** 결정론 표시용 rand(중앙값) — offerScore의 0.05·rand 항을 중앙(0.5)으로 고정해 만족도가 흔들리지 않게. */
export const DISPLAY_RAND = 0.5;

// 아래 상수는 `data/offseason.ts`의 내 팀 오퍼 산식(`AGGRESSIVE_MULT` + `resolveFAMarket`의 asking/auto-offer 산식)과 동일값(단일 소스 미러).
//   (스테일 라인번호 :92~93·:229~232 → 심볼 참조로 정정, 발견 모드 감사 2026-07-15.)
//   'auto' 오퍼 연봉을 표시할 때만 쓰인다(폼에서 명시 연봉을 넣으면 그 숫자를 사용). 값이 어긋나면 안 됨.
const AGGRESSIVE_MULT = 1.2; // 내 팀 'auto' 공격적 배수 (offseason.ts AGGRESSIVE_MULT)
const round100 = (x: number) => Math.round(x / 100) * 100;

/** 만족도 계산에 필요한 입력(스토어 슬라이스+메모된 base에서 조립) */
export interface MyOfferInputs {
  player: Player;                      // pre-FA 스냅샷 선수(base.off.snapshot[id])
  myTeam: string;
  snapshot: Record<string, Player>;    // base.off.snapshot (roster OVR·relT get 소스)
  myRosterIds: string[];               // base.off.rosters[myTeam] (pre-FA)
  prevTeamOf: Record<string, string>;  // base.prevTeamOf
  prestige: number;                    // base.prestige[myTeam] ?? 0
  grade: FAGrade;
  repMult: number;                     // scandalRepMap 할인(요구연봉) — 없으면 1
  offer: FAOffer;                      // (draft) 오퍼 레버
  talkBias?: number;                   // ownerFx.offerBias[id] (내 팀 면담 보정)
  bonds: Record<string, number>;       // relationBonds()
}

/** 요구 연봉(엔진 `resolveFAMarket`의 asking 산식과 동일: `round100(askingPrice(marketVal, grade) × 평판할인)`) */
export function askingFor(inp: Pick<MyOfferInputs, 'player' | 'grade' | 'repMult'>): number {
  return round100(askingPrice(marketVal(inp.player), inp.grade) * inp.repMult);
}

/** 내 오퍼 제시 연봉 — 엔진 `resolveFAMarket`의 내 팀 offer 산식 미러('auto'=asking×(공격적?1.2:1), 숫자=round100(max0)). */
export function resolveMyOfferSalary(offer: FAOffer, asking: number): number {
  if (typeof offer.salary === 'number') return round100(Math.max(0, offer.salary));
  return round100(asking * (offer.aggressive ? AGGRESSIVE_MULT : 1));
}

/** 내 팀 오퍼의 OfferCtx — resolveFAMarket이 내 팀(isMe) 입찰에 넣는 것과 동일 재료(rand=0.5 표시 고정). */
export function buildMyOfferCtx(inp: MyOfferInputs): OfferCtx {
  const asking = askingFor(inp);
  const offerSalary = resolveMyOfferSalary(inp.offer, asking);
  const get = (id: string) => inp.snapshot[id];
  const teamOvr = teamOverall(inp.myRosterIds.map(get).filter((p): p is Player => !!p));
  const gap = positionGap(inp.myRosterIds, get)[inp.player.position];
  const isOriginal = inp.prevTeamOf[inp.player.id] === inp.myTeam;
  return {
    teamOvr,
    prestige: inp.prestige,
    posGap: gap,
    isOriginal,
    isFranchise: isFranchise(inp.player) && isOriginal,
    isPreferred: inp.player.faPref?.preferredTeamId === inp.myTeam,
    offerSalary,
    asking,
    w: prefWeightsOf(inp.player),
    rand: DISPLAY_RAND,
    talkBias: inp.talkBias,
    relT: teamAffinityFor(inp.player, inp.myRosterIds, get, inp.bonds),
    years: inp.offer.years,
    starterGuarantee: inp.offer.starterGuarantee,
    promises: inp.offer.promises,
  };
}

export interface OfferSatisfaction { asking: number; offer: number; score: number; prob: number }

/** 실시간 만족도 — 엔진 offerScore→acceptProb에 위임(허위 오라클 방지). prob∈[0,1]. */
export function offerSatisfaction(inp: MyOfferInputs): OfferSatisfaction {
  const ctx = buildMyOfferCtx(inp);
  const score = offerScore(ctx);
  return { asking: ctx.asking, offer: ctx.offerSalary, score, prob: acceptProb(score) };
}

// ─── 성향 별점 (§2.8.4 ①) ───

/** 가중치→★ 매핑: 지배 동기(~0.42~0.55)→★4~5, 옅은 동기(~0.05~0.15)→★1. 절대 매핑(선수 간 비교 가능). */
export const STAR_STEP = 0.11;
export function starsFromWeight(w: number): number {
  return Math.max(1, Math.min(5, Math.round(w / STAR_STEP)));
}

/** 성향 별점 5축(선수-대면 라벨). loyalty=원소속 잔류 성향("의리"). rel(인간관계)은 행의 친구/라이벌 배지로 별도 노출. */
export const PREF_STAR_AXES: { key: keyof FAWeights; label: string }[] = [
  { key: 'money', label: '돈' },
  { key: 'win', label: '우승' },
  { key: 'play', label: '출전' },
  { key: 'loyalty', label: '의리' },
  { key: 'home', label: '연고' },
];

/** 연봉 스텝퍼 범위 — [asking×0.6, min(개인상한, asking×1.5, 캡여유)] · step 0.1억. 캡/자금 초과는 엔진 게이트가 사유 표기. */
export function offerSalaryBounds(asking: number, player: Player, myPayroll: number): { min: number; max: number; step: number } {
  const min = round100(asking * 0.6);
  let max = Math.min(maxSalaryFor(player), round100(asking * 1.5));
  const capRoom = LEAGUE_CAP - myPayroll;
  if (capRoom > 0) max = Math.min(max, Math.max(asking, round100(capRoom))); // 캡 여유 안(단, 최소 asking은 도달 가능)
  max = Math.max(max, min);
  return { min, max, step: 1000 };
}
