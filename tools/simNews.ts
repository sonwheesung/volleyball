// 뉴스 피드 sanity + 무결성·변주 검사 — N시즌 누적 후 종합 피드.
//   npx tsx tools/simNews.ts [시즌=20]
// store.endSeason 누적 경로를 재현(archive에 순위·연승·플옵·승패도 채움 → 새 소재 발화).
// 검사: 크래시0·빈 헤드라인/본문0·newsKey 중복0·kind 카탈로그·변주 커버리지 + A/B 자가검증.

import { resetLeagueBase, getTeam, teamScoutReveal, commitPlayerBase, commitRosters, LEAGUE, SEASON } from '../data/league';
import { buildMatchBanners } from '../data/broadcast';
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
import { buildNewsFeed, newsKey } from '../data/news';
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
const MY = LEAGUE.teams[0].id;
resetLeagueBase();
const archive: SeasonArchive[] = [];
const allMs: Milestone[] = [];
for (let s = 0; s < N; s++) {
  const table = computeStandings(MAX);
  const record: Record<string, [number, number]> = {};
  for (const r of table) record[r.teamId] = [r.wins, r.losses];
  const po = buildPlayoffs(s);
  archive.push({
    season: s, championId: po.championId ?? '', awards: currentSeasonAwards(s),
    standings: table.map((r) => r.teamId), streaks: seasonStreaks(MAX), series: seriesByTeam(po), record,
  });
  allMs.push(...detectSeasonMilestones(s, []));
  advance(s);
}

// 라이브 시즌 = N(아카이브 0..N-1은 과거, 베이스는 N 진행 상태). 실시간 경기 소재는 시즌 N에서 발화.
// FA 이적(슬라이스3) 합성 — 내 팀 in/out + 무관 이적(노이즈, 기사 안 떠야). 실제 팀 id로 매달린참조 검사.
const T2 = LEAGUE.teams[1].id, T3 = LEAGUE.teams[2].id;
const transfers = [
  { season: N - 1, playerId: 'tr-in', name: '김이적', fromTeam: T2, toTeam: MY },
  { season: N - 1, playerId: 'tr-out', name: '박방출', fromTeam: MY, toTeam: T2 },
  { season: N - 1, playerId: 'tr-other', name: '최무관', fromTeam: T2, toTeam: T3 },
];
const feed = buildNewsFeed(archive, allMs, [], N, [], [], MAX, MY, transfers);

// ── 무결성 검사 ──
const V: string[] = [];
const emptyHead = feed.filter((n) => !n.headline || !n.headline.trim()).length;
const emptyBody = feed.filter((n) => !n.body || !n.body.trim()).length;
if (emptyHead) V.push(`빈 헤드라인 ${emptyHead}`);
if (emptyBody) V.push(`빈 본문 ${emptyBody}`);
const dupOf = (f: typeof feed) => { const seen = new Set<string>(); let d = 0; for (const n of f) { const k = newsKey(n); if (seen.has(k)) d++; seen.add(k); } return d; };
const dup = dupOf(feed);
if (dup) {
  V.push(`newsKey 중복 ${dup}`);
  const cnt = new Map<string, number>();
  for (const n of feed) cnt.set(newsKey(n), (cnt.get(newsKey(n)) ?? 0) + 1);
  log('  중복 키: ' + [...cnt].filter(([, c]) => c > 1).map(([k, c]) => `「${k}」×${c}`).join(' / '));
}
const badTeam = feed.filter((n) => n.teamId && !getTeam(n.teamId)).length;
if (badTeam) V.push(`매달린 teamId ${badTeam}`);

// ── kind 카탈로그(풍부함) ──
const byKind = new Map<string, number>();
for (const n of feed) byKind.set(n.kind, (byKind.get(n.kind) ?? 0) + 1);

// ── 변주 커버리지(같은 kind 내 본문 distinct — 높을수록 다양) ──
const seenBody = new Map<string, Set<string>>();
for (const n of feed) {
  if (!seenBody.has(n.kind)) seenBody.set(n.kind, new Set());
  seenBody.get(n.kind)!.add(n.body ?? '');
}

// ── 교차검증: 뉴스 트리플크라운 == broadcast.buildMatchBanners 트리플(두 경로 일치 = 재구현 오라클 방지) ──
let bcastTriples = 0;
for (const f of SEASON) bcastTriples += buildMatchBanners(f.homeTeamId, f.awayTeamId, f.dayIndex, null).filter((b) => b.kind === 'triple').length;
const newsTriples = feed.filter((n) => n.kind === 'match' && n.headline.includes('트리플 크라운')).length;
const tripleAgree = newsTriples === bcastTriples;

// ── A/B 자가검증: 같은 시즌 archive 중복 주입 → 중복 검사가 잡아야 ──
const abFeed = buildNewsFeed([...archive, archive[archive.length - 1]], allMs, [], N, [], [], MAX, MY, transfers);
const abDup = dupOf(abFeed) > dup;

log(`\n═══ 리그 뉴스 · ${N}시즌 (총 ${feed.length}건) ═══`);
log(`kind 종류=${byKind.size}: ${[...byKind].map(([k, c]) => `${k}:${c}`).join(' · ')}`);
log(`\n변주 커버리지(kind: distinct본문/총건수 — 높을수록 다양):`);
for (const [k, set] of seenBody) log(`  ${k}: ${set.size}/${byKind.get(k) ?? 0}`);
log(`\n무결성: ${V.length ? '❌ ' + V.join(' · ') : '✅ 위반 0(빈 헤드/본문·중복·매달린 teamId)'}`);
log(`[교차검증] 트리플크라운 news=${newsTriples} ↔ broadcast=${bcastTriples} 일치=${tripleAgree} (true여야 신뢰)`);
log(`[A/B] 중복 주입 시 newsKey 중복 검출=${abDup} (true여야 신뢰)`);

log(`\n── 최근 30건 ──`);
for (const n of feed.slice(0, 30)) log(`${n.big ? '★' : '·'} [${n.season + 1}][${n.kind}] ${n.headline}`);

const ok = V.length === 0 && abDup && tripleAgree;
log(`\nNEWS OK = ${ok}`);
process.exit(ok ? 0 : 2);
