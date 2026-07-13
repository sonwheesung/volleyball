// 오프시즌 빌더 — 롤오버+은퇴 후 FA 풀을 형성한다(결정론).
// FA 센터 프리뷰와 store.endSeason 이 동일 함수를 써서 미리보기=결과 보장.
// data 계층(엔진 합성). 순수에 가깝게(모듈 base 읽기).

import type { Contract, FAOffer, Player } from '../types';
import { createRng } from '../engine/rng';
import { applyRetirements, capContractYears } from '../engine/retire';
import { rollExpulsion, scandalRepMul, type ExpelKind } from '../engine/scandal';
import { rolloverLeague, renewedContract } from '../engine/rollover';
import { aiRetainProb, medianOvr, positionGap } from '../engine/aiGM';
import { ROSTER_CONTRACT_CAP, ROSTER_FLOOR } from '../engine/transactions';
import { aiReserveTargets, aiDomesticCaps } from './rosterTarget';

/** §1.7 attrition — AI 재계약 의향에 곱하는 감쇠(비연장 소폭 강화). 드래프트 유입(R1·R2 지명)만큼
 *  노장이 나가게 해 로스터가 상한(20)으로 팽창하지 않게. parity A/B 튜닝값.
 *  Phase 1.5(2026-07-09): 재계약을 **팀 목표(aiRosterTargets)로 상한** 하는 능동 배출이 주 레버가 되면서,
 *  이 확률 감쇠는 "목표 미달팀에서도 노장이 가끔 빠지는" 생동 역할로 축소(0.6→0.85, 과이탈 완화). */
const AI_RETAIN_ATTRITION = 0.85;
import { assignFAGrades, askingPrice, offerScore, offerScoreFactors, prefWeightsOf, acceptProb, SIT_OUT, CERTAIN, willBeFA, type OfferCtx } from '../engine/faMarket';
import { affinity, pairKey } from '../engine/relationships';
import { relationBonds } from './relationships';
import { needsCompensationPlayer, pickCompensation, compensationMoney, compensationMoneyOnly } from '../engine/compensation';
import { canAfford, clampSalary, isFranchise, maxSalaryFor, LEAGUE_CAP } from '../engine/cap';
import { strSeed } from '../engine/rng';
import type { OwnerFx } from '../engine/owner';
import { marketVal, setSalaryEra, awardScoreOf } from './awardSalary';
import { leagueProduction } from './production';
import type { PerfCtx } from './tryout';
import { overall, teamOverall } from '../engine/overall';
import { currentBasePlayers, currentRosters, focusOf, effectsOf } from './league';
import { seasonScandals, type ScandalSpan } from './dynamics';
import { domesticPayroll } from './roster';
import { upcomingStances } from './leagueHistory';
import type { SponsorStance } from '../engine/sponsorStance';

/** 직전 시즌 사고 선수 → 다음 재계약·FA 평판 계수(playerId→≤1). 사안 클수록 더 깎인다.
 *  export: fa.tsx 요구연봉 표시가 엔진 asking 산식(`askingPrice×rep`, :150)과 동일하게 할인하도록 공유(EC-FA-09). */
export function scandalRepMap(spans?: ScandalSpan[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const sc of (spans ?? seasonScandals())) m.set(sc.playerId, scandalRepMul(sc.missMatches));
  return m;
}
const round100 = (x: number) => Math.round(x / 100) * 100;

/** 내 팀 수입 선수(외인 OP + 아시아쿼터) 신규 영입 비용 — 재계약(prev=내팀)은 비차감 */
function importCost(
  rosters: Record<string, string[]>, snapshot: Record<string, Player>, myTeam: string, prevTeamOf: Record<string, string>,
): number {
  const mine = rosters[myTeam] ?? [];
  const f = mine.find((id) => { const p = snapshot[id]; return p?.isForeign && !p.isAsianQuota; });
  const a = mine.find((id) => snapshot[id]?.isAsianQuota);
  return (f && prevTeamOf[f] !== myTeam ? FOREIGN_SALARY : 0) + (a && prevTeamOf[a] !== myTeam ? ASIAN_SALARY : 0);
}
/** 트라이아웃(외인+아시아쿼터) 후 국내 FA에 남는 현금 — 수입 영입 비용을 차감해 한 지갑 공유
 *  (각자 전액 게이팅하면 합산 과지출 — simBrokeSign). */
function cashAfterImports(
  myCash: number | undefined, rosters: Record<string, string[]>, snapshot: Record<string, Player>,
  myTeam: string, prevTeamOf: Record<string, string>,
): number | undefined {
  if (myCash === undefined) return undefined;
  return Math.max(0, myCash - importCost(rosters, snapshot, myTeam, prevTeamOf));
}
import { runTryout, runAsianQuota, type TryoutOutcome } from './tryout';
import { FOREIGN_SALARY, ASIAN_SALARY, importAgesOut } from '../engine/foreign';
import { computeStandings, type Standing } from './standings';
import { buildPlayoffs } from './playoffs';
import type { ProdLine } from '../engine/production';

/**
 * 시즌 마감 컨텍스트(§7.8 2단계) — endSeason이 **commitRosters 전(관전 우주)** 에 캡처한 끝난 시즌 산출물.
 * buildDraftContext 계열에 옵션으로 주입하면, 커밋 뒤에 끝난 시즌을 다시 읽어(COLD 풀시뮬 + 재작성 우주) 계산하던
 * 4개 지점(importPerfCtx·teamPrestige·upcomingStances·standingsWorstFirst)이 라이브 재계산 대신 이 캡처값을 쓴다.
 * → 풀시뮬 0회 + 미리보기(관전)=결과 통일. **미제공(undefined)=현행 라이브 읽기**(FA/드래프트 프리뷰 호출부 무변경).
 */
export interface SeasonCloseCtx {
  prod: Map<string, ProdLine>;             // leagueProduction(MAX) — 끝난 시즌 선수별 생산(importPerfCtx)
  standings: Standing[];                    // computeStandings(MAX) — 끝난 시즌 최종 순위(teamPrestige·standingsWorstFirst)
  championId: string | null;                // buildPlayoffs(season).championId — 끝난 시즌 챔피언(teamPrestige)
  stances: Record<string, SponsorStance>;   // upcomingStances(teams, season) — 전 구단 모기업 기조(resolveFAMarket)
  scandals: ScandalSpan[];                  // seasonScandals() — 끝난 시즌 사고 정지(§7.8 커밋 후 dyn COLD 재계산·관측우주 정합)
}

/** 수입선수 재계약 활약도 컨텍스트(#77) — 직전 시즌 선수별 생산(leagueProduction 캐시) + 통산 수상(awardScoreOf).
 *  무저장 재계산(결정론): 오프시즌 resolve 시점 leagueProduction(MAX)=직전 시즌 전 경기 생산. setAwardScores는
 *  store.endSeason이 buildDraftContext 앞에 주입(직전 시즌 수상 반영). 미리보기·결과가 같은 소스라 일관. */
function importPerfCtx(close?: SeasonCloseCtx): PerfCtx {
  const prod = close?.prod ?? leagueProduction(Number.MAX_SAFE_INTEGER); // §7.8 — 주입 시 캡처 생산(COLD 재시뮬 회피)
  return { prodOf: (id) => prod.get(id), awardOf: awardScoreOf };
}

/**
 * 팀별 "우승권" 신호(0..1) — 직전 시즌 정규 순위 + 우승 여부.
 * 우승팀=1, 그 외는 순위 비례(1위≈0.85 … 꼴찌 0). offerScore 의 win 항에 주입.
 */
function teamPrestige(prevSeason: number, close?: SeasonCloseCtx): Record<string, number> {
  // §7.8 — 주입 시 캡처 순위·챔피언 사용(computeStandings·buildPlayoffs COLD 재시뮬 회피). 미제공=라이브.
  const standings = close?.standings ?? computeStandings(Number.MAX_SAFE_INTEGER);
  const N = standings.length;
  const champ = close ? close.championId : buildPlayoffs(Math.max(0, prevSeason)).championId;
  const out: Record<string, number> = {};
  standings.forEach((s, i) => {
    const base = N <= 1 ? 1 : 1 - i / (N - 1);
    out[s.teamId] = s.teamId === champ ? 1 : base * 0.85;
  });
  return out;
}

