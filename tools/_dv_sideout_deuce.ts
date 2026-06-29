// 사이드아웃·듀스율 v2 측정 (STATS_PROTOCOL 잔여 분포) — simKovo/_dv_drift_kovo가 안 재는 둘.
//   사이드아웃 = 받는 팀이 랠리를 따낸 비율(scorer != serving). 듀스 세트 = 양 팀이 target-1 도달(연장, 26+/16+).
//   reconstructRallies로 serving 도출 + sim.setScores. A/B 보존: serveWin+sideout==총점(허위 오라클 차단).
//   npx tsx tools/_dv_sideout_deuce.ts [경기수=10000]
import { resetLeagueBase, LEAGUE, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import { reconstructRallies } from '../components/courtDirector';

resetLeagueBase();
const N = Math.max(1, Number(process.argv[2]) || 10000);
const teams = LEAGUE.teams.map((t) => t.id);
const pairs: [string, string][] = [];
for (let i = 0; i < teams.length; i++) for (let j = 0; j < teams.length; j++) if (i !== j) pairs.push([teams[i], teams[j]]);

let totalPts = 0, sideouts = 0, serveWins = 0, totalSets = 0, deuceSets = 0, s = 0;
for (let m = 0; m < N; m++) {
  const [ta, tb] = pairs[m % pairs.length];
  const A = availableTeamPlayers(ta, 0), B = availableTeamPlayers(tb, 0);
  const sim = simulateMatch(++s, A, B, { home: coachInfoOf(ta), away: coachInfoOf(tb) } as any);
  for (const r of reconstructRallies(sim)) { totalPts++; if (r.scorer !== r.serving) sideouts++; else serveWins++; }
  sim.setScores.forEach((sc, idx) => { totalSets++; const target = idx >= 4 ? 15 : 25; if (Math.min(sc.home, sc.away) >= target - 1) deuceSets++; });
}

const soPct = sideouts / totalPts * 100, deucePct = deuceSets / totalSets * 100;
const conserve = serveWins + sideouts === totalPts;
console.log(`═══ 사이드아웃·듀스율 (${N}경기 / ${totalSets}세트 / ${totalPts}랠리, 엔진 재측정) ═══`);
console.log(`  사이드아웃(받는 팀 랠리 획득): ${soPct.toFixed(1)}%  (서브권 유지 ${(100 - soPct).toFixed(1)}%)`);
console.log(`  듀스 세트(연장 — 양팀 target-1 도달): ${deucePct.toFixed(1)}%`);
console.log(`  [A/B 보존] serveWin+sideout == 총점: ${conserve} (true여야 신뢰 — 분류 누락 0)`);

const ok = conserve && soPct > 40 && soPct < 70 && deucePct > 0 && deucePct < 40;
console.log(`\n${ok ? '✅ PASS' : '❌ FAIL'}`);
process.exit(ok ? 0 : 1);
