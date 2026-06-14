// 사건·사고(스캔들) 선수 이력 추적 — N시즌을 굴리며 음주운전·도박·SNS설화·무단이탈을
// 누가·언제·어느 팀에서 쳤는지 전부 추적한다. 결정론(`scandal:{id}:{age}`)이라 재현 가능.
//   npx tsx tools/simScandalTrace.ts [시즌=200]
// 출력: 연표(샘플) · 사안별/팀별 분포 · 재범 선수(팀 이동 이력 포함) · 정합성 검사.

import { LEAGUE, getTeam, getPlayer, resetLeagueBase, commitPlayerBase, commitRosters, teamScoutReveal, evolveOnDay, currentRosters } from '../data/league';
import { buildDraftContext } from '../data/draftSetup';
import { resolveDraft } from '../engine/draft';
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { seasonScandals, setOwnerContext } from '../data/dynamics';
import { SCANDAL_KO, type ScandalKind } from '../engine/scandal';

const log = (m: string) => process.stdout.write(m + '\n');
const seasons = Math.max(10, Number(process.argv[2]) || 200);
const tn = (id: string) => (getTeam(id)?.name ?? id).split(' ').slice(-1)[0];

resetLeagueBase();
const ids = LEAGUE.teams.map((t) => t.id);

interface Incident { season: number; playerId: string; name: string; age: number; pos: string; teamId: string; kind: ScandalKind; miss: number; }
const log_: Incident[] = [];
const byKind: Record<string, number> = {};
const byTeam: Record<string, number> = {};
let violations = 0;
const fail = (m: string) => { if (violations < 10) log(`  ❌ ${m}`); violations++; };

for (let s = 0; s < seasons; s++) {
  setOwnerContext([]);
  const rosters = currentRosters();
  for (const sc of seasonScandals()) {
    // 정합성: 사고 선수는 그 시즌 그 팀 소속이어야(귀속 정확)
    if (!(rosters[sc.teamId] ?? []).includes(sc.playerId)) fail(`s${s}: ${sc.playerId} 가 ${tn(sc.teamId)} 소속 아닌데 사고 귀속`);
    const p = evolveOnDay(sc.playerId, 0) ?? getPlayer(sc.playerId);
    log_.push({ season: s, playerId: sc.playerId, name: p?.name ?? sc.playerId, age: p?.age ?? 0, pos: p?.position ?? '?', teamId: sc.teamId, kind: sc.kind, miss: sc.missMatches });
    byKind[sc.kind] = (byKind[sc.kind] ?? 0) + 1;
    byTeam[sc.teamId] = (byTeam[sc.teamId] ?? 0) + 1;
  }

  // 오프시즌 진행(전 구단 AI)
  const ctx = buildDraftContext('', {}, {}, [], false, [], s + 1);
  const snapshot = ctx.snapshot;
  const styleOf = (teamId: string) => getTeam(teamId)?.coachStyle ?? 'balanced';
  const drafted = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], '', [], styleOf, teamScoutReveal);
  for (const p of drafted.picked) snapshot[p.id] = p;
  const filled = fillRosters(drafted.rosters, (id) => snapshot[id], s + 1);
  for (const rookie of filled.newPlayers) snapshot[rookie.id] = rookie;
  const seasonProd = leagueProduction(Number.MAX_SAFE_INTEGER);
  for (const tid of Object.keys(filled.rosters)) for (const id of filled.rosters[tid]) {
    const pr = seasonProd.get(id);
    if (pr && snapshot[id]) snapshot[id] = applyMatchXp(snapshot[id], pr);
  }
  commitPlayerBase(snapshot); commitRosters(filled.rosters);
  if ((s + 1) % 40 === 0) process.stderr.write(`  …${s + 1}/${seasons}시즌\n`);
}
setOwnerContext([]);

// 재범 추적 — 같은 선수의 사고 이력(팀 이동 포함)
const byPlayer = new Map<string, Incident[]>();
for (const i of log_) { const a = byPlayer.get(i.playerId) ?? []; a.push(i); byPlayer.set(i.playerId, a); }
const repeat = [...byPlayer.entries()].filter(([, a]) => a.length >= 2).sort((a, b) => b[1].length - a[1].length);

log(`\n═══ 사건·사고 이력 추적 — ${seasons}시즌 ═══`);
log(`▸ 총 ${log_.length}건 (${(log_.length / seasons).toFixed(2)}건/시즌) · 연루 선수 ${byPlayer.size}명`);
log(`\n▸ 사안별:`);
for (const k of ['dui', 'gambling', 'sns', 'awol'] as ScandalKind[]) {
  const n = byKind[k] ?? 0;
  log(`  ${SCANDAL_KO[k].padEnd(10)} ${String(n).padStart(3)}건 (${((n / Math.max(1, log_.length)) * 100).toFixed(0)}%)`);
}
log(`\n▸ 팀별 사고 건수:`);
for (const t of [...ids].sort((a, b) => (byTeam[b] ?? 0) - (byTeam[a] ?? 0))) {
  log(`  ${tn(t).padEnd(8)} ${String(byTeam[t] ?? 0).padStart(3)}건`);
}
log(`\n▸ 재범 선수(2회+) — 사고 이력·소속 추적:`);
if (!repeat.length) log('  (없음 — 모두 단발)');
for (const [pid, a] of repeat.slice(0, 15)) {
  const chron = a.sort((x, y) => x.season - y.season)
    .map((i) => `s${i.season} ${SCANDAL_KO[i.kind]}@${tn(i.teamId)}(${i.age}세)`).join(' → ');
  const teams = new Set(a.map((i) => i.teamId));
  log(`  ${a[0].name}(${a[0].pos}) ${a.length}회${teams.size > 1 ? ` · ${teams.size}개 팀 거침` : ''}: ${chron}`);
}
log(`\n▸ 최근 연표(마지막 12건):`);
for (const i of log_.slice(-12)) log(`  [s${i.season}] ${i.name}(${i.pos}/${i.age}세·${tn(i.teamId)}) — ${SCANDAL_KO[i.kind]} ${i.miss}경기 정지`);

log(violations === 0
  ? `\n✅ 정합성 위반 0건 — 모든 사고가 그 시즌 소속팀에 정확히 귀속(누가·언제·어느 팀)`
  : `\n❌ 정합성 위반 ${violations}건 — 위 로그 확인`);
process.exit(violations === 0 ? 0 : 1);