const RENEW_FA_YEARS = 2;
const AGGRESSIVE_MULT = 1.2;
const AI_AGGRESSIVE_MULT = 1.2; // 모기업 aggressive AI 봇 오퍼 배수(캡 천장 clamp). parity로 튜닝(FINANCE 2.0 Stage3)
// AI GM 성향별 레버(FA_SYSTEM §2.8.1 ③ Phase3, 2026-07-10) — 내 팀 faOffers와 대칭으로 AI도 주전보장·다년을 **선별** 사용.
//   부익부 차단이 핵심: 두 레버 모두 **실제 구멍(gap>0)** 이 있을 때만 켠다 → 로스터가 두꺼운 강팀(gap≤0)은 레버를 못 써
//   depth에 남발하지 못하고, 구멍 많은 약·리빌딩 팀이 주전급 FA를 데려와 메운다(§2.8.1 ③ "약팀도 구멍 메우게"). 계수=placeholder(200시즌 parity 튜닝).
const AI_MULTIYEAR_AGE = 28;   // 다년 락인 대상 상한 나이 — 젊은 엘리트만(늙은 선수 장기계약은 캡 락업·위약금 리스크만 큼)
const AI_MULTIYEAR_YEARS = 3;  // 엘리트 다년 계약 연수(RENEW 2 + 1). 캡 락업·조기 방출 위약금(salary×remaining×0.4) 대가가 남발 억제

/** 내가 지명한 FA가 왜 실패했는지(FA 센터 사유 표기 — FA_SYSTEM §2.7 UX).
 *  화면이 '경합/불발'로 뭉개던 5경로를 게이트별로 세분: 정원(ROSTER)·캡초과(CAP)·자금부족(CASH)·
 *  경쟁 입찰 패배(LOST)·선수 잔류 선택(SIT_OUT). 결정론 산출물(엔진 resolve 로직 불변, 관측만 추가). */
export type FAFailCode = 'CAP' | 'CASH' | 'ROSTER' | 'LOST' | 'SIT_OUT';

export interface FAMarketResult {
  snapshot: Record<string, Player>;
  rosters: Record<string, string[]>;
  signedByMe: string[];                 // 내가 영입 성공
  lostTo: Record<string, string>;       // 내가 노렸으나 뺏긴 선수 → 영입팀
  compCash: number;                     // 내가 낸 보상금 합(A/B FA 영입 — 직전연봉 배수, FA_SYSTEM 2.2)
  faFail: Record<string, FAFailCode>;   // 내가 지명했으나 실패한 선수 → 사유 코드(영입 성공한 선수는 미포함)
  // 경쟁 관측(FA_SYSTEM §2.8.5 Phase5) — 이미 계산된 bids에서 파생만(rng 미소비·해소 로직 불변).
  //   bidders=입찰(오퍼 제출)한 팀 id 배열(점수 내림차순=해소 우선순위), myRank=내 입찰의 순위(1-based, 미입찰이면 undefined).
  //   금액·offerScore 원값은 노출 안 함(§2.8 "실제 금액 비공개"). 모든 풀 FA에 기록(내가 지명 안 한 선수 포함).
  //   winProb/winFactors = 예상 승자(해소된 win) 관측(§2.8.9 협상 화면 #5·#7) — 이미 계산된 win.prob(acceptProb)와
  //     win 오퍼의 offerScore 상위 동기 라벨(offerScoreFactors)을 **읽기전용 캡처**(rng 미소비·해소 로직 불변). 승자 없으면 미기록.
  faCompete: Record<string, { bidders: string[]; myRank?: number; winProb?: number; winFactors?: string[] }>;
  // 선수 역제안 카운터(FA_SYSTEM §2.8.6 Phase6) — 내 오퍼가 counterTolerance로 counterAsk까지 상향된 케이스.
  //   from=원 오퍼·to=counterAsk(선클램프 → 서명 시 최종 계약 연봉). 순수 관측(발동 안 하면 키 없음, rng 미소비).
  counterFired: Record<string, { from: number; to: number }>;
  // SIT_OUT 잔류 관측(§2.8.6 뉴스 ②) — 입찰(bids)이 있었는데도 선수가 잔류를 택한 풀 FA id.
  //   bids 0(아무도 안 부름)은 제외 → "모든 제안을 물리치고 잔류" 가짜 드라마 차단. 순수 관측.
  faSatOut: string[];
}

/**
 * 경쟁 FA 시장(결정론). 풀의 각 FA에 대해 관심 구단(나=지명, AI=포지션 필요)이
 * 오퍼를 내고, 선수가 offerScore 로 최선을 선택. 내가 찍어도 질 수 있다.
 */
const REL_SCALE_FA = 6; // 친구 다수라야 포화(RELATIONSHIP §2 — 장기 parity 보호: 친구 연쇄 집중 완화, 30×8 측정)
/** 선수 ↔ 팀(로컬 rosters 기준) affinity −1..1 — 진행 중 영입 반영(친구 연쇄). 등록부 셀렉터 대신 로컬 사용.
 *  export: FA 오퍼 만족도 UI(`data/faOfferSatisfaction.ts`)가 relT 재료를 같은 산식(REL_SCALE_FA·affinity)으로 재사용 — 중복 상수 드리프트 차단(FA §2.8.4). */
export function teamAffinityFor(p: Player, rosterIds: string[], get: (id: string) => Player | undefined, bonds: Record<string, number>): number {
  if (p.isForeign) return 0;
  let sum = 0, n = 0;
  for (const mid of rosterIds) {
    if (mid === p.id) continue;
    const m = get(mid);
    if (!m || m.isForeign) continue;
    sum += affinity(p, m, bonds[pairKey(p.id, mid)] ?? 0, true); n++;
  }
  return n ? Math.max(-1, Math.min(1, sum / REL_SCALE_FA)) : 0;
}

