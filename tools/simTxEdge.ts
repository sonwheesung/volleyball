// 시즌 중 이동 엣지 배터리 — "말도 안 되는 행위"가 가드에 막히고, 뚫려도 크래시 없는지.
//   npx tsx tools/simTxEdge.ts
// (1) FA 풀 멤버십: 소속 선수는 풀 밖, 방출자는 풀 안(두 명단 중복 영입 차단의 근거)
// (2) 거래 캐시 신선도: 방출 주입 즉시 standings/production이 달라진다(txVersion 캐시 키)
// (3) AI 부상 FA 회피: AI 영입 선수는 영입일에 부상 중이면 안 된다
// (4) 방출↔영입 난타(churn): 최종 명단 원상복귀 + 재계산 결정론
// (5) 퇴화 명단: 세터 0명 / 리베로 스택 — buildLineup·경기·보드 좌표 크래시 없음

import { resetLeagueBase, LEAGUE, getEvolvedTeamPlayers, coachInfoOf } from '../data/league';
import {
  setTxContext, rosterIdsOnDay, availableFAsOnDay, seasonTxLog, injuredOnDay, type Tx,
} from '../data/dynamics';
import { computeStandings } from '../data/standings';
import { leagueProduction } from '../data/production';
import { buildLineup } from '../engine/lineup';
import { simulateMatch } from '../engine/match';
import { receiveFormation, switchedSpots } from '../components/courtLayout';

const log = (m: string) => process.stdout.write(m + '\n');
let fails = 0;
const check = (ok: boolean, name: string, detail = '') => {
  log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails++;
};

resetLeagueBase();
const tA = LEAGUE.teams[0].id;
const tB = LEAGUE.teams[1].id;
const squadA = getEvolvedTeamPlayers(tA, 0);
const squadB = getEvolvedTeamPlayers(tB, 0);

log('\n═══ 시즌 중 이동 엣지 배터리 ═══');

// (1) FA 풀 멤버십
log('(1) FA 풀 멤버십:');
setTxContext([], [], tA);
const fa0 = new Set(availableFAsOnDay(0));
check(!squadA.some((p) => fa0.has(p.id)) && !squadB.some((p) => fa0.has(p.id)),
  '소속 선수는 FA 풀에 없음', `풀 ${fa0.size}명`);
const star = squadA[0];
setTxContext([{ day: 0, teamId: tA, playerId: star.id, kind: 'release' }], [], '');
check(availableFAsOnDay(0).includes(star.id), '방출자는 즉시 FA 풀 진입', star.name);
check(!rosterIdsOnDay(tA, 0).includes(star.id), '방출자는 명단에서 제외');

// (2) 거래 캐시 신선도 — standings/production이 즉시 반영되는가
log('(2) 거래 캐시 신선도:');
setTxContext([], [], tA);
const winsBefore = computeStandings(Number.MAX_SAFE_INTEGER).find((s) => s.teamId === tA)!.wins;
const prod0 = leagueProduction(Number.MAX_SAFE_INTEGER);
const byPoints = squadA.slice().sort((a, b) => (prod0.get(b.id)?.points ?? 0) - (prod0.get(a.id)?.points ?? 0));
const scorer = byPoints[0]; // 팀 내 최다 득점자
const prodBefore = prod0.get(scorer.id)?.points ?? 0;
const topReleases: Tx[] = byPoints.slice(0, 6).map((p) => ({ day: 0, teamId: tA, playerId: p.id, kind: 'release' as const }));
setTxContext(topReleases, [], '');
const winsAfter = computeStandings(Number.MAX_SAFE_INTEGER).find((s) => s.teamId === tA)!.wins;
const prodAfter = leagueProduction(Number.MAX_SAFE_INTEGER).get(scorer.id)?.points ?? 0;
check(winsAfter !== winsBefore, '주축 6명 방출 → 순위표 즉시 변화', `${winsBefore}승 → ${winsAfter}승`);
check(prodAfter < prodBefore, '방출 득점원 생산 즉시 감소', `${prodBefore} → ${prodAfter}`);

