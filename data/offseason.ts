// 오프시즌 빌더 — 롤오버+은퇴 후 FA 풀을 형성한다(결정론).
// FA 센터 프리뷰와 store.endSeason 이 동일 함수를 써서 미리보기=결과 보장.
// data 계층(엔진 합성). 순수에 가깝게(모듈 base 읽기).

import type { Contract, Player } from '../types';
import { createRng } from '../engine/rng';
import { applyRetirements } from '../engine/retire';
import { rollExpulsion, type ExpelKind } from '../engine/scandal';
import { rolloverLeague, renewedContract } from '../engine/rollover';
import { aiKeepsFA, positionGap, ROSTER_TOTAL } from '../engine/aiGM';
import { assignFAGrades, askingPrice, offerScore, prefWeightsOf } from '../engine/faMarket';
import { needsCompensationPlayer, pickCompensation, compensationMoney, compensationMoneyOnly } from '../engine/compensation';
import { canAfford, clampSalary, isFranchise, LEAGUE_CAP } from '../engine/cap';
import { strSeed } from '../engine/rng';
import type { OwnerFx } from '../engine/owner';
import { marketValue } from '../engine/salary';
import { overall, teamOverall } from '../engine/overall';
import { currentBasePlayers, currentRosters, focusOf, effectsOf } from './league';
import { seasonScandals } from './dynamics';
import { domesticPayroll } from './roster';
import { runTryout, type TryoutOutcome } from './tryout';
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

export interface FAMarketResult {
  snapshot: Record<string, Player>;
  rosters: Record<string, string[]>;
  signedByMe: string[];                 // 내가 영입 성공
  lostTo: Record<string, string>;       // 내가 노렸으나 뺏긴 선수 → 영입팀
  compCash: number;                     // 내가 낸 보상금 합(A/B FA 영입 — 직전연봉 배수, FA_SYSTEM 2.2)
}

/**
 * 경쟁 FA 시장(결정론). 풀의 각 FA에 대해 관심 구단(나=지명, AI=포지션 필요)이
 * 오퍼를 내고, 선수가 offerScore 로 최선을 선택. 내가 찍어도 질 수 있다.
 */
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
  let cashLeft = myCash ?? Number.POSITIVE_INFINITY; // 다중 영입은 잔고를 차감하며 순차 판정
  const signedByMe: string[] = [];
  const lostTo: Record<string, string> = {};
  let compCash = 0; // 내가 낸 FA 보상금 누계(A/B 영입 — FA_SYSTEM 2.2)
  const wanted = new Set(faSignings);

  // 좋은 FA부터 계약 결정
  const faIds = [...off.pool].sort((a, b) => overall(snapshot[b]!) - overall(snapshot[a]!));
  for (const id of faIds) {
    const p = snapshot[id];
    if (!p) continue;
    const grade = grades.get(id) ?? 'C';
    const asking = askingPrice(marketValue(p), grade);
    // 내가 영입 시 추가로 낼 보상금 — '돈만' 선택 시 가중 보상금(보상선수 면제), 아니면 기본(보상선수 동반)
    const compCost = needsCompensationPlayer(grade)
      ? (moneyOnly.has(id) ? compensationMoneyOnly(grade, p.contract.salary) : compensationMoney(grade, p.contract.salary))
      : 0;

    const bids: { teamId: string; offer: number; score: number }[] = [];
    for (const t of teams) {
      if (ROSTER_TOTAL - rosters[t].length <= 0) continue; // 자리 없음
      const gap = positionGap(rosters[t], get)[p.position];
      const isMe = t === myTeam;
      if (isMe ? !wanted.has(id) : gap <= 0) continue; // 나=지명한 선수만 / AI=필요 포지션만
      const offer = isMe ? Math.round((asking * (aggressive ? AGGRESSIVE_MULT : 1)) / 100) * 100 : asking;
      // 내 팀: 캡 AND 운영 자금(FINANCE, 연봉+보상금) — 캡은 남아도 지갑이 비면 못 뽑는다. AI: 모기업 무한 보전(캡만)
      const ok = isMe ? canAfford(payroll[t], offer) && offer + compCost <= cashLeft : payroll[t] + offer <= LEAGUE_CAP;
      if (!ok) continue;
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
      });
      bids.push({ teamId: t, offer, score });
    }
    if (bids.length === 0) continue; // 미계약
    bids.sort((a, b) => b.score - a.score);
    const win = bids[0];
    const finalSalary = clampSalary(win.offer, p); // 개인 상한(프랜차이즈 예외) 적용
    snapshot[id] = {
      ...p,
      contract: { salary: finalSalary, years: RENEW_FA_YEARS, remaining: RENEW_FA_YEARS, signedAtAge: p.age },
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

  return { snapshot, rosters, signedByMe, lostTo, compCash };
}

/** 영구제명 사건 — 그 시즌 소속팀에서 리그 영구 퇴출(불명예, HOF 불가) */
export interface ExpelEvent { playerId: string; teamId: string; kind: ExpelKind }

