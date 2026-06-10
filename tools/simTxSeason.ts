// 시즌 중 이동 풀루프 sanity — store.endSeason 경로 재현(거래 적용 + 다음 FA풀 산출).
//   npx tsx tools/simTxSeason.ts [시즌=30]
// 오프시즌 잔류 FA가 풀에 쌓이고, 구멍 생긴 AI 팀이 영입하는지 + 무결성(로스터≤18)·결정론.

import { resetLeagueBase, getTeam, teamScoutReveal, commitPlayerBase, commitRosters, currentRosters, getEvolvedTeamPlayers, LEAGUE } from '../data/league';
import { setTxContext, seasonTxLog } from '../data/dynamics';
import { buildDraftContext } from '../data/draftSetup';
import { resolveDraft } from '../engine/draft';
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { accrueCareer } from '../engine/production';
import { teamOverall } from '../engine/overall';

const log = (m: string) => process.stdout.write(m + '\n');

function advanceWithTx(season: number, faPool: string[]): { aiSigns: number; nextFaPool: string[]; maxRoster: number } {
  // 방출 주입(웨이버 시뮬): 매 시즌 한 팀의 OH 3명 방출(day0) → 풀 형성 + 구멍 → AI 영입
  const victim = LEAGUE.teams[season % LEAGUE.teams.length].id;
  const rel = getEvolvedTeamPlayers(victim, 0).filter((p) => p.position === 'OH').slice(0, 3)
    .map((p) => ({ day: 0, teamId: victim, playerId: p.id, kind: 'release' as const }));
  setTxContext(rel, [...faPool, ...rel.map((t) => t.playerId)], ''); // 전 구단 AI
  const txLog = seasonTxLog();  // dynamics: 방출 풀 + 부상 구멍 → AI 영입
  const aiSigns = txLog.filter((t) => t.kind === 'sign').length;

  // 거래를 명단에 반영(오프시즌 전)
  const finalR: Record<string, string[]> = {};
  const cur = currentRosters();
  for (const tid of Object.keys(cur)) finalR[tid] = [...cur[tid]];
  for (const tx of txLog) {
    const arr = finalR[tx.teamId] ?? [];
    if (tx.kind === 'release') finalR[tx.teamId] = arr.filter((id) => id !== tx.playerId);
    else if (!arr.includes(tx.playerId)) finalR[tx.teamId] = [...arr, tx.playerId];
  }
  commitRosters(finalR);

  // 오프시즌(롤오버·은퇴·FA·드래프트·충원·성장)
  const ctx = buildDraftContext('', {}, {}, [], false, [], season + 1);
  const snapshot = ctx.snapshot;
  const styleOf = (tid: string) => getTeam(tid)?.coachStyle ?? 'balanced';
  const drafted = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], '', [], styleOf, teamScoutReveal);
  for (const p of drafted.picked) snapshot[p.id] = p;
  const filled = fillRosters(drafted.rosters, (id) => snapshot[id], season + 1);
  for (const r of filled.newPlayers) snapshot[r.id] = r;
  const prod = leagueProduction(Number.MAX_SAFE_INTEGER);
  for (const tid of Object.keys(filled.rosters)) {
    for (const id of filled.rosters[tid]) {
      const pr = prod.get(id);
      if (pr && snapshot[id]) snapshot[id] = accrueCareer(applyMatchXp(snapshot[id], pr), pr);
    }
  }
  const rosteredNext = new Set(Object.values(filled.rosters).flat());
  const retiredSet = new Set(ctx.retired);
  const nextFaPool = Object.keys(snapshot).filter((id) => !rosteredNext.has(id) && !retiredSet.has(id));

  commitPlayerBase(snapshot);
  commitRosters(filled.rosters);
  const maxRoster = Math.max(...Object.values(finalR).map((r) => r.length));
  return { aiSigns, nextFaPool, maxRoster };
}

const N = Math.max(1, Number(process.argv[2]) || 30);
resetLeagueBase();
let faPool: string[] = [];
let totalSigns = 0, maxRosterEver = 0, violations = 0;

log(`\n═══ 시즌 중 이동 풀루프 · ${N}시즌 ═══`);
log(`시즌  AI영입  FA풀  최대로스터`);
for (let s = 0; s < N; s++) {
  const r = advanceWithTx(s, faPool);
  totalSigns += r.aiSigns;
  maxRosterEver = Math.max(maxRosterEver, r.maxRoster);
  if (r.maxRoster > 18) violations++;
  if (s < 12 || r.aiSigns > 0) log(`${String(s + 1).padStart(3)}   ${String(r.aiSigns).padStart(4)}   ${String(faPool.length).padStart(4)}   ${r.maxRoster}`);
  faPool = r.nextFaPool;
}

// 결정론 재확인: 같은 상태 재계산
resetLeagueBase();
let fp: string[] = [];
let signs2 = 0;
for (let s = 0; s < N; s++) { const r = advanceWithTx(s, fp); signs2 += r.aiSigns; fp = r.nextFaPool; }

log(`\n총 AI 영입 ${totalSigns}건 · 최대 로스터 ${maxRosterEver}명 · 정원초과(>18) ${violations}건`);
log(`결정론: 재실행 AI영입 ${signs2}건 = ${totalSigns === signs2 ? '✅ 동일' : '❌ 불일치'}`);
log(`무결성: ${maxRosterEver <= 18 ? '✅ 로스터 ≤ 18' : '❌ 정원 초과'}`);
log('');
