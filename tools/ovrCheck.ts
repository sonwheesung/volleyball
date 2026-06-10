// OVR↔실전력 정합 점검 — 팀 표시 OVR vs 시즌 승수 상관(0시즌, 결정론).
//   npx tsx tools/ovrCheck.ts
import { resetLeagueBase, getEvolvedTeamPlayers, getTeam } from '../data/league';
import { computeStandings } from '../data/standings';
import { teamOverall } from '../engine/overall';

resetLeagueBase();
const st = computeStandings(Number.MAX_SAFE_INTEGER);
const rows = st.map((s) => ({
  name: (getTeam(s.teamId)?.name ?? s.teamId).split(' ').slice(-1)[0],
  ovr: teamOverall(getEvolvedTeamPlayers(s.teamId, 164)),
  wins: s.wins,
}));
const mx = rows.reduce((a, b) => a + b.ovr, 0) / rows.length;
const my = rows.reduce((a, b) => a + b.wins, 0) / rows.length;
let sxy = 0, sxx = 0, syy = 0;
for (const r of rows) { const dx = r.ovr - mx, dy = r.wins - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
console.log(`\nOVR↔승수 상관 r = ${(sxy / Math.sqrt(sxx * syy)).toFixed(3)} (1=완전 정합)`);
for (const r of rows) console.log(`  ${r.name.padEnd(6)} OVR ${r.ovr} → ${String(r.wins).padStart(2)}승`);
