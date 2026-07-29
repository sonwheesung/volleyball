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
const ROOKIE_DEBUT_MAX_AGE = 23; // news.ts와 동일 — 첫시즌 베테랑 career-0 아티팩트 차단(사용자 보고 2026-07-29)

resetLeagueBase();
const MY = LEAGUE.teams[0].id;

// ── 독립 재계산: career-0 첫 선발(데뷔 후보) 전수 + talentBase 등급 분포 ──
const debuted = new Set<string>();
let flood = 0, gated = 0, elite = 0, talentOnly = 0; // talentOnly = 나이 상한 없는 구게이트(베테랑 누수 재현)
const leak: string[] = [];
for (const mp of seasonMatchProds(MAX)) {
  for (const [id] of mp.lines) {
    const p = getPlayer(id); if (!p) continue;
    if (!debuted.has(id) && mp.starters.has(id) && (p.career?.matches ?? 0) === 0) {
      debuted.add(id);
      flood++;                                  // 게이트 없으면 기사화될 후보(=폭주)
      const young = p.age <= ROOKIE_DEBUT_MAX_AGE; // 나이 상한(첫시즌 베테랑 아티팩트 차단)
      if (p.talentBase >= PROSPECT_MIN) talentOnly++;     // 구게이트(재능만) — 첫시즌엔 베테랑 다수 통과
      if (young && p.talentBase >= PROSPECT_MIN) gated++; // 신게이트(나이+재능)
      if (young && p.talentBase >= ELITE_MIN) elite++;    // S급(★)
    }
  }
}

// ── 실제 production: buildNewsFeed의 debut 기사 ──
const feed = buildNewsFeed([], [], [], 0, [], [], MAX, MY, []);
const debutArticles = feed.filter((n) => n.kind === 'debut');
const debutBig = debutArticles.filter((n) => n.big).length;
// 누수 검사: 실제 기사가 난 선수가 전부 talentBase≥1.12 **그리고 age≤23**인가(첫시즌 베테랑 아티팩트 0)
const ageLeak: string[] = [];
for (const n of debutArticles) {
  const p = n.ref ? getPlayer(n.ref) : undefined;
  if (!p || p.talentBase < PROSPECT_MIN) leak.push(`${n.headline}(talent=${p?.talentBase?.toFixed(2)})`);
  if (p && p.age > ROOKIE_DEBUT_MAX_AGE) ageLeak.push(`${n.headline}(age=${p.age})`);
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
const noAgeLeak = ageLeak.length === 0;
if (!noLeak) log(`  ❌ talent 누수: ${leak.slice(0, 5).join(' · ')}`);
if (!noAgeLeak) log(`  ❌ 나이 누수(24세+ 데뷔기사): ${ageLeak.slice(0, 8).join(' · ')}`);
log(`\n[A/B] 독립 재계산(나이+재능) ${gated} == 실제 기사 ${debutArticles.length}: ${matchCount}`);
log(`[A/B] ★ 독립 ${elite} == 실제 ★ ${debutBig}: ${matchBig}`);
log(`[게이트] 축소 ${reduces} · talent 누수 없음 ${noLeak} · 나이(≤${ROOKIE_DEBUT_MAX_AGE}) 누수 없음 ${noAgeLeak}`);
// A/B 민감도(허위 오라클 방지): 구게이트(재능만)는 첫시즌 베테랑을 다수 통과시켰다 → 나이 상한이 실제로 줄인다는 증명.
const ageBlocked = talentOnly - gated; // 나이 상한이 걷어낸 베테랑(career-0 첫시즌 아티팩트) 수
log(`[A/B 민감도] 구게이트(재능만) ${talentOnly}건 → 신게이트(+나이) ${gated}건 = 베테랑 ${ageBlocked}건 차단(>0이어야 게이트가 유효)`);
const ageGateBites = ageBlocked > 0; // 첫시즌 fresh 리그엔 베테랑 career-0가 있어 나이 게이트가 실제로 물어야 함

const ok = matchCount && matchBig && reduces && noLeak && noAgeLeak && ageGateBites;
log(`\nDEBUTGATE OK = ${ok}`);
process.exit(ok ? 0 : 2);
