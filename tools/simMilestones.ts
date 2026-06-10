// 마일스톤 sanity — 통산 누적을 포함해 N시즌 진행하며 기록 경신을 출력.
//   npx tsx tools/simMilestones.ts [시즌=25]
// store.endSeason 의 accrueCareer 경로를 재현(통산 적립). hof=[] 라 레전드 추월은 생략.

import { resetLeagueBase, getTeam, teamScoutReveal, commitPlayerBase, commitRosters } from '../data/league';
import { buildDraftContext } from '../data/draftSetup';
import { resolveDraft } from '../engine/draft';
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { accrueCareer } from '../engine/production';
import { detectSeasonMilestones } from '../data/milestones';

const log = (m: string) => process.stdout.write(m + '\n');

/** advanceOffseason + 통산 누적(accrueCareer) — store.endSeason 재현 */
function advance(season: number): void {
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
  commitPlayerBase(snapshot);
  commitRosters(filled.rosters);
}

const N = Math.max(1, Number(process.argv[2]) || 25);
resetLeagueBase();
let total = 0;
log(`\n═══ 마일스톤 sanity · ${N}시즌 ═══`);
for (let s = 0; s < N; s++) {
  const ms = detectSeasonMilestones(s, []);
  if (ms.length) {
    log(`\n── ${s + 1}시즌 (${ms.length}건) ──`);
    for (const m of ms) log(`${m.big ? '★' : '·'} [${m.kind}] ${m.text}`);
    total += ms.length;
  }
  advance(s);
}
log(`\n총 ${total}건 — 개인 통산 임계 + 구단 기록 경신`);
