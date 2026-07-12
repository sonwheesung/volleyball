// 회귀 가드 (MATCH_INTERVENTION_SYSTEM 1단계) — interventions 미지정 vs [] 바이트 100% 동일.
//   핵심 불변식: opts.interventions가 비었거나 undefined면 simulateMatch 출력이 기존과 완전히 같다
//   (개입 축이 자동 관전 경험을 1비트도 흔들지 않음 — non-empty일 때만 적용되는 게이팅 증명).
//   A: opts에 interventions 미지정   B: opts에 interventions: []
//   두 SimResult를 깊은 직렬화 비교(모든 필드). N≥10,000 랜덤 시드.
//   npx tsx tools/_dv_intervention_empty.ts [N=12000]

import { LEAGUE, getEvolvedTeamPlayers, coachInfoOf, resetLeagueBase } from '../data/league';
import { simulateMatch, type MatchOpts } from '../engine/match';
import type { SimResult } from '../engine/simMatch';

const log = (m: string) => process.stdout.write(m + '\n');

// SimResult 전 필드 깊은 직렬화(Map 없음 — 전부 배열/원시값). 순서 안정.
function ser(r: SimResult): string {
  return JSON.stringify({
    homeSets: r.homeSets,
    awaySets: r.awaySets,
    setScores: r.setScores,
    points: r.points,
    subUse: r.subUse,
    subEvents: r.subEvents,
    timeouts: r.timeouts,
    setFirstServers: r.setFirstServers,
  });
}

function main(): void {
  const N = Math.max(10000, Number(process.argv[2]) || 12000);
  resetLeagueBase();
  const ids = LEAGUE.teams.map((t) => t.id);
  const sq: Record<string, ReturnType<typeof getEvolvedTeamPlayers>> = {};
  for (const id of ids) sq[id] = getEvolvedTeamPlayers(id, 0);
  const nT = ids.length;

  let mismatch = 0;
  let firstBad: { seed: number; field: string } | null = null;

  for (let i = 0; i < N; i++) {
    const seed = (i * 2654435761) >>> 0; // 결정론 시드(Knuth 승수)
    // 매치업도 시드로 회전 — 다양한 로스터 조합 커버
    const hi = i % nT;
    const ai = (hi + 1 + (i % (nT - 1))) % nT;
    const H = sq[ids[hi]];
    const A = sq[ids[ai]];
    const coach = { home: coachInfoOf(ids[hi]), away: coachInfoOf(ids[ai]) };

    const optsA: MatchOpts = { ...coach };                        // interventions 미지정
    const optsB: MatchOpts = { ...coach, interventions: [] };     // interventions: []

    const rA = simulateMatch(seed, H, A, optsA);
    const rB = simulateMatch(seed, H, A, optsB);

    const sA = ser(rA);
    const sB = ser(rB);
    if (sA !== sB) {
      mismatch++;
      if (!firstBad) {
        // 어느 필드가 다른지 특정
        let field = '(unknown)';
        const fields: (keyof SimResult)[] = ['homeSets', 'awaySets', 'setScores', 'points', 'subUse', 'subEvents', 'timeouts', 'setFirstServers'];
        for (const f of fields) {
          if (JSON.stringify(rA[f]) !== JSON.stringify(rB[f])) { field = String(f); break; }
        }
        firstBad = { seed, field };
      }
    }
  }

  log(`\n═══ 개입 회귀 가드 — interventions 미지정 vs [] (N=${N}) ═══`);
  if (mismatch === 0) {
    log(`  ✓ PASS N=${N} — 0 불일치 (개입 빈 로그 = 바이트 동일)`);
    process.exit(0);
  } else {
    log(`  ✗ FAIL — ${mismatch}/${N} 불일치. 첫 케이스 seed=${firstBad?.seed} field=${firstBad?.field}`);
    process.exit(1);
  }
}

main();
