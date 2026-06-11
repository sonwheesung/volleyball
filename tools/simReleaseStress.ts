// 방출 극단 스트레스 — "선수 전원 방출" 시 크래시 여부 + 실제 영향 범위.
//   npx tsx tools/simReleaseStress.ts
// 방출의 시뮬 반영은 inSeasonTx 경로(TRANSACTION_SYSTEM·rosterIdsOnDay)이고, released[]는
// 표시·페이롤 플래그다. 스토어 release()는 정원 하한(ROSTER_MIN) 게이트로 전원 방출을 차단,
// buildLineup은 빈 로스터를 명시적으로 거부(이중 방어) — 세 층을 모두 검사한다.

import { resetLeagueBase, getEvolvedTeamPlayers, LEAGUE, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { setTxContext, rosterIdsOnDay } from '../data/dynamics';
import { ROSTER_MIN, canRelease } from '../engine/transactions';
import { buildLineup } from '../engine/lineup';
import type { Tx } from '../data/dynamics';
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
  log(`\n(2) 경기 계층 (released[] 플래그만으론 무영향 — 시뮬 반영은 inSeasonTx 경로):`);
  log(`    출전가능 인원 ${availLen}명 (플래그와 무관)`);
  log(`    경기 시뮬 ${sim.homeSets}-${sim.awaySets} ✅ · 시즌 순위 산출 ${myRow ? '정상' : '실패'}`);
} catch (e) {
  log(`    ❌ 경기 계층 예외 — ${(e as Error).message}`);
}

// (3) 거래 계층 — 전원 방출이 가드들에 막히는가(스토어 게이트 + 엔진 명시적 거부)
try {
  log(`\n(3) 거래 계층 (inSeasonTx — 실제 시뮬 반영 경로):`);
  // 게이트: 하한까지만 방출 허용
  let size = full.length;
  let allowed = 0;
  while (canRelease(size)) { size--; allowed++; }
  log(`    정원 하한 게이트: ${full.length}명 중 방출 허용 ${allowed}명 → 잔여 ${size}명 (하한 ${ROSTER_MIN}) ${size === ROSTER_MIN ? '✅' : '❌'}`);
  // 게이트를 우회해 전원 방출 tx를 주입해도(세이브 조작 등) 명단·라인업이 어떻게 되는지
  const txAll: Tx[] = full.map((p) => ({ day: 0, teamId: t, playerId: p.id, kind: 'release' as const }));
  setTxContext(txAll, [], t);
  const idsAfter = rosterIdsOnDay(t, 10);
  let lineupMsg: string;
  try { buildLineup([]); lineupMsg = '❌ 빈 로스터를 거부하지 않음'; }
  catch (e) { lineupMsg = `빈 로스터 명시적 거부 ✅ ("${(e as Error).message}")`; }
  log(`    가드 우회 주입 시 day10 명단 ${idsAfter.length}명 → buildLineup: ${lineupMsg}`);
  setTxContext([], [], t);
} catch (e) {
  log(`    ❌ 거래 계층 예외 — ${(e as Error).message}`);
}

log('');