export function resolveFAMarket(
  off: { snapshot: Record<string, Player>; rosters: Record<string, string[]>; pool: string[] },
  myTeam: string,
  faSignings: string[],
  aggressive: boolean,
  protectedIds: string[],
  prevTeamOf: Record<string, string>,
  season: number,
  prestige: Record<string, number>,
  ownerFx?: OwnerFx, // 구단주 면담 보정(내 팀 오퍼에만 가산)
  myCash?: number,   // 내 운영 자금(FINANCE) — 캡이 남아도 지갑이 비면 입찰 불가
  moneyOnlyIds: string[] = [], // 내가 '돈만' 보상 선택한 A/B FA id — 보상선수 면제, 보상금 가중(FA_SYSTEM 2.2)
  // FA 오퍼 다레버(FA_SYSTEM §2.8 Phase1) — 내 팀 지명별 오퍼(연봉/연수/주전보장/약속). 미제공(undefined)이면
  //   레거시 경로: faSignings 전원 기본 오퍼(salary='auto'×(aggressive?1.2:1)·years=RENEW_FA_YEARS) = 구 동작 bit-동일(0드리프트).
  faOffers?: Record<string, FAOffer>,
  close?: SeasonCloseCtx, // §7.8 2단계 — 끝난 시즌 모기업 기조 캡처(주입 시 upcomingStances COLD 재계산 회피)
): FAMarketResult {
  const moneyOnly = new Set(moneyOnlyIds);
  const snapshot = off.snapshot;
  const rosters: Record<string, string[]> = {};
  for (const k of Object.keys(off.rosters)) rosters[k] = [...off.rosters[k]];
  const get = (id: string) => snapshot[id];
  const teams = Object.keys(rosters);

  const grades = assignFAGrades(off.pool.map((id) => snapshot[id]).filter(Boolean) as Player[]);
  const payroll: Record<string, number> = {};
  const ovr: Record<string, number> = {};
  for (const t of teams) {
    payroll[t] = domesticPayroll(rosters[t], (id) => snapshot[id]); // 국내만(외인 캡 제외 — FOREIGN_SYSTEM 2장)
    ovr[t] = teamOverall(rosters[t].map(get).filter((p): p is Player => !!p));
  }

  // AI FA 예약 상한(FA_SYSTEM §1.5·§1.7, Phase 1.5) = 목표−RESERVE — 재계약과 동일 상한. AI는 여기까지만 FA 수혈하고
  //   나머지 ~RESERVE칸은 드래프트(발굴)에 양보한다. 내 팀은 하드 상한(20). 직전 순위+정체성(평균회귀).
  const aiReserve = aiReserveTargets(close?.standings); // §7.8 주입 시 캡처 순위(COLD 재시뮬 회피)
  const rng = createRng(80000 + season * 131);
  // 모기업 기조(FINANCE 2.0 Stage3) — 막 끝난 시즌(season-1) 기준, 전 구단 stance.
  //   **upcomingStances = 라이브 병합**(막 끝난 시즌을 computeStandings로 덧댐) → FA 프리뷰(archive에 S 미포함)와
  //   endSeason(S 포함)이 동일 stance = preview=result(EC-FN-01 수정). 별도 RNG(sponsorStanceOf 자체 시드)라 rng 스트림 미소비(결정#4).
  const stanceOf: Record<string, SponsorStance> = close?.stances ?? upcomingStances(teams, season - 1); // §7.8 — 주입 시 캡처 기조
  const bondsCtx = relationBonds(); // 인간관계 우정(스토어 컨텍스트) — preview=result
  let cashLeft = myCash ?? Number.POSITIVE_INFINITY; // 다중 영입은 잔고를 차감하며 순차 판정
  const signedByMe: string[] = [];
  const lostTo: Record<string, string> = {};
  // 내가 지명한 선수의 "내 팀 입찰 게이트" 결과 기록 — 실패 사유 세분화용(FA_SYSTEM §2.7 UX).
  //   ROSTER=정원 참(입찰 전 컷)·CAP=캡 초과·CASH=운영 자금 부족·BID=입찰 성사(성공/뺏김/잔류로 갈림).
  //   순수 관측(resolve 결정에 미개입) — 아래 faFail 조립에만 쓰인다.
  const myGate: Record<string, 'ROSTER' | 'CAP' | 'CASH' | 'BID'> = {};
  // 경쟁 관측(FA_SYSTEM §2.8.5) — 순수 파생(resolve 결정에 미개입). bids에서 점수순 팀 목록·내 순위만 뽑는다.
  //   winProb/winFactors(§2.8.9)도 여기 승자 확정 후 읽기전용 캡처(아래).
  const faCompete: Record<string, { bidders: string[]; myRank?: number; winProb?: number; winFactors?: string[] }> = {};
  // 카운터 발동 관측(FA_SYSTEM §2.8.6) — 순수(rng 미소비·해소에 미개입, 오퍼 상향은 counterTolerance 있을 때만).
  const counterFired: Record<string, { from: number; to: number }> = {};
  const faSatOut: string[] = []; // SIT_OUT + bids>0(뉴스 ②)
  let compCash = 0; // 내가 낸 FA 보상금 누계(A/B 영입 — FA_SYSTEM 2.2)
  const wanted = new Set(faSignings);

  // 좋은 FA부터 계약 결정. 직전 시즌 사고 선수는 평판 할인(요구연봉↓ — 다음 FA에 반영)
  // §7.8: 커밋 후 dyn 콜드 재계산 회피 + 관측 우주 스캔들 정합(buildOffseason과 동일 캡처 주입). close 미제공(프리뷰)=라이브 폴백.
  const repMap = scandalRepMap(close?.scandals);
  const faIds = [...off.pool].sort((a, b) => overall(snapshot[b]!) - overall(snapshot[a]!));
  for (const id of faIds) {
    const p = snapshot[id];
    if (!p) continue;
    const grade = grades.get(id) ?? 'C';
    const asking = round100(askingPrice(marketVal(p), grade) * (repMap.get(id) ?? 1));
    // 내가 영입 시 추가로 낼 보상금 — '돈만' 선택 시 가중 보상금(보상선수 면제), 아니면 기본(보상선수 동반)
    //   보상은 '타 구단 영입 시'만(FA_SYSTEM §2.2): 원소속이 내 팀(계약 만료·재계약 거부로 풀에 나온 내 선수를 되잡음)이면
    //   보상금·보상선수 모두 없음 → prevTeamOf[id]===myTeam이면 compCost=0(입찰 게이트·차감·compCash 모두).
    //   보상선수 루프(하단)는 이미 prev===myTeam을 스킵 — 돈만 부과되던 "돈은 내고 선수는 안 뺏기는" 모순 제거.
    const compCost = needsCompensationPlayer(grade) && prevTeamOf[id] !== myTeam
      ? (moneyOnly.has(id) ? compensationMoneyOnly(grade, p.contract.salary) : compensationMoney(grade, p.contract.salary))
      : 0;

    // ctx = 각 입찰의 OfferCtx(승자 winFactors #7 캡처용, 읽기전용). offerScore에 넘긴 것과 byte-동일 객체를 저장만 한다.
    const bids: { teamId: string; offer: number; score: number; years: number; guarantee: boolean; ctx: OfferCtx }[] = [];
    for (const t of teams) {
      // 내 팀 = 하드 계약 상한(20). AI = 예약 상한(목표−RESERVE) — 드래프트 자리 확보 + 상위팀 두껍게·하위팀 얇게(§1.5·§1.7).
      const rosterCeil = t === myTeam ? ROSTER_CONTRACT_CAP : (aiReserve[t] ?? 11);
      if (rosters[t].length >= rosterCeil) { if (t === myTeam && wanted.has(id)) myGate[id] = 'ROSTER'; continue; } // 자리 없음
      const gap = positionGap(rosters[t], get)[p.position];
      const isMe = t === myTeam;
      const stance = stanceOf[t];
      // 참가 게이트(bidGap) — 나=지명한 선수만. AI=stance별: aggressive 타겟+1(gap===0 여유 포지션도 입찰=depth) /
      //   thrifty 관망(gap≥2 뚜렷한 구멍만) / normal 기존(gap>0). ※게이트만 — offerScore.posGap엔 실제 gap 유지(결정#3).
      if (isMe) { if (!wanted.has(id)) continue; }
      else if (stance === 'aggressive') { if (gap < 0) continue; }
      else if (stance === 'thrifty') { if (gap < 2) continue; }
      else { if (gap <= 0) continue; }
      // 오퍼 — 내 팀=오퍼 다레버(FA_SYSTEM §2.8). AI aggressive=배수, 단 캡 천장 안 clamp(결정#1, 단순×배수면 캡근접팀 탈락 역설).
      //   ※ 캡룸이 asking 위로 있을 때만 프리미엄(room>asking) — payroll≥cap이면 음수/0·MIN_SALARY 미만 오퍼 방지(EC-FN-02).
      //     room≤asking이면 asking으로 두고 아래 ok 게이트(payroll+asking≤cap)가 정상 차단.
      const room = LEAGUE_CAP - payroll[t];
      // 내 오퍼 레버: cfg 없으면(레거시/faOffers 미제공) faSignings 전원 기본 오퍼로 간주 — aggressive 파라미터·RENEW_FA_YEARS 폴백(bit-동일).
      const cfg = isMe ? faOffers?.[id] : undefined;
      const myAggr = cfg ? !!cfg.aggressive : aggressive;
      const myYears = cfg?.years ?? RENEW_FA_YEARS;
      // AI 성향별 레버(§2.8.1 ③ Phase3) — gap·등급·나이로 순수 결정(rng 미소비). 내 팀은 cfg(faOffers)로만.
      //   주전보장: 실제 구멍(gap>0 → 서명=즉시 주전, 벤치 안 됨)+주전급(A/B) → depth(gap≤0, aggressive가 입찰)엔 안 검(대가 회피).
      //   다년: 젊은 엘리트(A·나이≤28)를 need(gap>0) 있을 때만 락인. 캡 락업·위약금이 남발 억제.
      const aiGuarantee = !isMe && gap > 0 && (grade === 'A' || grade === 'B');
      const aiYears = !isMe && gap > 0 && grade === 'A' && p.age <= AI_MULTIYEAR_AGE ? AI_MULTIYEAR_YEARS : RENEW_FA_YEARS;
      // 승자 계약에 남길 레버 값(내 팀=cfg / AI=위 결정). 주전보장 flag·years 모두 승자 오퍼 기준으로 계약에 반영(item 3).
      const bidGuarantee = isMe ? !!cfg?.starterGuarantee : aiGuarantee;
      const bidYears = isMe ? myYears : aiYears;
      const offer = isMe
        ? (cfg && typeof cfg.salary === 'number'
            ? round100(Math.max(0, cfg.salary))                        // 명시 연봉(Phase 3+ UI) — 캡/자금 게이트가 상한 차단
            : Math.round((asking * (myAggr ? AGGRESSIVE_MULT : 1)) / 100) * 100) // 'auto' = asking×(공격적?1.2:1)
        : stance === 'aggressive' && room > asking
          ? Math.min(round100(asking * AI_AGGRESSIVE_MULT), room)
          : asking;
      // 내 팀: 캡 AND 운영 자금(FINANCE, 연봉+보상금) — 캡은 남아도 지갑이 비면 못 뽑는다. AI: 모기업 무한 보전(캡만)
      const affordCap = canAfford(payroll[t], offer);      // 국내 캡 여유
      const affordCash = offer + compCost <= cashLeft;      // 운영 자금(연봉+보상금) — 캡 남아도 지갑 비면 불가
      const ok = isMe ? affordCap && affordCash : payroll[t] + offer <= LEAGUE_CAP;
      if (!ok) { if (isMe && wanted.has(id)) myGate[id] = !affordCap ? 'CAP' : 'CASH'; continue; }
      if (isMe && wanted.has(id)) myGate[id] = 'BID'; // 내 팀 입찰 성사 — 이후 성공/뺏김/잔류로 갈림
      // ↑ 실패 사유 관측만: ok/continue 값은 이전과 byte-동일(affordCap&&affordCash === 기존 인라인식)
      // rand는 팀당 정확히 1회 소비(hoist) — 카운터 발동 유무와 무관해야 rng 스트림이 안 밀린다(§2.8.6 0드리프트 핵심).
      const rand = rng.next();
      // mkCtx = offerScore에 넘길 OfferCtx 조립(구 인라인 객체와 byte-동일). scoreOf는 이 ctx를 offerScore에 위임만 —
      //   offerScore 입력/호출 순서/rand 소비 모두 불변(순수 리팩터). 승자 ctx는 bids에 저장해 winFactors(#7)에 재사용.
      const mkCtx = (offerSalary: number): OfferCtx => ({
        teamOvr: ovr[t],
        prestige: prestige[t] ?? 0,
        posGap: gap,
        isOriginal: prevTeamOf[id] === t,
        isFranchise: isFranchise(p) && prevTeamOf[id] === t,
        isPreferred: p.faPref?.preferredTeamId === t,
        offerSalary,
        asking,
        w: prefWeightsOf(p),
        rand,
        talkBias: isMe ? ownerFx?.offerBias[id] : undefined, // 면담의 기억은 우리 구단에만 작용
        relT: teamAffinityFor(p, rosters[t], get, bondsCtx), // 인간관계(그 시점 로스터 — 친구 연쇄) RELATIONSHIP
        // FA 오퍼 다레버 — 내 팀=cfg / AI=성향별 레버(§2.8.1 ③ Phase3). 레버 미발동(기본 오퍼·gap≤0·C등급)이면 undefined → score 기여 0.
        years: isMe ? cfg?.years : (aiYears !== RENEW_FA_YEARS ? aiYears : undefined),
        starterGuarantee: isMe ? cfg?.starterGuarantee : (aiGuarantee || undefined),
        promises: cfg?.promises,
      });
      const scoreOf = (offerSalary: number) => offerScore(mkCtx(offerSalary));
      let bidOffer = offer;
      let score = scoreOf(offer); // baseScore(원 오퍼)
      // 선수 역제안 카운터(FA_SYSTEM §2.8.6 Phase6) — 내 팀 오퍼만. counterTolerance 사전 커밋으로 counterAsk까지 자동 상향.
      //   δ는 facounter 해시 서브스트림(메인 rng 밖). 발동 후 재계산은 위 rand를 그대로 재사용 → rng 소비 불변(0드리프트).
      if (isMe && cfg?.counterTolerance && (grade === 'A' || grade === 'B')) {
        const delta = 0.05 + createRng(strSeed(`facounter:${id}:${season}`)).next() * 0.20; // 5~25% 균등
        const counterAsk = Math.min(round100(asking * (1 + delta)), maxSalaryFor(p)); // 선클램프 → to===최종 계약 연봉
        const up = Math.max(0, cfg.counterTolerance.salaryUp);
        // 전부 AND: 원 오퍼<counterAsk · 아직 확정권 아님(baseScore<CERTAIN) · all-or-nothing 커버 · 캡·자금 게이트 통과
        if (bidOffer < counterAsk && score < CERTAIN && bidOffer + up >= counterAsk
            && canAfford(payroll[t], counterAsk) && counterAsk + compCost <= cashLeft) {
          bidOffer = counterAsk;
          score = scoreOf(counterAsk); // 같은 rand 재사용(rng 미소비) — 자동수락 아님, 정상 롤로 경쟁 유지
          counterFired[id] = { from: offer, to: counterAsk };
        }
      }
      // years = 계약 연수(§2.8 Phase1·Phase3) — 내 팀=오퍼 연수, AI=성향 레버(기본 2, 젊은 엘리트+구멍이면 3). 승자의 years로 계약 생성.
      bids.push({ teamId: t, offer: bidOffer, score, years: bidYears, guarantee: bidGuarantee, ctx: mkCtx(bidOffer) });
    }
    // 경쟁 관측(FA_SYSTEM §2.8.5) — 모든 풀 FA에 기록(빈 bids면 bidders:[]). 점수 내림차순(해소 우선순위와 동일).
    //   ※ 순수 파생: rng 미소비·아래 해소 로직/롤 순서에 미개입(관측만).
    {
      const orderedBidders = [...bids].sort((a, b) => b.score - a.score).map((b) => b.teamId);
      const myIdx = orderedBidders.indexOf(myTeam);
      faCompete[id] = myIdx >= 0 ? { bidders: orderedBidders, myRank: myIdx + 1 } : { bidders: orderedBidders };
    }
    if (bids.length === 0) continue; // 미계약(팀이 안 원함 — 양방향)
    // 점수 → 확률 → 정렬·롤·fallback·SIT (FA_SYSTEM 2.7, 사용자 결정)
    const scored = bids.map((b) => ({ ...b, prob: acceptProb(b.score) })).sort((a, b) => b.prob - a.prob || b.score - a.score);
    if (scored[0].score < SIT_OUT) { faSatOut.push(id); continue; } // 최고 점수도 바닥 미만 → 시즌 아웃(FA 잔류). bids>0(위 게이트 통과) → 뉴스 ② 대상
    let win = scored[0]; // fallback = 최고 확률 팀(전부 실패 시)
    for (const cand of scored) { if (rng.next() < cand.prob) { win = cand; break; } } // 위에서부터 롤, 첫 성공 입단
    // 예상 승자 관측(§2.8.9 #5·#7) — 이미 계산된 win.prob(acceptProb)와 win 오퍼의 offerScore 상위 동기(≥0.05, 최대 3)를
    //   읽기전용 캡처. 순수(rng 미소비·해소 미개입) — 위 faCompete[id]에 필드만 덧붙인다.
    faCompete[id].winProb = win.prob;
    faCompete[id].winFactors = offerScoreFactors(win.ctx).filter((f) => f.value > 0.05).slice(0, 3).map((f) => f.label);
    const finalSalary = clampSalary(win.offer, p); // 개인 상한(프랜차이즈 예외) 적용
    const winYears = capContractYears(p.age, win.years); // 승자 오퍼 연수(§2.8 Phase1) — 정년 캡. 기본 2 → 구 RENEW_FA_YEARS와 동일.
    // 주전 보장 레버 대가(§2.8 Phase2·Phase3) — 승자 오퍼가 주전보장이면 계약에 flag를 남긴다(내 팀=faOffers / AI=성향 레버).
    //   이후 시즌에 벤치(ownerBenched/outclassed)하면 공약 파기로 재계약 거부·불만·팬심·폼 대가(data/owner buildOwnerFx).
    //   기본 오퍼(보장 off, gap≤0·C등급 AI)면 false → 계약 객체 byte-동일(all-auto 0드리프트는 내 팀 기준 유지).
    const winGuarantee = win.guarantee;
    snapshot[id] = {
      ...p,
      contract: { salary: finalSalary, years: winYears, remaining: winYears, signedAtAge: p.age, ...(winGuarantee ? { starterGuarantee: true } : {}) },
    };
    rosters[win.teamId] = [...rosters[win.teamId], id];
    payroll[win.teamId] += finalSalary;
    ovr[win.teamId] = teamOverall(rosters[win.teamId].map(get).filter((q): q is Player => !!q));
    // 보상금(FA_SYSTEM 2.2) — 내가 영입한 A/B FA마다 직전연봉 배수(A 200%·B 100%)를 추가 비용으로(보상선수와 함께).
    if (win.teamId === myTeam) { signedByMe.push(id); cashLeft -= finalSalary + compCost; compCash += compCost; }
    else if (wanted.has(id)) lostTo[id] = win.teamId;
  }

  // 보상선수: 내가 영입한 A/B 타팀 FA마다 비보호 1명 → 원소속
  const taken: string[] = [];
  for (const id of signedByMe) {
    const grade = grades.get(id);
    if (!grade || !needsCompensationPlayer(grade)) continue;
    if (moneyOnly.has(id)) continue; // '돈만' 선택 — 보상금만 내고 선수단 보호(위에서 가중 보상금 차감)
    const prev = prevTeamOf[id];
    if (!prev || prev === myTeam || !rosters[prev]) continue;
    // 이번 오프시즌에 내가 영입한 FA는 보상선수 대상에서 제외 — 안 그러면 방금 영입한(연봉 지불·signedByMe)
    //   선수가 보상으로 원소속팀에 넘어가 "돈은 내고 선수는 상대 팀" 이중 배정이 된다(KBO 규정도 신규 FA는 보상 불가).
    const compId = pickCompensation(rosters[myTeam] ?? [], protectedIds, snapshot, [...taken, ...signedByMe]);
    if (!compId) continue;
    taken.push(compId);
    rosters[myTeam] = (rosters[myTeam] ?? []).filter((x) => x !== compId);
    rosters[prev] = [...rosters[prev], compId];
  }

  // 실패 사유 조립(FA_SYSTEM §2.7 UX) — 내가 지명했으나 못 뽑은 선수만.
  //   내 입찰이 아예 안 들어간 경우(ROSTER/CAP/CASH)가 우선 — AI가 그 선수를 뽑아 lostTo가 찍혀도
  //   "뺏김"이 아니라 "자금/캡/정원" 사유로 보여 오해를 없앤다(자금 없어 입찰조차 못 함 ≠ 경쟁 패배).
  //   내 입찰이 들어간(BID) 경우만 lostTo면 LOST(경쟁 패배), 아니면 SIT_OUT(선수 잔류 선택).
  const faFail: Record<string, FAFailCode> = {};
  const signedSet = new Set(signedByMe);
  for (const id of wanted) {
    if (signedSet.has(id)) continue;
    const g = myGate[id];
    if (g === 'ROSTER' || g === 'CAP' || g === 'CASH') faFail[id] = g;
    else if (g === 'BID') faFail[id] = lostTo[id] ? 'LOST' : 'SIT_OUT';
  }

  return { snapshot, rosters, signedByMe, lostTo, compCash, faFail, faCompete, counterFired, faSatOut };
}

