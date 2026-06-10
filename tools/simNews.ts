// 뉴스 피드 sanity — N시즌 누적(시상+마일스톤) 후 종합 피드를 출력.
//   npx tsx tools/simNews.ts [시즌=20]
// store.endSeason 누적 경로를 재현. HOF는 생략(빈 배열) — 챔피언/시상/마일스톤/부상 종합 확인.

import { resetLeagueBase, getTeam, teamScoutReveal, commitPlayerBase, commitRosters } from '../data/league';
import { buildDraftContext } from '../data/draftSetup';
import { resolveDraft } from '../engine/draft';
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { accrueCareer } from '../engine/production';
import { currentSeasonAwards } from '../data/awards';
import { detectSeasonMilestones } from '../data/milestones';
import { buildPlayoffs } from '../data/playoffs';
import { buildNewsFeed } from '../data/news';
import type { Milestone, SeasonAwards } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');

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

const N = Math.max(1, Number(process.argv[2]) || 20);
resetLeagueBase();
const archive: { season: number; championId: string; awards?: SeasonAwards }[] = [];
const allMs: Milestone[] = [];
for (let s = 0; s < N; s++) {
  archive.push({ season: s, championId: buildPlayoffs(s).championId ?? '', awards: currentSeasonAwards(s) });
  allMs.push(...detectSeasonMilestones(s, []));
  advance(s);
}

const feed = buildNewsFeed(archive, allMs, [], N - 1);
log(`\n═══ 리그 뉴스 · ${N}시즌 누적 (총 ${feed.length}건, 최근 28건) ═══`);
for (const n of feed.slice(0, 28)) {
  log(`${n.big ? '★' : '·'} [${n.season + 1}시즌] ${n.headline}`);
}
log('');