export interface Offseason {
  snapshot: Record<string, Player>;     // 롤오버된 선수(레지스트리)
  rosters: Record<string, string[]>;    // 잔류/AI유지 반영, FA 풀 인원 제외
  pool: string[];                       // 영입 가능한 FA id
  retired: string[];
  returningForeign: string[];           // 전 시즌 외인(생존자) — 트라이아웃 재참가(국내 흐름과 분리)
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
  const snapshot = rolloverLeague(currentBasePlayers(), focusOf, contractOverrides, effectsOf, (p) => lostDays.get(p.id) ?? 0);
  const retireRng = createRng(70000 + nextSeason * 977);
  const afterRetire = applyRetirements(currentRosters(), snapshot, retireRng);

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
  for (const teamId of Object.keys(afterRetire.rosters)) {
    // 1) 계약 남은 선수는 무조건 보유 + 팀 연봉 누적
    const keep: string[] = [];
    let payroll = 0;
    const expiring: Player[] = [];
    for (const id of afterRetire.rosters[teamId]) {
      const p = snapshot[id];
      if (!p) continue;
      if (expelledSet.has(id)) continue; // 영구제명 — 명단에서 영구 제거
      // 외인은 항상 1년 계약 만료 — 국내 잔류/FA 흐름과 분리, 트라이아웃 재참가로(FOREIGN_SYSTEM)
      if (p.isForeign) { returningForeign.push(id); continue; }
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
    const wantRetain = expiring
      .filter((p) => (teamId === myTeam ? resignDecisions[p.id] !== false && !refuses(p) : aiKeepsFA(p)))
      .sort((a, b) => overall(b) - overall(a));
    const retainSet = new Set(wantRetain.map((p) => p.id));
    for (const p of wantRetain) {
      const renewed = renewedContract(p);
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
  return { snapshot, rosters, pool, retired: afterRetire.retired, returningForeign, expelled };
}

export interface PreDraft {
  snapshot: Record<string, Player>;
  rosters: Record<string, string[]>;     // FA 영입·보상·AI 충원까지 반영(드래프트 전)
  prevTeamOf: Record<string, string>;
  retired: string[];                     // 이번 오프시즌 은퇴자 id(명예의전당 등재용)
  expelled: ExpelEvent[];                // 이번 오프시즌 영구제명자(승부조작·학폭 — 리그 영구 퇴출)
  tryout: TryoutOutcome;                 // 외국인 트라이아웃 결과(풀·지명·대체 풀 — 미리보기 공유)
  compCash: number;                      // 내가 낸 FA 보상금 합(운영 자금 차감용)
}

/**
 * 드래프트 직전 상태: 롤오버·은퇴·FA(내 영입+보상+AI 충원)까지 적용.
 * 드래프트 센터 프리뷰와 endSeason 이 공유(미리보기=결과 보장).
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
): PreDraft {
  const committed = currentRosters();
  const prevTeamOf: Record<string, string> = {};
  for (const t of Object.keys(committed)) for (const id of committed[t]) prevTeamOf[id] = t;

  const off = buildOffseason(myTeam, resignDecisions, overrides, nextSeason, ownerFx);
  // 전 시즌 팀별 외인 — 재계약 우선권의 주체
  const prevForeignOf: Record<string, string> = {};
  for (const t of Object.keys(committed)) {
    const f = committed[t].find((id) => off.snapshot[id]?.isForeign);
    if (f) prevForeignOf[t] = f;
  }
  // 외국인 트라이아웃 — FA 시장 앞(외인이 OP를 채워야 AI가 FA로 중복 영입하지 않는다)
  const tryout = runTryout(off.snapshot, off.rosters, off.returningForeign, nextSeason, myTeam, tryoutWish, prevForeignOf, myKeepForeign, myCash ?? Number.POSITIVE_INFINITY);
  const prestige = teamPrestige(nextSeason - 1);
  const fa = resolveFAMarket(off, myTeam, faSignings, aggressive, protectedIds, prevTeamOf, nextSeason, prestige, ownerFx, myCash, moneyOnlyIds);
  return { snapshot: fa.snapshot, rosters: fa.rosters, prevTeamOf, retired: off.retired, expelled: off.expelled, tryout, compCash: fa.compCash };
}

/** FA 센터 미리보기: 풀 + 내 영입 성공/실패 예상 (resolvePreDraft와 동일 소스) */
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
): {
  pool: string[];
  snapshot: Record<string, Player>;
  myRoster: string[];
  signedByMe: Set<string>;
  lostTo: Record<string, string>;
  tryout: TryoutOutcome;
  compCash: number;
} {
  const committed = currentRosters();
  const prevTeamOf: Record<string, string> = {};
  for (const t of Object.keys(committed)) for (const id of committed[t]) prevTeamOf[id] = t;

  const off = buildOffseason(myTeam, resignDecisions, overrides, nextSeason, ownerFx);
  const prevForeignOf: Record<string, string> = {};
  for (const t of Object.keys(committed)) {
    const f = committed[t].find((id) => off.snapshot[id]?.isForeign);
    if (f) prevForeignOf[t] = f;
  }
  const tryout = runTryout(off.snapshot, off.rosters, off.returningForeign, nextSeason, myTeam, tryoutWish, prevForeignOf, myKeepForeign, myCash ?? Number.POSITIVE_INFINITY);
  const pool = [...off.pool];
  const myRoster = [...(off.rosters[myTeam] ?? [])];
  const prestige = teamPrestige(nextSeason - 1);
  const fa = resolveFAMarket(off, myTeam, faSignings, aggressive, protectedIds, prevTeamOf, nextSeason, prestige, ownerFx, myCash, moneyOnlyIds);
  return { pool, snapshot: fa.snapshot, myRoster, signedByMe: new Set(fa.signedByMe), lostTo: fa.lostTo, tryout, compCash: fa.compCash };
}
