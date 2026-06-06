// 오프시즌 빌더 — 롤오버+은퇴 후 FA 풀을 형성한다(결정론).
// FA 센터 프리뷰와 store.endSeason 이 동일 함수를 써서 미리보기=결과 보장.
// data 계층(엔진 합성). 순수에 가깝게(모듈 base 읽기).

import type { Contract, Player } from '../types';
import { createRng } from '../engine/rng';
import { applyRetirements } from '../engine/retire';
import { rolloverLeague, renewedContract } from '../engine/rollover';
import { aiKeepsFA, positionGap, ROSTER_TOTAL } from '../engine/aiGM';
import { assignFAGrades, askingPrice, offerScore } from '../engine/faMarket';
import { needsCompensationPlayer, pickCompensation } from '../engine/compensation';
import { canAfford, isFranchise, LEAGUE_CAP } from '../engine/cap';
import { marketValue } from '../engine/salary';
import { overall, teamOverall } from '../engine/overall';
import { currentBasePlayers, currentRosters, focusOf } from './league';

const RENEW_FA_YEARS = 2;
const AGGRESSIVE_MULT = 1.2;

export interface FAMarketResult {
  snapshot: Record<string, Player>;
  rosters: Record<string, string[]>;
  signedByMe: string[];                 // 내가 영입 성공
  lostTo: Record<string, string>;       // 내가 노렸으나 뺏긴 선수 → 영입팀
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
): FAMarketResult {
  const snapshot = off.snapshot;
  const rosters: Record<string, string[]> = {};
  for (const k of Object.keys(off.rosters)) rosters[k] = [...off.rosters[k]];
  const get = (id: string) => snapshot[id];
  const teams = Object.keys(rosters);

  const grades = assignFAGrades(off.pool.map((id) => snapshot[id]).filter(Boolean) as Player[]);
  const payroll: Record<string, number> = {};
  const ovr: Record<string, number> = {};
  for (const t of teams) {
    payroll[t] = rosters[t].reduce((s, id) => s + (snapshot[id]?.contract.salary ?? 0), 0);
    ovr[t] = teamOverall(rosters[t].map(get).filter((p): p is Player => !!p));
  }

  const rng = createRng(80000 + season * 131);
  const signedByMe: string[] = [];
  const lostTo: Record<string, string> = {};
  const wanted = new Set(faSignings);

  // 좋은 FA부터 계약 결정
  const faIds = [...off.pool].sort((a, b) => overall(snapshot[b]!) - overall(snapshot[a]!));
  for (const id of faIds) {
    const p = snapshot[id];
    if (!p) continue;
    const grade = grades.get(id) ?? 'C';
    const asking = askingPrice(marketValue(p), grade);

    const bids: { teamId: string; offer: number; score: number }[] = [];
    for (const t of teams) {
      if (ROSTER_TOTAL - rosters[t].length <= 0) continue; // 자리 없음
      const gap = positionGap(rosters[t], get)[p.position];
      const isMe = t === myTeam;
      if (isMe ? !wanted.has(id) : gap <= 0) continue; // 나=지명한 선수만 / AI=필요 포지션만
      const offer = isMe ? Math.round((asking * (aggressive ? AGGRESSIVE_MULT : 1)) / 100) * 100 : asking;
      const ok = isMe ? canAfford(payroll[t], offer) : payroll[t] + offer <= LEAGUE_CAP;
      if (!ok) continue;
      const score = offerScore({
        teamOvr: ovr[t],
        posGap: gap,
        isOriginal: prevTeamOf[id] === t,
        isFranchise: isFranchise(p) && prevTeamOf[id] === t,
        offerSalary: offer,
        asking,
        rand: rng.next(),
      });
      bids.push({ teamId: t, offer, score });
    }
    if (bids.length === 0) continue; // 미계약
    bids.sort((a, b) => b.score - a.score);
    const win = bids[0];
    snapshot[id] = {
      ...p,
      contract: { salary: win.offer, years: RENEW_FA_YEARS, remaining: RENEW_FA_YEARS, signedAtAge: p.age },
    };
    rosters[win.teamId] = [...rosters[win.teamId], id];
    payroll[win.teamId] += win.offer;
    ovr[win.teamId] = teamOverall(rosters[win.teamId].map(get).filter((q): q is Player => !!q));
    if (win.teamId === myTeam) signedByMe.push(id);
    else if (wanted.has(id)) lostTo[id] = win.teamId;
  }

  // 보상선수: 내가 영입한 A/B 타팀 FA마다 비보호 1명 → 원소속
  const taken: string[] = [];
  for (const id of signedByMe) {
    const grade = grades.get(id);
    if (!grade || !needsCompensationPlayer(grade)) continue;
    const prev = prevTeamOf[id];
    if (!prev || prev === myTeam || !rosters[prev]) continue;
    const compId = pickCompensation(rosters[myTeam] ?? [], protectedIds, snapshot, [...taken, id]);
    if (!compId) continue;
    taken.push(compId);
    rosters[myTeam] = (rosters[myTeam] ?? []).filter((x) => x !== compId);
    rosters[prev] = [...rosters[prev], compId];
  }

  return { snapshot, rosters, signedByMe, lostTo };
}