/** 영구제명 사건 — 그 시즌 소속팀에서 리그 영구 퇴출(불명예, HOF 불가) */
export interface ExpelEvent { playerId: string; teamId: string; kind: ExpelKind }

export interface Offseason {
  snapshot: Record<string, Player>;     // 롤오버된 선수(레지스트리)
  rosters: Record<string, string[]>;    // 잔류/AI유지 반영, FA 풀 인원 제외
  pool: string[];                       // 영입 가능한 FA id
  retired: string[];
  returningForeign: string[];           // 전 시즌 외인(생존자) — 트라이아웃 재참가(국내 흐름과 분리)
  returningAsian: string[];             // 전 시즌 아시아쿼터(생존자) — 아시아쿼터 트라이아웃 재참가(FOREIGN_SYSTEM 7)
  expelled: ExpelEvent[];               // 이번 오프시즌 영구제명자(승부조작·학폭 등 — 리그 영구 퇴출)
  // FA §2.5c-격상(2026-07-11) — 내 팀 만료 FA의 오프시즌 재계약 결과(뉴스 사유·도장). 은퇴자는 별도 버킷이라 여기 없음.
  myReleaseReasons: Record<string, ReleaseReason>; // 내 팀 만료자가 FA 풀行 사유(캡압박/뿌리침/미제안)
  myResigned: string[];                 // 내 팀 만료 FA 중 실제 재계약(keep 버킷 — refuse 롤 통과) = 수락 도장
}

