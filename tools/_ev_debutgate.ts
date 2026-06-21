// INDEPENDENT — 데뷔 기사 유망주 게이트 측정(사용자 보고 2026-06-21: 첫 경기 ~50건 폭주).
//   fresh resetLeagueBase = 전원 career.matches 0 → 시즌 시작 "모든 선발이 데뷔" = 폭주 상황 재현.
//   A/B: 독립 재계산(career-0 첫선발 × talentBase 등급) == buildNewsFeed의 실제 debut 기사 수.
//   게이트가 (a)폭주를 줄이고 (b)talentBase≥1.12만 통과시키며 (c)≥1.25만 ★인지 확인.
//   Usage: npx tsx tools/_ev_debutgate.ts
import { resetLeagueBase, getPlayer, LEAGUE } from '../data/league';
import { seasonMatchProds } from '../data/production';
import { buildNewsFeed } from '../data/news';

const log = (m: string) => process.stdout.write(m + '\n');
const MAX = Number.MAX_SAFE_INTEGER;
const PROSPECT_MIN = 1.12, ELITE_MIN = 1.25; // news.ts와 동일(A급↑ 기사, S급 ★)

resetLeagueBase();
const MY = LEAGUE.teams[0].id;

// ── 독립 재계산: career-0 첫 선발(데뷔 후보) 전수 + talentBase 등급 분포 ──
const debuted = new Set<string>();
let flood = 0, gated = 0, elite = 0;
const leak: string[] = [];
for (const mp of seasonMatchProds(MAX)) {
  for (const [id] of mp.lines) {
    const p = getPlayer(id); if (!p) continue;
    if (!debuted.has(id) && mp.starters.has(id) && (p.career?.matches ?? 0) === 0) {
      debuted.add(id);
      flood++;                                  // 게이트 없으면 기사화될 후보(=폭주)
      if (p.talentBase >= PROSPECT_MIN) gated++; // 유망주 게이트 통과
      if (p.talentBase >= ELITE_MIN) elite++;    // S급(★)
    }
  }
}

// ── 실제 production: buildNewsFeed의 debut 기사 ──
const feed = buildNewsFeed([], [], [], 0, [], [], MAX, MY, []);
const debutArticles = feed.filter((n) => n.kind === 'debut');
const debutBig = debutArticles.filter((n) => n.big).length;
// 누수 검사: 실제 기사가 난 선수가 전부 talentBase≥1.12인가
for (const n of debutArticles) {
  const p = n.ref ? getPlayer(n.ref) : undefined;
  if (!p || p.talentBase < PROSPECT_MIN) leak.push(`${n.headline}(talent=${p?.talentBase?.toFixed(2)})`);
}

log('═══ 데뷔 기사 유망주 게이트 측정 (fresh = 전원 career-0) ═══');
log(`데뷔 후보(career-0 첫선발) 총 ${flood}건 ← 게이트 없으면 이만큼 폭주`);
log(`  유망주 게이트(talentBase≥${PROSPECT_MIN}) 통과: ${gated}건  /  S급(≥${ELITE_MIN}, ★): ${elite}건`);
log(`  → 폭주 ${flood} → ${gated}건으로 축소 (${flood ? Math.round((1 - gated / flood) * 100) : 0}% 감소)`);
log(`\n[실제 buildNewsFeed] debut 기사 ${debutArticles.length}건(★ ${debutBig}건)`);

const matchCount = debutArticles.length === gated;
const matchBig = debutBig === elite;
const reduces = gated < flood && flood > 0;
const noLeak = leak.length === 0;
if (!noLeak) log(`  ❌ 누수: ${leak.slice(0, 5).join(' · ')}`);
log(`\n[A/B] 독립 재계산 ${gated} == 실제 기사 ${debutArticles.length}: ${matchCount}`);
log(`[A/B] ★ 독립 ${elite} == 실제 ★ ${debutBig}: ${matchBig}`);
log(`[게이트] 축소 ${reduces} · talent 누수 없음 ${noLeak}`);

const ok = matchCount && matchBig && reduces && noLeak;
log(`\nDEBUTGATE OK = ${ok}`);
process.exit(ok ? 0 : 2);
