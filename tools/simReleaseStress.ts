// 방출 극단 스트레스 — "선수 전원 방출" 시 크래시 여부 + 실제 영향 범위.
//   npx tsx tools/simReleaseStress.ts
// released(방출)는 activeRoster(표시·페이롤)에서만 필터되고, 경기 경로(standings·production·
// injury)는 커밋된 rosters를 읽는다 → 방출이 시뮬에 영향을 주는지 직접 확인.

import { resetLeagueBase, getEvolvedTeamPlayers, LEAGUE, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { activeRoster, payroll } from '../data/roster';
import { computeStandings } from '../data/standings';
import { simulateMatch } from '../engine/match';
import { teamOverall } from '../engine/overall';

const log = (m: string) => process.stdout.write(m + '\n');

resetLeagueBase();
const t = LEAGUE.teams[0].id;
const t2 = LEAGUE.teams[1].id;
const full = getEvolvedTeamPlayers(t, 0);
const allReleased = full.map((p) => p.id); // 전원 방출

log('\n═══ 방출 극단 스트레스 — 선수 전원 방출 ═══');

// (1) 표시 계층 — activeRoster/payroll/teamOverall 빈 배열 안전성
try {
  const active = activeRoster(full, {}, allReleased);
  log(`(1) 표시 계층:`);
  log(`    활성 로스터 ${active.length}명 (전원 방출 → 0 기대)`);
  log(`    페이롤 ${payroll(active)}만 · teamOverall(빈) ${teamOverall(active)} · teamOverall(전체) ${teamOverall(full)}`);
  log(`    → 빈 배열에도 크래시 없음(가드 동작).`);
} catch (e) {
  log(`    ❌ 표시 계층 예외 — ${(e as Error).message}`);
}

// (2) 경기 계층 — released를 보지 않음을 확인(시뮬은 커밋 명단 사용)
try {
  const availLen = availableTeamPlayers(t, 0).length;
  const sim = simulateMatch(123, getEvolvedTeamPlayers(t, 0), getEvolvedTeamPlayers(t2, 0), {
    home: coachInfoOf(t), away: coachInfoOf(t2),
  });
  const standings = computeStandings(Number.MAX_SAFE_INTEGER);
  const myRow = standings.find((s) => s.teamId === t);
  log(`\n(2) 경기 계층 (released 무시 — 커밋 rosters 사용):`);
  log(`    출전가능 인원 ${availLen}명 (방출과 무관, 전체 명단 유지)`);
  log(`    경기 시뮬 ${sim.homeSets}-${sim.awaySets} ✅ · 시즌 순위 산출 ${myRow ? '정상' : '실패'}`);
  log(`    → 방출은 표시·페이롤 전용. 경기 결과·순위·생산은 영향 없음(크래시 없음).`);
} catch (e) {
  log(`    ❌ 경기 계층 예외 — ${(e as Error).message}`);
}

log('');