/** 내 팀 만료 FA가 재계약 못 하고 FA 풀로 간 사유(FA §2.5c-격상) — 뉴스 카피 분기. */
export type ReleaseReason = 'refused' | 'notOffered' | 'capSqueezed';

/**
 * 다음 시즌 오프시즌 상태 계산.
 * - 내 팀 FA: resignDecisions[id]!==false 면 잔류(재계약), 아니면 풀로
 * - AI 팀 FA: aiKeepsFA 면 잔류, 아니면 풀로
 */
export function buildOffseason(
  myTeam: string,
  resignDecisions: Record<string, boolean>,
  contractOverrides: Record<string, Contract>,
  nextSeason: number,
  ownerFx?: OwnerFx, // 불만 선수의 재계약 거부(OWNER_SYSTEM) — 단장이 잡아도 선수가 떠날 수 있다
  close?: SeasonCloseCtx, // §7.8 2단계 — 끝난 시즌 순위 캡처(aiDomesticCaps COLD 재시뮬 회피). 미제공=라이브.
): Offseason {
  // 출장정지 결장일 → 그 시즌 훈련 생략(성장 정체·노장 하락, OWNER_SYSTEM 4.6). 정지 기간(to−from) 일수.
  // §7.8 패턴 — 캡처 주입으로 커밋 후 dyn 콜드 재계산(온디바이스 107s) 회피 + 관측 우주 스캔들 정합.
  //   커밋(commitRosters) 후 seasonScandals()→dyn.compute를 재호출하면 finalR(시즌 중 이적 반영) day-0 기준으로
  //   사고 롤을 다시 굴려 유저가 본 우주와 다른 스캔들이 나온다(FA 영입자 day-0 사고 등). close.scandals=커밋 전 캡처가 진실.
  //   close 미제공=라이브 폴백(프리뷰 화면 경로 byte-동일 유지).
  const scandalSpans = close?.scandals ?? seasonScandals();
  const lostDays = new Map<string, number>();
  for (const sc of scandalSpans) lostDays.set(sc.playerId, Math.max(0, sc.to - sc.from));
  const repMap = scandalRepMap(close?.scandals); // 사고 선수 다음 재계약/FA 평판 할인
  // 시대 앵커(FA_SYSTEM 4·SALARY 2장, 2026-07-02): 리그 국내 OVR 중앙값 — 이번 오프시즌의 단일 시대값.
  //   AI 잔류 확률·재계약/자동연장 연봉·FA 요구액이 전부 이 값으로 시대 보정 → 성장 곡선 개편으로
  //   분포가 이동해도 순잔류율(~58%)·연봉 스케일(캡 압박)이 유지된다(과이탈·재정 긴장 사멸 방지).
  const leagueMedOvr = medianOvr(currentBasePlayers().filter((p) => !p.isForeign));
  setSalaryEra(leagueMedOvr); // marketVal(주입 컨텍스트) 사용처(FA 요구액·AI 수혈 등)와 동기화
  // AI 국내 재계약/방출 상한(FA_SYSTEM §1.7, Phase 1.5) = 목표−RESERVE−IMPORTS(국내만) — 매 오프시즌 신인+수입에게 자리를 비운다.
  //   트라이아웃(외인·아시아)이 뒤에서 IMPORTS칸을 채우므로 국내는 그만큼 낮게 잡는다. 내 팀은 무제한(단장 결정).
  const aiRetainCap = aiDomesticCaps(close?.standings); // §7.8 주입 시 캡처 순위(COLD 재시뮬 회피)
  const basePlayers = currentBasePlayers();
  const snapshot = rolloverLeague(basePlayers, focusOf, leagueMedOvr, contractOverrides, effectsOf, (p) => lostDays.get(p.id) ?? 0);
  // ── 인시즌 재계약(override) 우회 봉인(FA_SYSTEM §2.5c·D안, 2026-07-10) ──
  //   실버그: 인시즌 재계약은 contractOverrides[id]에 담겨 rolloverPlayer가 remaining≥1로 **교체** → buildOffseason에서
  //   만료(remaining≤0) 버킷이 아니라 keep 버킷으로 가 refuses()(재계약 거부 롤)를 **완전히 우회**했다. "재계약 확정=불만
  //   무시 100% 잔류"가 되어 OWNER_SYSTEM("단장이 잡아도 선수가 떠날 수 있다")·§2.5와 모순(시뮬 확증 46/46 잔류).
  //   봉인: override 보유 **만료자**(원계약 기준 이번 오프시즌 FA가 될 선수)도 refuses() 롤을 태운다. 거부 시 override 폐기 → FA 풀.
  //   **만료자 판정 = 롤오버 전 base 계약의 willBeFA**(career≥FIRST_FA_SEASONS−1 & remaining≤1) — 롤오버하면 career+1≥6·remaining−1≤0으로
  //   FA 공시될 선수. remaining≥2(계약 중 재계약)·비FA자격(영건 자동연장) override는 애초에 만료가 아니라 refuses() 무대상(무변).
  //   ※ refuses() 시드는 per-player 해시(resign-refuse:{id}:{nextSeason} = 정상 만료 경로와 동일) — 공유 rng 미소비라 순서 무영향, 세이브 안전.
  const overrideResign = new Set<string>();
  for (const p of basePlayers) {
    if (contractOverrides[p.id] && willBeFA(p)) overrideResign.add(p.id);
  }
  const retireRng = createRng(70000 + nextSeason * 977);
  // medOvr = 시대 앵커(위 leagueMedOvr) — 은퇴 기준선 HIGH도 시대상대(연봉·AI잔류와 같은 패턴).
  const afterRetire = applyRetirements(currentRosters(), snapshot, retireRng, leagueMedOvr);

  // 영구제명(SCANDAL terminal) — 은퇴 생존자 중 승부조작·학폭 등으로 리그 영구 퇴출(결정론).
  //   제명자는 잔류도 FA 풀도 아닌 '소멸'(은퇴와 동급 종착이나 불명예 — HOF 불가).
  const expelled: ExpelEvent[] = [];
  const expelledSet = new Set<string>();
  for (const teamId of Object.keys(afterRetire.rosters)) {
    for (const id of afterRetire.rosters[teamId]) {
      const p = snapshot[id];
      if (!p || p.isForeign) continue; // 외인은 트라이아웃 별도 흐름
      const ex = rollExpulsion(id, p.age);
      if (ex) { expelled.push({ playerId: id, teamId, kind: ex.kind }); expelledSet.add(id); }
    }
  }

  const rosters: Record<string, string[]> = {};
  const pool: string[] = [];
  const returningForeign: string[] = [];
  const returningAsian: string[] = [];
  // FA §2.5c-격상 — 내 팀 만료 FA 재계약 결과(뉴스 사유·도장). 버킷팅 중 기록(진실의 원천).
  const myReleaseReasons: Record<string, ReleaseReason> = {};
  const myResigned: string[] = [];
  for (const teamId of Object.keys(afterRetire.rosters)) {
    // 내 팀 만료자: 단장이 잡고 싶어도(resign) 불만 선수는 거부하고 시장으로 나갈 수 있다(면담이 좌우).
    //   ★ 봉인(위 overrideResign)을 위해 버킷팅 루프보다 먼저 정의 — override 만료자도 이 롤을 태운다.
    const refuses = (p: Player): boolean => {
      if (teamId !== myTeam) return false;
      const prob = ownerFx?.refuseProb[p.id] ?? 0;
      if (prob <= 0) return false;
      const rng = createRng(strSeed(`resign-refuse:${p.id}:${nextSeason}`));
      return rng.next() < prob;
    };
    // 1) 계약 남은 선수는 무조건 보유 + 팀 연봉 누적
    const keep: string[] = [];
    let payroll = 0;
    const expiring: Player[] = [];
    for (const id of afterRetire.rosters[teamId]) {
      const p = snapshot[id];
      if (!p) continue;
      if (expelledSet.has(id)) continue; // 영구제명 — 명단에서 영구 제거
      // 수입 선수는 1년 계약 만료 — 국내 흐름과 분리, 각자 트라이아웃 재참가(FOREIGN_SYSTEM 7).
      //   아시아쿼터를 외인보다 먼저 체크(아시아쿼터=isForeign+isAsianQuota라 순서 중요).
      //   정년(FOREIGN_SYSTEM §1.6): 다음 시즌 나이 40+ 수입선수는 returning에서 제외 → keep·풀 재참가·AI 픽이
      //   한 번에 차단(runTryout/runAsianQuota가 returning 멤버십으로 게이트) → cleanup에서 소멸(리그 이탈).
      if (p.isAsianQuota) { if (!importAgesOut(p)) returningAsian.push(id); continue; }
      if (p.isForeign) { if (!importAgesOut(p)) returningForeign.push(id); continue; }
      if (p.contract.remaining <= 0) expiring.push(p);
      // 인시즌 재계약(override) 만료자 봉인 — override로 remaining≥1이 됐어도 원계약 만료자(overrideResign)면
      //   재계약 거부 롤을 태운다(재계약도 오퍼다·D안). 거부 시 override 폐기 → 원계약(remaining 0)으로 FA 풀행
      //   (정상 만료 FA와 동일 계약 형태 — 등급/요구연봉이 override 연봉이 아닌 원 연봉 기준). teamId===myTeam은 refuses가 보장.
      else if (overrideResign.has(id) && refuses(p)) {
        const baseC = basePlayers.find((b) => b.id === id)!.contract;
        snapshot[id] = { ...p, contract: { ...baseC, remaining: 0 } };
        pool.push(id);
        if (teamId === myTeam) myReleaseReasons[id] = 'refused'; // 인시즌 재계약도 시즌말 거부 롤에 뿌리침
      }
      else { keep.push(id); payroll += p.contract.salary; if (teamId === myTeam && overrideResign.has(id)) myResigned.push(id); } // override 만료자 잔류 = 재계약 도장
    }
    // 2) 만료자: 잔류 의사(내 팀=단장 결정 / AI=aiKeepsFA) 있는 선수를 가치 높은 순으로,
    //    팀 샐러리캡 한도 내에서만 재계약. 캡 초과분은 잔류 못 하고 FA 시장으로(왕조 억제 레버).
    // AI 재계약: 절벽 컷(aiKeepsFA) 대신 확률(aiRetainProb)을 결정론 시드로 굴림 — 가끔 노장 잔류·영건 이탈(리그 생동)
    const aiRetains = (p: Player): boolean => createRng(strSeed(`airetain:${p.id}:${nextSeason}`)).next() < aiRetainProb(p, leagueMedOvr) * AI_RETAIN_ATTRITION;
    const wantRetain = expiring
      .filter((p) => (teamId === myTeam ? resignDecisions[p.id] !== false && !refuses(p) : aiRetains(p)))
      .sort((a, b) => overall(b) - overall(a));
    // AI 능동 배출(FA_SYSTEM §1.7, Phase 1.5) — 재계약 의사가 있어도 **로스터가 팀 목표에 도달하면 비연장**(늙고 약한 순으로 컷).
    //   wantRetain은 OVR 내림차순 → 목표 초과분은 가치 낮은(=대개 노장) 선수부터 풀로. 드래프트 유망주가 들어올 자리를 능동적으로 비운다.
    //   내 팀(myTeam)은 무제한(단장 결정) — 캡만 제약. 목표는 이미 keep(계약 잔여 선수) 포함 총원 기준.
    const target = teamId === myTeam ? Number.POSITIVE_INFINITY : (aiRetainCap[teamId] ?? 9);
    const wantRetainSet = new Set(wantRetain.map((p) => p.id)); // 잔류 "의사" 있던 만료자(아래 미의사 만료자 풀행 가드)
    for (const p of wantRetain) {
      if (keep.length >= target) { pool.push(p.id); continue; } // 목표 초과 — 비연장(가치 낮은 순, 능동 배출)
      const rc = renewedContract(p, leagueMedOvr);
      // 직전 시즌 사고 선수는 평판 할인(사안 경중만큼 연봉↓) — 다음 재계약에 반영(OWNER_SYSTEM 4.6)
      const rep = repMap.get(p.id) ?? 1;
      const renewed = rep < 1 ? { ...rc, salary: round100(rc.salary * rep) } : rc;
      if (payroll + renewed.salary <= LEAGUE_CAP) {
        snapshot[p.id] = { ...p, contract: renewed };
        keep.push(p.id);
        payroll += renewed.salary;
        if (teamId === myTeam) myResigned.push(p.id); // 오프시즌 재계약 성사 = 도장(refuse 롤 통과·캡 이내)
      } else {
        pool.push(p.id); // 캡 초과 → 잔류 불가
        if (teamId === myTeam) myReleaseReasons[p.id] = 'capSqueezed'; // 잡고 싶었으나 캡에 밀림
      }
    }
    for (const p of expiring) if (!wantRetainSet.has(p.id)) { // 잔류 의사 없던 만료자(의사자 중 컷/캡탈락은 위에서 이미 풀행)
      pool.push(p.id);
      if (teamId === myTeam) myReleaseReasons[p.id] = refuses(p) ? 'refused' : 'notOffered'; // 뿌리침 vs 미제안(resignDecisions=false)
    }

    // AI 능동 방출(FA_SYSTEM §1.7, Phase 1.5) — 재계약(비연장)만으론 **3년 계약 신인**(seed.ts)이 쌓여 로스터가 예약 상한
    //   아래로 안 내려간다(드래프트 굶음). 그래서 계약 잔여 선수까지 포함해 **예약 상한 초과분을 가치 낮은(늙고 약한) 순으로 방출**한다.
    //   방출자는 FA 풀로(remaining 0) — 타 팀이 주워갈 수 있음. **포지션 floor는 지킨다**(경기 성립·'세터 0명' 방지, canReleasePosition과 같은 결).
    //   드래프트+fillRosters가 뒤에서 목표/floor로 되채워 커밋 로스터 = 목표(T). 내 팀은 방출 안 함(단장 결정).
    if (teamId !== myTeam) {
      const cap = aiRetainCap[teamId] ?? 9;
      while (keep.length > cap) {
        const posCount: Record<string, number> = {};
        for (const id of keep) { const q = snapshot[id]; if (q) posCount[q.position] = (posCount[q.position] ?? 0) + 1; }
        let worstId: string | null = null, worstVal = Infinity;
        for (const id of keep) {
          const q = snapshot[id];
          if (!q || q.isForeign) continue; // 외인은 트라이아웃 별도 흐름 — 방출 대상 아님
          if (posCount[q.position] <= ROSTER_FLOOR[q.position]) continue; // 포지션 floor 보호(경기 성립)
          const v = overall(q);
          if (v < worstVal) { worstVal = v; worstId = id; }
        }
        if (!worstId) break; // 전부 floor 경계 — 더 못 자름
        keep.splice(keep.indexOf(worstId), 1);
        payroll -= snapshot[worstId].contract.salary; // 방출 → 캡 여유 회복(음수 방어 불필요, 누적 payroll≥0)
        snapshot[worstId] = { ...snapshot[worstId], contract: { ...snapshot[worstId].contract, remaining: 0 } }; // FA화
        pool.push(worstId);
      }
    }
    rosters[teamId] = keep;
  }
  return { snapshot, rosters, pool, retired: afterRetire.retired, returningForeign, returningAsian, expelled, myReleaseReasons, myResigned };
}

