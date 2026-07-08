// 오프시즌 빌더 — 롤오버+은퇴 후 FA 풀을 형성한다(결정론).
// FA 센터 프리뷰와 store.endSeason 이 동일 함수를 써서 미리보기=결과 보장.
// data 계층(엔진 합성). 순수에 가깝게(모듈 base 읽기).

import type { Contract, Player } from '../types';
import { createRng } from '../engine/rng';
import { applyRetirements, capContractYears } from '../engine/retire';
import { rollExpulsion, scandalRepMul, type ExpelKind } from '../engine/scandal';
import { rolloverLeague, renewedContract } from '../engine/rollover';
import { aiRetainProb, medianOvr, positionGap, ROSTER_TOTAL } from '../engine/aiGM';
import { assignFAGrades, askingPrice, offerScore, prefWeightsOf, acceptProb, SIT_OUT } from '../engine/faMarket';
import { affinity, pairKey } from '../engine/relationships';
import { relationBonds } from './relationships';
import { needsCompensationPlayer, pickCompensation, compensationMoney, compensationMoneyOnly } from '../engine/compensation';
import { canAfford, clampSalary, isFranchise, LEAGUE_CAP } from '../engine/cap';
import { strSeed } from '../engine/rng';
import type { OwnerFx } from '../engine/owner';
import { marketVal, setSalaryEra } from './awardSalary';
import { overall, teamOverall } from '../engine/overall';
import { currentBasePlayers, currentRosters, focusOf, effectsOf } from './league';
import { seasonScandals } from './dynamics';
import { domesticPayroll } from './roster';
import { upcomingStances } from './leagueHistory';
import type { SponsorStance } from '../engine/sponsorStance';

/** 직전 시즌 사고 선수 → 다음 재계약·FA 평판 계수(playerId→≤1). 사안 클수록 더 깎인다.
 *  export: fa.tsx 요구연봉 표시가 엔진 asking 산식(`askingPrice×rep`, :150)과 동일하게 할인하도록 공유(EC-FA-09). */