export interface Offseason {
  snapshot: Record<string, Player>;     // 롤오버된 선수(레지스트리)
  rosters: Record<string, string[]>;    // 잔류/AI유지 반영, FA 풀 인원 제외
  pool: string[];                       // 영입 가능한 FA id
  retired: string[];
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
): Offseason {
  const snapshot = rolloverLeague(currentBasePlayers(), focusOf, contractOverrides);
  const retireRng = createRng(70000 + nextSeason * 977);
  const afterRetire = applyRetirements(currentRosters(), snapshot, retireRng);

  const rosters: Record<string, string[]> = {};
  const pool: string[] = [];
  for (const teamId of Object.keys(afterRetire.rosters)) {
    const keep: string[] = [];
    for (const id of afterRetire.rosters[teamId]) {
      const p = snapshot[id];
      if (!p) continue;
      if (p.contract.remaining <= 0) {
        const retain = teamId === myTeam ? resignDecisions[id] !== false : aiKeepsFA(p);
        if (retain) {
          snapshot[id] = { ...p, contract: renewedContract(p) };
          keep.push(id);
        } else {
          pool.push(id); // FA 풀(로스터에서 제외)
        }
      } else {
        keep.push(id);
      }
    }
    rosters[teamId] = keep;
  }
  return { snapshot, rosters, pool, retired: afterRetire.retired };
}

export interface PreDraft {
  snapshot: Record<string, Player>;
  rosters: Record<string, string[]>;     // FA 영입·보상·AI 충원까지 반영(드래프트 전)
  prevTeamOf: Record<string, string>;
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
): PreDraft {
  const committed = currentRosters();
  const prevTeamOf: Record<string, string> = {};
  for (const t of Object.keys(committed)) for (const id of committed[t]) prevTeamOf[id] = t;

  const off = buildOffseason(myTeam, resignDecisions, overrides, nextSeason);
  const fa = resolveFAMarket(off, myTeam, faSignings, aggressive, protectedIds, prevTeamOf, nextSeason);
  return { snapshot: fa.snapshot, rosters: fa.rosters, prevTeamOf };
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
): {
  pool: string[];
  snapshot: Record<string, Player>;
  myRoster: string[];
  signedByMe: Set<string>;
  lostTo: Record<string, string>;
} {
  const committed = currentRosters();
  const prevTeamOf: Record<string, string> = {};
  for (const t of Object.keys(committed)) for (const id of committed[t]) prevTeamOf[id] = t;

  const off = buildOffseason(myTeam, resignDecisions, overrides, nextSeason);
  const pool = [...off.pool];
  const myRoster = [...(off.rosters[myTeam] ?? [])];
  const fa = resolveFAMarket(off, myTeam, faSignings, aggressive, protectedIds, prevTeamOf, nextSeason);
  return { pool, snapshot: fa.snapshot, myRoster, signedByMe: new Set(fa.signedByMe), lostTo: fa.lostTo };
}