export interface PreDraft {
  snapshot: Record<string, Player>;
  rosters: Record<string, string[]>;     // FA 영입·보상·AI 충원까지 반영(드래프트 전)
  prevTeamOf: Record<string, string>;
  retired: string[];                     // 이번 오프시즌 은퇴자 id(명예의전당 등재용)
  expelled: ExpelEvent[];                // 이번 오프시즌 영구제명자(승부조작·학폭 — 리그 영구 퇴출)
  tryout: TryoutOutcome;                 // 외국인 트라이아웃 결과(풀·지명·대체 풀 — 미리보기 공유)
  asianTryout: TryoutOutcome;            // 아시아쿼터 트라이아웃 결과(FOREIGN_SYSTEM 7)
  compCash: number;                      // 내가 낸 FA 보상금 합(운영 자금 차감용)
  counterFired: Record<string, { from: number; to: number }>; // 카운터 발동 관측(FA_SYSTEM §2.8.6 — 뉴스 ①·UI 배지)
  faSatOut: string[];                    // SIT_OUT+bids>0 잔류자(§2.8.6 뉴스 ②)
}

/**
 * 오프시즌 **스냅샷 베이스**(REALTIME_SIM §7.3) — 무겁고 **토글 무관**한 안정부.
 * 리그 전 선수 롤오버+은퇴+AI 잔류+영구제명(`buildOffseason`) + 전 시즌 팀별 외인/아시아쿼터 + 우승권 신호(prestige).
 * deps = my·resignDecisions·overrides·nextSeason·ownerFx(전부 위시/영입 토글과 무관) → 앱에서 이 결과만 메모하면
 * 토글마다 재빌드하던 낭비(탭당 ~2s)를 없앤다. 해결(트라이아웃·FA)은 `resolvePreDraftFrom`/`faMarketPreviewFrom`이 담당.
 */
