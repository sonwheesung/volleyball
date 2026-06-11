// 부상 극단 스트레스 — "전원 부상" 가정의 방어 깊이 점검.
//   npx tsx tools/simInjuryStress.ts
// (1) 동시부상 상한(CONCURRENT_CAP)으로 실제 명단은 절대 비지 않음을 확인.
// (2) 그럼에도 명단을 0명까지 강제로 줄이며 buildLineup + simulateMatch 가 크래시 없이 버티는지.

import { resetLeagueBase, getEvolvedTeamPlayers, LEAGUE, coachInfoOf, SEASON } from '../data/league';
import { availableTeamPlayers, seasonInjuryReport } from '../data/injury';
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { CONCURRENT_CAP } from '../engine/injury';

const log = (m: string) => process.stdout.write(m + '\n');

resetLeagueBase();
const t = LEAGUE.teams[0].id;
const t2 = LEAGUE.teams[1].id;
const full = getEvolvedTeamPlayers(t, 0);
const opp = getEvolvedTeamPlayers(t2, 0);

// (1) 실제 시즌에서 팀별 최대 동시부상 + 최소 출전가능 인원
const days = [...new Set(SEASON.map((f) => f.dayIndex))].sort((a, b) => a - b);
let maxConc = 0, minAvail = 99;
for (const d of days) {
  for (const team of LEAGUE.teams) {
    const c = seasonInjuryReport().filter((s) => s.teamId === team.id && s.from <= d && d <= s.to).length;
    maxConc = Math.max(maxConc, c);
    minAvail = Math.min(minAvail, availableTeamPlayers(team.id, d).length);
  }
}
log(`\n═══ 부상 극단 스트레스 ═══`);
log(`(1) 실제 시즌 — 팀 최대 동시부상 ${maxConc} (상한 ${CONCURRENT_CAP}) · 최소 출전가능 ${minAvail}명`);
log(`    → 상한 ${CONCURRENT_CAP}명 때문에 명단은 절대 비지 않음(전원 부상 불가).\n`);

// (2) 방어 깊이 — 명단을 강제로 줄여가며 크래시 여부
log(`(2) 명단 강제 축소 — buildLineup + simulateMatch 방어 충원 동작:`);
for (const n of [full.length, 8, 7, 6, 4, 2, 1, 0]) {
  const roster = full.slice(0, n);
  try {
    const lu = buildLineup(roster);
    const sixValid = lu.six.filter((p) => p && p.id).length;
    const uniq = new Set(lu.six.filter(Boolean).map((p) => p.id)).size;
    const sim = simulateMatch(123, roster, opp, { home: coachInfoOf(t), away: coachInfoOf(t2) });
    log(`  ${String(n).padStart(2)}명: six유효 ${sixValid}/6(고유 ${uniq}) · 리베로 ${lu.libero ? 'O' : '×'} · 경기 ${sim.homeSets}-${sim.awaySets} ✅`);
  } catch (e) {
    const msg = (e as Error).message;
    // 0명은 설계상 불가능 상태(부상 상한 3·방출 하한 ROSTER_MIN이 원천 차단) — 정체불명
    // TypeError가 아니라 buildLineup의 명시적 거부 메시지면 정상.
    if (n === 0 && msg.includes('빈 로스터')) log(`  ${String(n).padStart(2)}명: 명시적 거부 ✅ — "${msg}"`);
    else log(`  ${String(n).padStart(2)}명: ❌ 예외 — ${msg}`);
  }
}
log('');
