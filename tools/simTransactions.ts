// 시즌 중 이동 sanity — 방출→FA→AI 영입(구멍 메우기)→날짜 인지→결정론.
//   npx tsx tools/simTransactions.ts
// 시나리오: 두 AI 팀에서 OH를 방출해 FA 풀 형성 + 구멍 발생 → 레그 경계에 AI가 OH 영입.

import { resetLeagueBase, getTeam, getPlayer, getEvolvedTeamPlayers, LEAGUE } from '../data/league';
import { setTxContext, seasonTxLog, rosterIdsOnDay, availableTeamPlayers } from '../data/dynamics';
import { healthyByPos } from '../engine/transactions';
import type { Tx } from '../data/dynamics';

const log = (m: string) => process.stdout.write(m + '\n');
const short = (tid: string) => (getTeam(tid)?.name ?? tid).split(' ').slice(-1)[0];
const nm = (id: string) => getPlayer(id)?.name ?? id;

resetLeagueBase();
const [teamA, teamB, teamC] = LEAGUE.teams.map((t) => t.id); // teamB = 플레이어 팀(AI 제외)

// 두 AI 팀(A·C)에서 OH 4명씩 방출(5→1) → FA 풀 형성 + OH 구멍(healthy 1 < 필요 2) → AI 영입 트리거
const ohOf = (tid: string) => getEvolvedTeamPlayers(tid, 0).filter((p) => p.position === 'OH').slice(0, 4);
const released = [...ohOf(teamA), ...ohOf(teamC)];
const relA = ohOf(teamA).map((p) => ({ day: 0, teamId: teamA, kind: 'release' as const, playerId: p.id }));
const relC = ohOf(teamC).map((p) => ({ day: 0, teamId: teamC, kind: 'release' as const, playerId: p.id }));
const playerTx = [...relA, ...relC];
const faPool = released.map((p) => p.id);

setTxContext(playerTx, faPool, teamB);

log(`\n═══ 시즌 중 이동 sanity ═══`);
log(`플레이어 팀(AI 제외): ${short(teamB)}`);
log(`방출(day0): ${short(teamA)} OH ${relA.map((t) => nm(t.playerId)).join(', ')} / ${short(teamC)} OH ${relC.map((t) => nm(t.playerId)).join(', ')}`);
log(`FA 풀: ${faPool.map(nm).join(', ')}`);

const txLog = seasonTxLog();
const signs = txLog.filter((t) => t.kind === 'sign');
log(`\n── 거래 로그(${txLog.length}건) ──`);
for (const t of txLog) log(`  day${String(t.day).padStart(3)} ${t.kind === 'sign' ? '영입' : '방출'} ${short(t.teamId)} ← ${nm(t.playerId)}`);

// A·C의 OH healthy 가용: day0(방출 직후) vs 시즌말(영입 후)
const ohCount = (tid: string, d: number) => healthyByPos(availableTeamPlayers(tid, d)).OH;
log(`\n── OH 가용 회복 ──`);
for (const tid of [teamA, teamC]) {
  log(`  ${short(tid)}: 방출직후(day1) ${ohCount(tid, 1)}명 → 시즌말(day160) ${ohCount(tid, 160)}명`);
}

// 날짜 인지: 방출자가 day0 이후 A 명단에서 빠졌는지
const aStart = rosterIdsOnDay(teamA, 0).length;
const aLater = rosterIdsOnDay(teamA, 160).length;
log(`\n날짜 인지 명단 ${short(teamA)}: day0 ${aStart}명 → day160 ${aLater}명`);

// 결정론: 같은 컨텍스트 재주입 → 동일 txLog
setTxContext(playerTx, faPool, teamB);
const txLog2 = seasonTxLog();
const same = JSON.stringify(txLog) === JSON.stringify(txLog2);
log(`\n결정론: 재계산 txLog 동일 ${same ? '✅' : '❌'}`);
log(`AI 영입 발생: ${signs.length > 0 ? `✅ ${signs.length}건` : '❌ 없음'}`);
log('');
