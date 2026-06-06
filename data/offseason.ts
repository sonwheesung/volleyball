// 오프시즌 빌더 — 롤오버+은퇴 후 FA 풀을 형성한다(결정론).
// FA 센터 프리뷰와 store.endSeason 이 동일 함수를 써서 미리보기=결과 보장.
// data 계층(엔진 합성). 순수에 가깝게(모듈 base 읽기).

import type { Contract, Player } from '../types';
import { createRng } from '../engine/rng';
import { applyRetirements } from '../engine/retire';
import { rolloverLeague, renewedContract } from '../engine/rollover';
import { aiKeepsFA } from '../engine/aiGM';
import { currentBasePlayers, currentRosters, focusOf } from './league';

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
