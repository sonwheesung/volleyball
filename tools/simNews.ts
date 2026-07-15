// 뉴스 피드 sanity + 무결성·변주 검사 — N시즌 누적 후 종합 피드.
//   npx tsx tools/simNews.ts [시즌=20]
// store.endSeason 누적 경로를 재현(archive에 순위·연승·플옵·승패도 채움 → 새 소재 발화).
// 검사: 크래시0·빈 헤드라인/본문0·newsKey 중복0·kind 카탈로그·변주 커버리지 + A/B 자가검증.

import { resetLeagueBase, getTeam, teamScoutReveal, commitPlayerBase, commitRosters, LEAGUE, SEASON } from '../data/league';
import { buildMatchBanners } from '../data/broadcast';
import { buildDraftContext } from '../data/draftSetup';
import { resolveDraft } from '../engine/draft';
import { aiTargetOf } from '../data/rosterTarget'; // #116 프로덕션 우주 정합(2026-07-15)
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { accrueCareer } from '../engine/production';
import { currentSeasonAwards } from '../data/awards';
import { detectSeasonMilestones } from '../data/milestones';
import { buildPlayoffs, seriesByTeam } from '../data/playoffs';
import { computeStandings, seasonStreaks } from '../data/standings';
import { buildNewsFeed, newsKey, newsContentKey } from '../data/news';
import { sponsorStanceOf } from '../engine/sponsorStance';
import type { Milestone, SeasonArchive } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const MAX = Number.MAX_SAFE_INTEGER;

function advance(season: number): void {
  const ctx = buildDraftContext('', {}, {}, [], false, [], season + 1);
  const snapshot = ctx.snapshot;
  const styleOf = (tid: string) => getTeam(tid)?.coachStyle ?? 'balanced';
  const drafted = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], '', [], styleOf, teamScoutReveal, [], aiTargetOf());
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
// 내용 중복(같은 기사 두 번 방출) — contentKey(문구) 기준. newsKey는 §4.4 Step0부터 순번이라 유일성 보장 → 내용 중복은 contentKey로.
const dupOf = (f: typeof feed) => { const seen = new Set<string>(); let d = 0; for (const n of f) { const k = newsContentKey(n); if (seen.has(k)) d++; seen.add(k); } return d; };
const dup = dupOf(feed);
if (dup) {
  V.push(`내용 중복 ${dup}`);
  const cnt = new Map<string, number>();
  for (const n of feed) cnt.set(newsContentKey(n), (cnt.get(newsContentKey(n)) ?? 0) + 1);
  log('  중복 내용: ' + [...cnt].filter(([, c]) => c > 1).map(([k, c]) => `「${k}」×${c}`).join(' / '));
}
// 읽음 키 유일성 불변(§4.4 Step0) — 두 기사가 같은 newsKey면 하나 읽으면 둘 다 읽음 처리됨. 순번이라 항상 유일해야.
const keySeen = new Set<string>(); let keyDup = 0;
for (const n of feed) { const k = newsKey(n); if (keySeen.has(k)) keyDup++; keySeen.add(k); }
if (keyDup) V.push(`읽음키 충돌 ${keyDup}(newsKey 비유일 — 읽음추적 깨짐)`);
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