export interface OffseasonBase {
  off: Offseason;
  prevTeamOf: Record<string, string>;
  prevForeignOf: Record<string, string>;   // 전 시즌 팀별 외인 — 재계약 우선권의 주체
  prevAsianOf: Record<string, string>;      // 전 시즌 팀별 아시아쿼터
  prestige: Record<string, number>;         // 우승권 신호(offerScore win 항)
}

export function buildOffseasonBase(
  myTeam: string,
  resignDecisions: Record<string, boolean>,
  overrides: Record<string, Contract>,
  nextSeason: number,
  ownerFx?: OwnerFx,
  close?: SeasonCloseCtx, // §7.8 2단계 — 끝난 시즌 순위·챔피언 캡처(teamPrestige COLD 재시뮬 회피). 미제공=라이브.
): OffseasonBase {
  const committed = currentRosters();
  const prevTeamOf: Record<string, string> = {};
  for (const t of Object.keys(committed)) for (const id of committed[t]) prevTeamOf[id] = t;
  const off = buildOffseason(myTeam, resignDecisions, overrides, nextSeason, ownerFx, close);
  const prevForeignOf: Record<string, string> = {};
  for (const t of Object.keys(committed)) {
    const f = committed[t].find((id) => off.snapshot[id]?.isForeign && !off.snapshot[id]?.isAsianQuota);
    if (f) prevForeignOf[t] = f;
  }
  const prevAsianOf: Record<string, string> = {};
  for (const t of Object.keys(committed)) {
    const a = committed[t].find((id) => off.snapshot[id]?.isAsianQuota);
    if (a) prevAsianOf[t] = a;
  }
  const prestige = teamPrestige(nextSeason - 1, close);
  return { off, prevTeamOf, prevForeignOf, prevAsianOf, prestige };
}

/** 메모된 base 보호용 얕은 클론 — 트라이아웃/FA가 snapshot(엔트리 교체/삭제)·rosters(배열 교체)를 **변이**하므로,
 *  해결 전에 base.off의 snapshot/rosters를 복제한다. Player 객체는 항상 spread로 새로 만들어져 in-place 변이 없음
 *  → Record 얕은 복사 + rosters 배열별 복사로 충분(값은 monolithic과 byte-동일, 이 clone이 유일한 차이). */
function cloneOffForResolve(base: OffseasonBase) {
  return {
    snapshot: { ...base.off.snapshot },
    rosters: Object.fromEntries(Object.entries(base.off.rosters).map(([k, v]) => [k, [...v]])) as Record<string, string[]>,
    pool: base.off.pool,
    returningForeign: base.off.returningForeign,
    returningAsian: base.off.returningAsian,
    retired: base.off.retired,
    expelled: base.off.expelled,
  };
}