// (3) AI 부상 FA 회피 — 세터 구멍을 만들어 AI 영입을 유발하고, 영입일 부상 여부 검사
log('(3) AI 영입 건전성:');
const sReleases: Tx[] = [];
for (const t of LEAGUE.teams.slice(0, 4)) {
  for (const p of getEvolvedTeamPlayers(t.id, 0).filter((p) => p.position === 'S')) {
    sReleases.push({ day: 0, teamId: t.id, playerId: p.id, kind: 'release' });
  }
}
setTxContext(sReleases, [], '');
const txLog = seasonTxLog();
const aiSigns = txLog.filter((t) => t.kind === 'sign');
const injuredSigns = aiSigns.filter((t) => injuredOnDay(t.day).has(t.playerId));
check(aiSigns.length > 0, 'AI 긴급 영입 발생', `${aiSigns.length}건`);
check(injuredSigns.length === 0, 'AI는 부상 중 FA를 영입하지 않음', `위반 ${injuredSigns.length}건`);

// (4) 방출↔영입 난타 — 최종 명단 원상복귀 + 결정론
log('(4) 방출↔영입 churn:');
const churn: Tx[] = [];
for (let d = 0; d < 50; d++) {
  churn.push({ day: d * 2, teamId: tA, playerId: star.id, kind: 'release' });
  churn.push({ day: d * 2 + 1, teamId: tA, playerId: star.id, kind: 'sign' });
}
setTxContext(churn, [], tA);
const idsEnd = rosterIdsOnDay(tA, 999);
check(idsEnd.includes(star.id) && idsEnd.length === squadA.length, '100건 난타 후 명단 원상복귀', `${idsEnd.length}명`);
const log1 = JSON.stringify(seasonTxLog());
setTxContext(churn, [], tA); // 같은 입력 재설정 → 같은 txLog
check(JSON.stringify(seasonTxLog()) === log1, '재계산 결정론(txLog 동일)');

// (5) 퇴화 명단 — 세터 0명 / 리베로 스택
log('(5) 퇴화 명단:');
setTxContext([], [], tA);
try {
  const noS = squadA.filter((p) => p.position !== 'S');
  const lu = buildLineup(noS);
  const sim = simulateMatch(7, noS, squadB, { home: coachInfoOf(tA), away: coachInfoOf(tB) });
  const rf = receiveFormation('home', lu, 0, 360, 500);
  const sw = switchedSpots('home', lu, 0, true, 360, 500);
  const coordsOk = [0, 1, 2, 3, 4, 5].every((i) =>
    Number.isFinite(rf[i]?.x ?? sw.pos[i].x) && Number.isFinite(sw.pos[i].x) && Number.isFinite(sw.pos[i].y));
  check(lu.six.filter(Boolean).length === 6 && coordsOk, '세터 0명: 라인업·경기·보드 좌표 정상', `경기 ${sim.homeSets}-${sim.awaySets}`);
} catch (e) {
  check(false, '세터 0명', (e as Error).message);
}
try {
  const lib = squadA.find((p) => p.position === 'L') ?? squadA[0];
  const stack = [
    ...squadA.filter((p) => p.position === 'OH').slice(0, 2),
    ...Array.from({ length: 8 }, (_, i) => ({ ...lib, id: `clone-L-${i}`, name: `리베로${i}` })),
  ];
  const lu = buildLineup(stack);
  const sim = simulateMatch(7, stack, squadB, { home: coachInfoOf(tA), away: coachInfoOf(tB) });
  check(lu.six.filter(Boolean).length === 6, '리베로 스택(OH2+L8): 크래시 없음(퇴화 허용)',
    `six 내 L ${lu.six.filter((p) => p.position === 'L').length}명 · 경기 ${sim.homeSets}-${sim.awaySets}`);
} catch (e) {
  check(false, '리베로 스택', (e as Error).message);
}
setTxContext([], [], tA);

log(fails === 0 ? '\n✅ 엣지 배터리 전부 통과' : `\n❌ ${fails}건 실패`);
process.exit(fails === 0 ? 0 : 1);
