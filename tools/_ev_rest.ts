// 검증 — 로드매니지먼트(#3): ①휴식이 실제로 발생 ②관전(보드 재시뮬)==순위(allResults) 일치
//   ③휴식 라인업도 리베로 유지·6인 성립 ④경합기엔 미발동(굳은 순위만).
//   핵심: 세 경로(순위 재시뮬 러닝 / restedOnDay teamClinch(day-1) / 보드)가 동일 휴식 집합을 내야 결정론 유지.
//   Usage: npx tsx tools/_ev_rest.ts
import { resetLeagueBase, SEASON, LEAGUE, getTeam, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { restedOnDay } from '../data/rotation';
import { seasonResults } from '../data/standings';
import { teamClinch } from '../data/clinch';
import { buildLineup } from '../engine/lineup';
import { simulateMatch } from '../engine/match';

const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();
const days = [...new Set(SEASON.map((f) => f.dayIndex))].sort((a, b) => a - b);

// ① 휴식 발생 + ④ 경합기 미발동 + ③ 리베로 유지
let restTeamDays = 0, restPlayers = 0, contentionRest = 0, liberoLost = 0, sample = '';
for (const d of days) {
  for (const t of LEAGUE.teams) {
    const r = restedOnDay(t.id, d);
    if (!r.size) continue;
    restTeamDays++; restPlayers += r.size;
    const c = teamClinch(t.id, d - 1);
    if (c && c.state === 'contention') contentionRest++; // 경합기 휴식(있으면 안 됨)
    const played = availableTeamPlayers(t.id, d).filter((p) => !r.has(p.id));
    const lu = buildLineup(played);
    if (!lu.libero) liberoLost++; // 휴식 후에도 리베로는 유지돼야
    if (!sample) {
      const names = availableTeamPlayers(t.id, d).filter((p) => r.has(p.id)).map((p) => `${p.name}(${p.age})`);
      sample = `${getTeam(t.id)?.name} day${d}(${c?.state}) 휴식: ${names.join(', ')}`;
    }
  }
}

// ② 관전(보드 방식 재시뮬) == 순위(allResults 행)
const allRows = seasonResults(Number.MAX_SAFE_INTEGER);
let restedFixtures = 0, mismatch = 0;
for (const f of SEASON) {
  const hr = restedOnDay(f.homeTeamId, f.dayIndex), ar = restedOnDay(f.awayTeamId, f.dayIndex);
  if (!hr.size && !ar.size) continue;
  restedFixtures++;
  const hs = availableTeamPlayers(f.homeTeamId, f.dayIndex).filter((p) => !hr.has(p.id));
  const as = availableTeamPlayers(f.awayTeamId, f.dayIndex).filter((p) => !ar.has(p.id));
  const sim = simulateMatch(f.seed, hs, as, { home: coachInfoOf(f.homeTeamId), away: coachInfoOf(f.awayTeamId) });
  const row = allRows.find((r) => r.fixtureId === f.id);
  if (!row || sim.homeSets !== row.homeSets || sim.awaySets !== row.awaySets) mismatch++;
}

log('═══ 로드매니지먼트(#3) 검증 ═══');
log(`① 휴식 발생: ${restTeamDays} 팀-경기 · 연인원 ${restPlayers}명  (예: ${sample || '없음'})`);
log(`④ 경합기 휴식(있으면 버그): ${contentionRest}`);
log(`③ 휴식 후 리베로 소실(있으면 버그): ${liberoLost}`);
log(`② 관전==순위 불일치(보드 재시뮬 vs allResults, 휴식 경기 ${restedFixtures}건): ${mismatch}`);
const ok = restTeamDays > 0 && contentionRest === 0 && liberoLost === 0 && mismatch === 0;
log(`\nREST OK = ${ok}`);
process.exit(ok ? 0 : 2);
