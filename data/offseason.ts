// 오프시즌 빌더 — 롤오버+은퇴 후 FA 풀을 형성한다(결정론).
// FA 센터 프리뷰와 store.endSeason 이 동일 함수를 써서 미리보기=결과 보장.
// data 계층(엔진 합성). 순수에 가깝게(모듈 base 읽기).

import type { Contract, Player } from '../types';
import { createRng } from '../engine/rng';
import { applyRetirements } from '../engine/retire';
import { rolloverLeague, renewedContract } from '../engine/rollover';
import { aiKeepsFA, aiFillFromPool } from '../engine/aiGM';
import { assignFAGrades } from '../engine/faMarket';
import { needsCompensationPlayer, pickCompensation } from '../engine/compensation';
import { currentBasePlayers, currentRosters, focusOf, getTeam } from './league';

const styleOf = (teamId: string) => getTeam(teamId)?.coachStyle ?? 'balanced';

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
  protectedIds: string[],
  nextSeason: number,
): PreDraft {
  const committed = currentRosters();
  const prevTeamOf: Record<string, string> = {};
  for (const t of Object.keys(committed)) for (const id of committed[t]) prevTeamOf[id] = t;

  const off = buildOffseason(myTeam, resignDecisions, overrides, nextSeason);
  const snapshot = off.snapshot;
  const rosters: Record<string, string[]> = { ...off.rosters };
  const grades = assignFAGrades(off.pool.map((id) => snapshot[id]).filter(Boolean) as Player[]);

  // 내 FA 영입
  const remainingPool = new Set(off.pool);
  for (const id of faSignings) {
    if (!remainingPool.has(id)) continue;
    const p = snapshot[id];
    if (!p) continue;
    snapshot[id] = { ...p, contract: renewedContract(p) };
    rosters[myTeam] = [...(rosters[myTeam] ?? []), id];
    remainingPool.delete(id);
  }

  // 보상선수(A/B): 내 비보호 1명 → 원소속팀
  const taken: string[] = [];
  for (const id of faSignings) {
    if (off.pool.indexOf(id) < 0) continue;
    const g = grades.get(id);
    if (!g || !needsCompensationPlayer(g)) continue;
    const prev = prevTeamOf[id];
    if (!prev || prev === myTeam || !rosters[prev]) continue;
    const compId = pickCompensation(rosters[myTeam] ?? [], protectedIds, snapshot, [...taken, id]);
    if (!compId) continue;
    taken.push(compId);
    rosters[myTeam] = (rosters[myTeam] ?? []).filter((x) => x !== compId);
    rosters[prev] = [...rosters[prev], compId];
  }

  // AI가 남은 풀에서 충원(팀 사정·성향 반영)
  const aiFilled = aiFillFromPool(rosters, [...remainingPool], snapshot, myTeam, styleOf);
  return { snapshot, rosters: aiFilled.rosters, prevTeamOf };
}