export function scandalRepMap(): Map<string, number> {
  const m = new Map<string, number>();
  for (const sc of seasonScandals()) m.set(sc.playerId, scandalRepMul(sc.missMatches));
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
import { computeStandings } from './standings';
import { buildPlayoffs } from './playoffs';

/**
 * 팀별 "우승권" 신호(0..1) — 직전 시즌 정규 순위 + 우승 여부.
 * 우승팀=1, 그 외는 순위 비례(1위≈0.85 … 꼴찌 0). offerScore 의 win 항에 주입.
 */
function teamPrestige(prevSeason: number): Record<string, number> {
  const standings = computeStandings(Number.MAX_SAFE_INTEGER);
  const N = standings.length;
  const champ = buildPlayoffs(Math.max(0, prevSeason)).championId;
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
}

/**
 * 경쟁 FA 시장(결정론). 풀의 각 FA에 대해 관심 구단(나=지명, AI=포지션 필요)이
 * 오퍼를 내고, 선수가 offerScore 로 최선을 선택. 내가 찍어도 질 수 있다.
 */
const REL_SCALE_FA = 6; // 친구 다수라야 포화(RELATIONSHIP §2 — 장기 parity 보호: 친구 연쇄 집중 완화, 30×8 측정)
/** 선수 ↔ 팀(로컬 rosters 기준) affinity −1..1 — 진행 중 영입 반영(친구 연쇄). 등록부 셀렉터 대신 로컬 사용. */
function teamAffinityFor(p: Player, rosterIds: string[], get: (id: string) => Player | undefined, bonds: Record<string, number>): number {
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

  const rng = createRng(80000 + season * 131);
  // 모기업 기조(FINANCE 2.0 Stage3) — 막 끝난 시즌(season-1) 기준, 전 구단 stance.
  //   **upcomingStances = 라이브 병합**(막 끝난 시즌을 computeStandings로 덧댐) → FA 프리뷰(archive에 S 미포함)와
  //   endSeason(S 포함)이 동일 stance = preview=result(EC-FN-01 수정). 별도 RNG(sponsorStanceOf 자체 시드)라 rng 스트림 미소비(결정#4).
  const stanceOf: Record<string, SponsorStance> = upcomingStances(teams, season - 1);
  const bondsCtx = relationBonds(); // 인간관계 우정(스토어 컨텍스트) — preview=result
  let cashLeft = myCash ?? Number.POSITIVE_INFINITY; // 다중 영입은 잔고를 차감하며 순차 판정
  const signedByMe: string[] = [];
  const lostTo: Record<string, string> = {};
  // 내가 지명한 선수의 "내 팀 입찰 게이트" 결과 기록 — 실패 사유 세분화용(FA_SYSTEM §2.7 UX).
  //   ROSTER=정원 참(입찰 전 컷)·CAP=캡 초과·CASH=운영 자금 부족·BID=입찰 성사(성공/뺏김/잔류로 갈림).
  //   순수 관측(resolve 결정에 미개입) — 아래 faFail 조립에만 쓰인다.
  const myGate: Record<string, 'ROSTER' | 'CAP' | 'CASH' | 'BID'> = {};
  let compCash = 0; // 내가 낸 FA 보상금 누계(A/B 영입 — FA_SYSTEM 2.2)
  const wanted = new Set(faSignings);

  // 좋은 FA부터 계약 결정. 직전 시즌 사고 선수는 평판 할인(요구연봉↓ — 다음 FA에 반영)
  const repMap = scandalRepMap();
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

    const bids: { teamId: string; offer: number; score: number }[] = [];
    for (const t of teams) {
      if (ROSTER_TOTAL - rosters[t].length <= 0) { if (t === myTeam && wanted.has(id)) myGate[id] = 'ROSTER'; continue; } // 자리 없음
      const gap = positionGap(rosters[t], get)[p.position];
      const isMe = t === myTeam;
      const stance = stanceOf[t];
      // 참가 게이트(bidGap) — 나=지명한 선수만. AI=stance별: aggressive 타겟+1(gap===0 여유 포지션도 입찰=depth) /
      //   thrifty 관망(gap≥2 뚜렷한 구멍만) / normal 기존(gap>0). ※게이트만 — offerScore.posGap엔 실제 gap 유지(결정#3).
      if (isMe) { if (!wanted.has(id)) continue; }
      else if (stance === 'aggressive') { if (gap < 0) continue; }
      else if (stance === 'thrifty') { if (gap < 2) continue; }
      else { if (gap <= 0) continue; }
      // 오퍼 — 내 팀=aggressive 토글 배수. AI aggressive=배수, 단 캡 천장 안 clamp(결정#1, 단순×배수면 캡근접팀 탈락 역설).
      //   ※ 캡룸이 asking 위로 있을 때만 프리미엄(room>asking) — payroll≥cap이면 음수/0·MIN_SALARY 미만 오퍼 방지(EC-FN-02).
      //     room≤asking이면 asking으로 두고 아래 ok 게이트(payroll+asking≤cap)가 정상 차단.
      const room = LEAGUE_CAP - payroll[t];
      const offer = isMe
        ? Math.round((asking * (aggressive ? AGGRESSIVE_MULT : 1)) / 100) * 100
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
      const score = offerScore({
        teamOvr: ovr[t],
        prestige: prestige[t] ?? 0,
        posGap: gap,
        isOriginal: prevTeamOf[id] === t,
        isFranchise: isFranchise(p) && prevTeamOf[id] === t,
        isPreferred: p.faPref?.preferredTeamId === t,
        offerSalary: offer,
        asking,
        w: prefWeightsOf(p),
        rand: rng.next(),
        talkBias: isMe ? ownerFx?.offerBias[id] : undefined, // 면담의 기억은 우리 구단에만 작용
        relT: teamAffinityFor(p, rosters[t], get, bondsCtx), // 인간관계(그 시점 로스터 — 친구 연쇄) RELATIONSHIP
      });
      bids.push({ teamId: t, offer, score });
    }
    if (bids.length === 0) continue; // 미계약(팀이 안 원함 — 양방향)
    // 점수 → 확률 → 정렬·롤·fallback·SIT (FA_SYSTEM 2.7, 사용자 결정)
    const scored = bids.map((b) => ({ ...b, prob: acceptProb(b.score) })).sort((a, b) => b.prob - a.prob || b.score - a.score);
    if (scored[0].score < SIT_OUT) continue; // 최고 점수도 바닥 미만 → 시즌 아웃(FA 잔류)
    let win = scored[0]; // fallback = 최고 확률 팀(전부 실패 시)
    for (const cand of scored) { if (rng.next() < cand.prob) { win = cand; break; } } // 위에서부터 롤, 첫 성공 입단
    const finalSalary = clampSalary(win.offer, p); // 개인 상한(프랜차이즈 예외) 적용
    snapshot[id] = {
      ...p,
      contract: { salary: finalSalary, years: capContractYears(p.age, RENEW_FA_YEARS), remaining: capContractYears(p.age, RENEW_FA_YEARS), signedAtAge: p.age },
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

  return { snapshot, rosters, signedByMe, lostTo, compCash, faFail };
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
}

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
): Offseason {
  // 출장정지 결장일 → 그 시즌 훈련 생략(성장 정체·노장 하락, OWNER_SYSTEM 4.6). 정지 기간(to−from) 일수.
  const lostDays = new Map<string, number>();
  for (const sc of seasonScandals()) lostDays.set(sc.playerId, Math.max(0, sc.to - sc.from));
  const repMap = scandalRepMap(); // 사고 선수 다음 재계약/FA 평판 할인
  // 시대 앵커(FA_SYSTEM 4·SALARY 2장, 2026-07-02): 리그 국내 OVR 중앙값 — 이번 오프시즌의 단일 시대값.
  //   AI 잔류 확률·재계약/자동연장 연봉·FA 요구액이 전부 이 값으로 시대 보정 → 성장 곡선 개편으로
  //   분포가 이동해도 순잔류율(~58%)·연봉 스케일(캡 압박)이 유지된다(과이탈·재정 긴장 사멸 방지).
  const leagueMedOvr = medianOvr(currentBasePlayers().filter((p) => !p.isForeign));
  setSalaryEra(leagueMedOvr); // marketVal(주입 컨텍스트) 사용처(FA 요구액·AI 수혈 등)와 동기화
  const snapshot = rolloverLeague(currentBasePlayers(), focusOf, leagueMedOvr, contractOverrides, effectsOf, (p) => lostDays.get(p.id) ?? 0);
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
  for (const teamId of Object.keys(afterRetire.rosters)) {
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
      else { keep.push(id); payroll += p.contract.salary; }
    }
    // 2) 만료자: 잔류 의사(내 팀=단장 결정 / AI=aiKeepsFA) 있는 선수를 가치 높은 순으로,
    //    팀 샐러리캡 한도 내에서만 재계약. 캡 초과분은 잔류 못 하고 FA 시장으로(왕조 억제 레버).
    // 내 팀 만료자: 단장이 잡고 싶어도(resign) 불만 선수는 거부하고 시장으로 나갈 수 있다(면담이 좌우)
    const refuses = (p: Player): boolean => {
      if (teamId !== myTeam) return false;
      const prob = ownerFx?.refuseProb[p.id] ?? 0;
      if (prob <= 0) return false;
      const rng = createRng(strSeed(`resign-refuse:${p.id}:${nextSeason}`));
      return rng.next() < prob;
    };
    // AI 재계약: 절벽 컷(aiKeepsFA) 대신 확률(aiRetainProb)을 결정론 시드로 굴림 — 가끔 노장 잔류·영건 이탈(리그 생동)
    const aiRetains = (p: Player): boolean => createRng(strSeed(`airetain:${p.id}:${nextSeason}`)).next() < aiRetainProb(p, leagueMedOvr);
    const wantRetain = expiring
      .filter((p) => (teamId === myTeam ? resignDecisions[p.id] !== false && !refuses(p) : aiRetains(p)))
      .sort((a, b) => overall(b) - overall(a));
    const retainSet = new Set(wantRetain.map((p) => p.id));
    for (const p of wantRetain) {
      const rc = renewedContract(p, leagueMedOvr);
      // 직전 시즌 사고 선수는 평판 할인(사안 경중만큼 연봉↓) — 다음 재계약에 반영(OWNER_SYSTEM 4.6)
      const rep = repMap.get(p.id) ?? 1;
      const renewed = rep < 1 ? { ...rc, salary: round100(rc.salary * rep) } : rc;
      if (payroll + renewed.salary <= LEAGUE_CAP) {
        snapshot[p.id] = { ...p, contract: renewed };
        keep.push(p.id);
        payroll += renewed.salary;
      } else {
        pool.push(p.id); // 캡 초과 → 잔류 불가
      }
    }
    for (const p of expiring) if (!retainSet.has(p.id)) pool.push(p.id); // 잔류 의사 없던 만료자
    rosters[teamId] = keep;
  }
  return { snapshot, rosters, pool, retired: afterRetire.retired, returningForeign, returningAsian, expelled };
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
): OffseasonBase {
  const committed = currentRosters();
  const prevTeamOf: Record<string, string> = {};
  for (const t of Object.keys(committed)) for (const id of committed[t]) prevTeamOf[id] = t;
  const off = buildOffseason(myTeam, resignDecisions, overrides, nextSeason, ownerFx);
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
  const prestige = teamPrestige(nextSeason - 1);
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
): PreDraft {
  const { prevTeamOf, prevForeignOf, prevAsianOf, prestige } = base;
  const off = cloneOffForResolve(base);
  // 외국인 트라이아웃 — FA 시장 앞(외인이 OP를 채워야 AI가 FA로 중복 영입하지 않는다)
  const tryout = runTryout(off.snapshot, off.rosters, off.returningForeign, nextSeason, myTeam, tryoutWish, prevForeignOf, myKeepForeign, myCash ?? Number.POSITIVE_INFINITY);
  // 아시아쿼터 게이트: 외인 신규 영입 비용 차감 후 남은 자금으로만(외인 우선). 자금 부족 → 아시아쿼터 공석(안티과금)
  const myF = (off.rosters[myTeam] ?? []).find((id) => { const p = off.snapshot[id]; return p?.isForeign && !p.isAsianQuota; });
  const foreignCostMine = myF && prevTeamOf[myF] !== myTeam ? FOREIGN_SALARY : 0;
  const asianCash = myCash === undefined ? Number.POSITIVE_INFINITY : Math.max(0, myCash - foreignCostMine);
  const asianTryout = runAsianQuota(off.snapshot, off.rosters, off.returningAsian, nextSeason, myTeam, asianWish, prevAsianOf, myKeepAsian, asianCash);
  const faCash = cashAfterImports(myCash, off.rosters, off.snapshot, myTeam, prevTeamOf); // 수입(외인+아시아쿼터) 비용 차감 후 국내 FA 지갑
  const fa = resolveFAMarket(off, myTeam, faSignings, aggressive, protectedIds, prevTeamOf, nextSeason, prestige, ownerFx, faCash, moneyOnlyIds);
  return { snapshot: fa.snapshot, rosters: fa.rosters, prevTeamOf, retired: off.retired, expelled: off.expelled, tryout, asianTryout, compCash: fa.compCash };
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
): PreDraft {
  const base = buildOffseasonBase(myTeam, resignDecisions, overrides, nextSeason, ownerFx);
  return resolvePreDraftFrom(base, myTeam, faSignings, aggressive, protectedIds, nextSeason, ownerFx, myCash, tryoutWish, myKeepForeign, moneyOnlyIds, asianWish, myKeepAsian);
}