/** 해결부(가벼움) — 메모된 base에서 트라이아웃(외인·아시아쿼터)+국내 FA 경쟁을 굴린다. 토글(위시/영입/보호/공격적)만 재실행. */
export function resolvePreDraftFrom(
  base: OffseasonBase,
  myTeam: string,
  faSignings: string[],
  aggressive: boolean,
  protectedIds: string[],
  nextSeason: number,
  ownerFx?: OwnerFx,
  myCash?: number,
  tryoutWish: string[] = [],
  myKeepForeign: boolean | null = null,
  moneyOnlyIds: string[] = [],
  asianWish: string[] = [],
  myKeepAsian: boolean | null = null,
  faOffers?: Record<string, FAOffer>, // FA 오퍼 다레버(§2.8 Phase1) — 미제공이면 레거시(faSignings 기본 오퍼)
  close?: SeasonCloseCtx, // §7.8 2단계 — 끝난 시즌 생산·기조 캡처(importPerfCtx·resolveFAMarket COLD 재계산 회피)
): PreDraft {
  const { prevTeamOf, prevForeignOf, prevAsianOf, prestige } = base;
  const off = cloneOffForResolve(base);
  const perf = importPerfCtx(close); // 직전 시즌 활약도(생산·수상) — 외인/아시아쿼터 재계약 곱수(#77). §7.8 주입 시 캡처 생산.
  // 외국인 트라이아웃 — FA 시장 앞(외인이 OP를 채워야 AI가 FA로 중복 영입하지 않는다)
  const tryout = runTryout(off.snapshot, off.rosters, off.returningForeign, nextSeason, myTeam, tryoutWish, prevForeignOf, myKeepForeign, myCash ?? Number.POSITIVE_INFINITY, perf);
  // 아시아쿼터 게이트: 외인 신규 영입 비용 차감 후 남은 자금으로만(외인 우선). 자금 부족 → 아시아쿼터 공석(안티과금)
  const myF = (off.rosters[myTeam] ?? []).find((id) => { const p = off.snapshot[id]; return p?.isForeign && !p.isAsianQuota; });
  const foreignCostMine = myF && prevTeamOf[myF] !== myTeam ? FOREIGN_SALARY : 0;
  const asianCash = myCash === undefined ? Number.POSITIVE_INFINITY : Math.max(0, myCash - foreignCostMine);
  const asianTryout = runAsianQuota(off.snapshot, off.rosters, off.returningAsian, nextSeason, myTeam, asianWish, prevAsianOf, myKeepAsian, asianCash, perf);
  const faCash = cashAfterImports(myCash, off.rosters, off.snapshot, myTeam, prevTeamOf); // 수입(외인+아시아쿼터) 비용 차감 후 국내 FA 지갑
  const fa = resolveFAMarket(off, myTeam, faSignings, aggressive, protectedIds, prevTeamOf, nextSeason, prestige, ownerFx, faCash, moneyOnlyIds, faOffers, close);
  return { snapshot: fa.snapshot, rosters: fa.rosters, prevTeamOf, retired: off.retired, expelled: off.expelled, tryout, asianTryout, compCash: fa.compCash, counterFired: fa.counterFired, faSatOut: fa.faSatOut };
}

/**
 * 드래프트 직전 상태: 롤오버·은퇴·FA(내 영입+보상+AI 충원)까지 적용.
 * 드래프트 센터 프리뷰와 endSeason 이 공유(미리보기=결과 보장). = base 빌드 + 해결 합성(byte-동일).
 */
export function resolvePreDraft(
  myTeam: string,
  resignDecisions: Record<string, boolean>,
  overrides: Record<string, Contract>,
  faSignings: string[],
  aggressive: boolean,
  protectedIds: string[],
  nextSeason: number,
  ownerFx?: OwnerFx,
  myCash?: number,
  tryoutWish: string[] = [],
  myKeepForeign: boolean | null = null,
  moneyOnlyIds: string[] = [],
  asianWish: string[] = [],
  myKeepAsian: boolean | null = null,
  faOffers?: Record<string, FAOffer>,
): PreDraft {
  const base = buildOffseasonBase(myTeam, resignDecisions, overrides, nextSeason, ownerFx);
  return resolvePreDraftFrom(base, myTeam, faSignings, aggressive, protectedIds, nextSeason, ownerFx, myCash, tryoutWish, myKeepForeign, moneyOnlyIds, asianWish, myKeepAsian, faOffers);
}

export interface FAPreview {
  pool: string[];
  snapshot: Record<string, Player>;
  myRoster: string[];
  signedByMe: Set<string>;
  lostTo: Record<string, string>;
  faFail: Record<string, FAFailCode>;   // 지명 실패 사유(FA 센터 표기 — FA_SYSTEM §2.7 UX)
  faCompete: Record<string, { bidders: string[]; myRank?: number; winProb?: number; winFactors?: string[] }>; // 경쟁 구단·순위·예상 승자(FA_SYSTEM §2.8.5·§2.8.9)
  counterFired: Record<string, { from: number; to: number }>; // 카운터 발동 관측(FA_SYSTEM §2.8.6 — 카드 배지)
  tryout: TryoutOutcome;
  asianTryout: TryoutOutcome;
  compCash: number;
}

/** FA 센터 미리보기 해결부(가벼움) — 메모된 base에서 트라이아웃+FA 경쟁 굴림. 토글만 재실행(§7.3). */
export function faMarketPreviewFrom(
  base: OffseasonBase,
  myTeam: string,
  faSignings: string[],
  aggressive: boolean,
  protectedIds: string[],
  nextSeason: number,
  ownerFx?: OwnerFx,
  myCash?: number,
  tryoutWish: string[] = [],
  myKeepForeign: boolean | null = null,
  moneyOnlyIds: string[] = [],
  asianWish: string[] = [],
  myKeepAsian: boolean | null = null,
  faOffers?: Record<string, FAOffer>, // FA 오퍼 다레버(§2.8 Phase1) — 미제공이면 레거시(faSignings 기본 오퍼)
): FAPreview {
  const { prevTeamOf, prevForeignOf, prevAsianOf, prestige } = base;
  const off = cloneOffForResolve(base);
  const perf = importPerfCtx(); // 직전 시즌 활약도(생산·수상) — 미리보기=결과(같은 perf) 보장(#77)
  const tryout = runTryout(off.snapshot, off.rosters, off.returningForeign, nextSeason, myTeam, tryoutWish, prevForeignOf, myKeepForeign, myCash ?? Number.POSITIVE_INFINITY, perf);
  const myF = (off.rosters[myTeam] ?? []).find((id) => { const p = off.snapshot[id]; return p?.isForeign && !p.isAsianQuota; });
  const foreignCostMine = myF && prevTeamOf[myF] !== myTeam ? FOREIGN_SALARY : 0;
  const asianCash = myCash === undefined ? Number.POSITIVE_INFINITY : Math.max(0, myCash - foreignCostMine);
  const asianTryout = runAsianQuota(off.snapshot, off.rosters, off.returningAsian, nextSeason, myTeam, asianWish, prevAsianOf, myKeepAsian, asianCash, perf);
  const pool = [...off.pool];
  const myRoster = [...(off.rosters[myTeam] ?? [])];
  const faCash = cashAfterImports(myCash, off.rosters, off.snapshot, myTeam, prevTeamOf); // 수입(외인+아시아쿼터) 비용 차감 후 국내 FA 지갑
  const fa = resolveFAMarket(off, myTeam, faSignings, aggressive, protectedIds, prevTeamOf, nextSeason, prestige, ownerFx, faCash, moneyOnlyIds, faOffers);
  return { pool, snapshot: fa.snapshot, myRoster, signedByMe: new Set(fa.signedByMe), lostTo: fa.lostTo, faFail: fa.faFail, faCompete: fa.faCompete, counterFired: fa.counterFired, tryout, asianTryout, compCash: fa.compCash };
}

/** FA 센터 미리보기: 풀 + 내 영입 성공/실패 예상 (resolvePreDraft와 동일 소스). = base 빌드 + 해결 합성(byte-동일). */
export function faMarketPreview(
  myTeam: string,
  resignDecisions: Record<string, boolean>,
  overrides: Record<string, Contract>,
  faSignings: string[],
  aggressive: boolean,
  protectedIds: string[],
  nextSeason: number,
  ownerFx?: OwnerFx,
  myCash?: number,
  tryoutWish: string[] = [],
  myKeepForeign: boolean | null = null,
  moneyOnlyIds: string[] = [],
  asianWish: string[] = [],
  myKeepAsian: boolean | null = null,
  faOffers?: Record<string, FAOffer>,
): FAPreview {
  const base = buildOffseasonBase(myTeam, resignDecisions, overrides, nextSeason, ownerFx);
  return faMarketPreviewFrom(base, myTeam, faSignings, aggressive, protectedIds, nextSeason, ownerFx, myCash, tryoutWish, myKeepForeign, moneyOnlyIds, asianWish, myKeepAsian, faOffers);
}
