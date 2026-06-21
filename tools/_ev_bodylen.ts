// 측정 — 뉴스 본문 길이 분포(사용자 보고 2026-06-21: 본문 100자도 안 됨, 빈약).
//   simNews와 동일 경로로 피드 생성 후 kind별 본문 글자수 min/중앙/max + 샘플.
//   Usage: npx tsx tools/_ev_bodylen.ts [시즌=15]
import { resetLeagueBase, getTeam, teamScoutReveal, commitPlayerBase, commitRosters, LEAGUE } from '../data/league';
import { buildDraftContext } from '../data/draftSetup';
import { resolveDraft } from '../engine/draft';
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { accrueCareer } from '../engine/production';
import { currentSeasonAwards } from '../data/awards';
import { detectSeasonMilestones } from '../data/milestones';
import { buildPlayoffs, seriesByTeam } from '../data/playoffs';
import { computeStandings, seasonStreaks } from '../data/standings';
import { buildNewsFeed } from '../data/news';
import type { Milestone, SeasonArchive } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const MAX = Number.MAX_SAFE_INTEGER;
function advance(season: number): void {
  const ctx = buildDraftContext('', {}, {}, [], false, [], season + 1);
  const snapshot = ctx.snapshot;
  const styleOf = (tid: string) => getTeam(tid)?.coachStyle ?? 'balanced';
  const drafted = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], '', [], styleOf, teamScoutReveal);
  for (const p of drafted.picked) snapshot[p.id] = p;
  const filled = fillRosters(drafted.rosters, (id) => snapshot[id], season + 1);
  for (const r of filled.newPlayers) snapshot[r.id] = r;
  const prod = leagueProduction(MAX);
  for (const tid of Object.keys(filled.rosters))
    for (const id of filled.rosters[tid]) { const pr = prod.get(id); if (pr && snapshot[id]) snapshot[id] = accrueCareer(applyMatchXp(snapshot[id], pr), pr); }
  commitPlayerBase(snapshot); commitRosters(filled.rosters);
}

const N = Math.max(1, Number(process.argv[2]) || 15);
const MY = LEAGUE.teams[0].id;
resetLeagueBase();
const archive: SeasonArchive[] = [];
const allMs: Milestone[] = [];
for (let s = 0; s < N; s++) {
  const table = computeStandings(MAX);
  const record: Record<string, [number, number]> = {};
  for (const r of table) record[r.teamId] = [r.wins, r.losses];
  const po = buildPlayoffs(s);
  archive.push({ season: s, championId: po.championId ?? '', awards: currentSeasonAwards(s),
    standings: table.map((r) => r.teamId), streaks: seasonStreaks(MAX), series: seriesByTeam(po), record });
  allMs.push(...detectSeasonMilestones(s, []));
  advance(s);
}
const feed = buildNewsFeed(archive, allMs, [], N, [], [], MAX, MY, []);

const byKind = new Map<string, number[]>();
const sample = new Map<string, string>();
for (const n of feed) {
  const len = (n.body ?? '').length;
  if (!byKind.has(n.kind)) byKind.set(n.kind, []);
  byKind.get(n.kind)!.push(len);
  if (!sample.has(n.kind)) sample.set(n.kind, n.body ?? '');
}
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const all = feed.map((n) => (n.body ?? '').length);
log(`═══ 뉴스 본문 길이(글자수) · ${N}시즌 ${feed.length}건 ═══`);
log(`전체: min ${Math.min(...all)} · 중앙 ${med(all)} · max ${Math.max(...all)} · 100자미만 ${all.filter((l) => l < 100).length}건(${Math.round(all.filter((l) => l < 100).length / all.length * 100)}%)`);
log('\nkind별 (min/중앙/max · 건수):');
for (const [k, arr] of [...byKind].sort((a, b) => med(a[1]) - med(b[1])))
  log(`  ${k.padEnd(10)} ${String(Math.min(...arr)).padStart(3)}/${String(med(arr)).padStart(3)}/${String(Math.max(...arr)).padStart(3)} · ${arr.length}건`);
log('\n샘플 본문(kind별 1건):');
for (const [k, b] of sample) log(`  [${k}] (${b.length}자) ${b}`);