export interface FAPreview {
  pool: string[];
  snapshot: Record<string, Player>;
  myRoster: string[];
  signedByMe: Set<string>;
  lostTo: Record<string, string>;
  faFail: Record<string, FAFailCode>;   // 지명 실패 사유(FA 센터 표기 — FA_SYSTEM §2.7 UX)
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
): FAPreview {
  const { prevTeamOf, prevForeignOf, prevAsianOf, prestige } = base;
  const off = cloneOffForResolve(base);
  const tryout = runTryout(off.snapshot, off.rosters, off.returningForeign, nextSeason, myTeam, tryoutWish, prevForeignOf, myKeepForeign, myCash ?? Number.POSITIVE_INFINITY);
  const myF = (off.rosters[myTeam] ?? []).find((id) => { const p = off.snapshot[id]; return p?.isForeign && !p.isAsianQuota; });
  const foreignCostMine = myF && prevTeamOf[myF] !== myTeam ? FOREIGN_SALARY : 0;
  const asianCash = myCash === undefined ? Number.POSITIVE_INFINITY : Math.max(0, myCash - foreignCostMine);
  const asianTryout = runAsianQuota(off.snapshot, off.rosters, off.returningAsian, nextSeason, myTeam, asianWish, prevAsianOf, myKeepAsian, asianCash);
  const pool = [...off.pool];
  const myRoster = [...(off.rosters[myTeam] ?? [])];
  const faCash = cashAfterImports(myCash, off.rosters, off.snapshot, myTeam, prevTeamOf); // 수입(외인+아시아쿼터) 비용 차감 후 국내 FA 지갑
  const fa = resolveFAMarket(off, myTeam, faSignings, aggressive, protectedIds, prevTeamOf, nextSeason, prestige, ownerFx, faCash, moneyOnlyIds);
  return { pool, snapshot: fa.snapshot, myRoster, signedByMe: new Set(fa.signedByMe), lostTo: fa.lostTo, faFail: fa.faFail, tryout, asianTryout, compCash: fa.compCash };
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
): FAPreview {
  const base = buildOffseasonBase(myTeam, resignDecisions, overrides, nextSeason, ownerFx);
  return faMarketPreviewFrom(base, myTeam, faSignings, aggressive, protectedIds, nextSeason, ownerFx, myCash, tryoutWish, myKeepForeign, moneyOnlyIds, asianWish, myKeepAsian);
}