// ── n-gram 겹침 변주 가드(§4.4 Step4) — exact-distinct가 못 잡는 "거의 동일" 본문 검출(해시 붕괴류).
//   동종 기사 본문을 단어 3-shingle 집합으로 → distinct 본문 쌍별 Jaccard. open/close 공유로 기저 겹침은
//   있으니 "distinct인데 최대 겹침이 임계 초과"면 사실상 복제(변주 실패). 정본 지표(리뷰: "동일-open<15%" 대체).
const shingles = (s: string): Set<string> => {
  const w = s.replace(/[.,·—()"]/g, ' ').split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  return out;
};
const jac = (a: Set<string>, b: Set<string>): number => {
  if (!a.size || !b.size) return 0; let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
};
// 변주 비율 임계 가드(§4.4 Step4) — 고볼륨 kind(≥20건)는 distinct 본문 비율≥0.90.
//   해시 붕괴·셀렉터 축소를 실측으로 잡음(A/B 검증: broken hash milestone 0.775→발화 / fmix 0.988→통과).
//   n-gram 최대겹침(아래)은 "쌍 near-identical" 클래스라 분포 축소를 못 잡음 → 비율 가드가 그 사각을 메움.
//   소볼륨 kind(standing 7·match 9 등)는 정상적으로 폼이 적어 제외(오검 방지).
const RATIO_MIN = 0.9, RATIO_MINCOUNT = 20;
for (const [k, set] of seenBody) {
  const tot = byKind.get(k) ?? 0;
  if (tot < RATIO_MINCOUNT) continue;
  const ratio = set.size / tot;
  if (ratio < RATIO_MIN) V.push(`${k} 변주비율 ${ratio.toFixed(3)}<${RATIO_MIN}(${set.size}/${tot} — 셀렉터 축소/해시 붕괴 의심)`);
}
const OVERLAP_MAX = 0.9; // distinct 본문인데 3-shingle Jaccard>이 값 = "거의 동일"(변주 실패)
const NGRAM_CAP = 200;   // kind당 표본 상한(쌍 폭발 방지) — 초과 시 로그(무언 절단 금지)
const ngramReport: string[] = [];
for (const [k, set] of seenBody) {
  const bodies = [...set].filter(Boolean);
  if (bodies.length < 2) continue;
  const sampled = bodies.length > NGRAM_CAP;
  const sh = (sampled ? bodies.slice(0, NGRAM_CAP) : bodies).map(shingles);
  let mx = 0;
  for (let i = 0; i < sh.length; i++) for (let j = i + 1; j < sh.length; j++) { const o = jac(sh[i], sh[j]); if (o > mx) mx = o; }
  ngramReport.push(`${k}:${mx.toFixed(2)}${sampled ? `(표본${NGRAM_CAP}/${bodies.length})` : ''}`);
  if (mx > OVERLAP_MAX) V.push(`${k} 본문 n-gram 겹침 ${mx.toFixed(2)}>${OVERLAP_MAX}(거의 동일 — 변주 실패)`);
}

// ── 교차검증: 뉴스 트리플크라운(선수당 1건 집계) == broadcast 트리플 달성 **선수 수**(경기당 현수막) ──
//   뉴스는 선수·시즌당 1건으로 묶고(기사 리뷰 하: 폭주 방지), 현수막은 경기마다 → 일치 기준은 **distinct 선수**.
const bcastTriplePlayers = new Set<string>();
for (const f of SEASON)
  for (const b of buildMatchBanners(f.homeTeamId, f.awayTeamId, f.dayIndex, null))
    if (b.kind === 'triple') bcastTriplePlayers.add(b.title.split(' 트리플 크라운')[0]);
const bcastTriples = bcastTriplePlayers.size;
const newsTriples = feed.filter((n) => n.kind === 'match' && n.headline.includes('트리플 크라운')).length;
const tripleAgree = newsTriples === bcastTriples;

// ── 모기업 기조 예고(Stage2b) 사실 정합: sponsor 뉴스 == sponsorStanceOf 도출(가짜 드라마 0) ──
//   최신 시즌만 예고 → 그 시즌 non-normal 팀 수 == sponsor 뉴스 수, 각 기사 톤이 실제 stance와 일치.
const lastArch = archive[archive.length - 1];
const expectAggr = (lastArch.standings ?? []).filter((t) => sponsorStanceOf(t, lastArch.season, archive) === 'aggressive');
const expectThr = (lastArch.standings ?? []).filter((t) => sponsorStanceOf(t, lastArch.season, archive) === 'thrifty');
const sponsorNews = feed.filter((n) => n.kind === 'sponsor');
const isAggrHead = (h: string) => h.includes('큰손') || h.includes('공격');
let sponsorMismatch = 0; // 기사 톤 ↔ 실제 stance 불일치(가짜 드라마/브랜치 스왑)
let sponsorOldSeason = 0; // 최신 시즌 외 sponsor 기사(예고는 최신만)
for (const n of sponsorNews) {
  if (n.season !== lastArch.season) { sponsorOldSeason++; continue; }
  const st = sponsorStanceOf(n.teamId!, lastArch.season, archive);
  const want = isAggrHead(n.headline) ? 'aggressive' : 'thrifty';
  if (st !== want) sponsorMismatch++;
}
const sponsorCountOk = sponsorNews.length === expectAggr.length + expectThr.length;
if (sponsorMismatch) V.push(`sponsor 톤 불일치 ${sponsorMismatch}`);
if (sponsorOldSeason) V.push(`sponsor 과거시즌 누출 ${sponsorOldSeason}`);
if (!sponsorCountOk) V.push(`sponsor 건수 불일치 ${sponsorNews.length}≠${expectAggr.length + expectThr.length}`);

// ── A/B 자가검증: 같은 시즌 archive 중복 주입 → 중복 검사가 잡아야 ──
const abFeed = buildNewsFeed([...archive, archive[archive.length - 1]], allMs, [], N, [], [], MAX, MY, transfers);
const abDup = dupOf(abFeed) > dup;

log(`\n═══ 리그 뉴스 · ${N}시즌 (총 ${feed.length}건) ═══`);
log(`kind 종류=${byKind.size}: ${[...byKind].map(([k, c]) => `${k}:${c}`).join(' · ')}`);
log(`\n변주 커버리지(kind: distinct본문/총건수 — 높을수록 다양):`);
for (const [k, set] of seenBody) log(`  ${k}: ${set.size}/${byKind.get(k) ?? 0}`);
log(`\nn-gram 최대겹침(kind별 distinct 본문 쌍, 낮을수록 다양 · 임계 ${OVERLAP_MAX}): ${ngramReport.join(' · ')}`);
log(`\n무결성: ${V.length ? '❌ ' + V.join(' · ') : '✅ 위반 0(빈 헤드/본문·중복·매달린 teamId)'}`);
log(`[교차검증] 트리플크라운 news=${newsTriples} ↔ broadcast=${bcastTriples} 일치=${tripleAgree} (true여야 신뢰)`);
log(`[A/B] 중복 주입 시 내용중복 검출=${abDup} (true여야 신뢰)`);
log(`[Stage2b] sponsor 예고 ${sponsorNews.length}건(aggr ${expectAggr.length}·thr ${expectThr.length}) · 톤일치 ${sponsorMismatch === 0} · 최신시즌만 ${sponsorOldSeason === 0}`);

log(`\n── 최근 30건 ──`);
for (const n of feed.slice(0, 30)) log(`${n.big ? '★' : '·'} [${n.season + 1}][${n.kind}] ${n.headline}`);

const ok = V.length === 0 && abDup && tripleAgree;
log(`\nNEWS OK = ${ok}`);
process.exit(ok ? 0 : 2);
