// INDEPENDENT GUARD — 프리시즌 예상순위 기사 부제/리드 전용 풀 회귀 가드 (NEWS_SYSTEM §3.7·§10b, 2026-07-21).
//   배경: 개막 프리뷰 "언론 예상 순위"는 kind=standing을 재사용한다. 상세 화면 부제(SUBTITLE_BY_KIND[kind])가
//   standing 결산 풀에서 뽑혀 "다음 시즌의 출발선이 여기서 정해졌다"(시즌 결산 톤)가 프리시즌 기사에 출력됐다.
//   수정: newsSubtitle이 isPreseasonRankNews(ref='preseason:시즌')로 전용 전망 풀(PRESEASON_SUBTITLES)로 분기.
//   판정: 프리시즌 기사 부제 ∈ 전용 풀 · ∉ standing 결산 풀 · 두 풀 disjoint · 식별자 정확 · 결정론.
//   A/B(허위 오라클 방지): preseason 마커(ref)를 지우면 부제가 standing 결산 풀에서 뽑혀야(구버그 재현).
//   Usage: npx tsx tools/_dv_preseasonnews.ts
import { resetLeagueBase, LEAGUE } from '../data/league';
import { buildNewsFeed, isPreseasonRankNews, newsSubtitle, newsKey, SUBTITLE_BY_KIND, PRESEASON_SUBTITLES } from '../data/news';
import type { NewsItem } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const MAX = Number.MAX_SAFE_INTEGER;

resetLeagueBase();
const teams = LEAGUE.teams.map((t) => t.id);
const MY = teams[0];

let ok = true;
const check = (cond: boolean, msg: string) => { if (!cond) ok = false; log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); };

log('═══ 프리시즌 예상순위 기사 부제/리드 전용 풀 가드 (NEWS §3.7·§10b) ═══');

// ── 실제 피드에서 프리시즌 예상순위 기사 파생(mediaPredictionLog 주입 = 슬라이스 10b) ──
const buildFeed = () => buildNewsFeed([], [], [], 0, [], [], MAX, MY, [], [], [], [], MAX, [{ season: 0, order: teams }]);
const feed = buildFeed();
const pre = feed.find((n) => isPreseasonRankNews(n));

if (!pre) {
  log('FAIL 프리시즌 예상순위 기사 미생성(mediaPredictionLog 주입에도) — 이후 검사 불가');
  log('\nPRESEASONNEWS_GUARD FAIL');
  process.exit(2);
}

const nk = newsKey(pre);
log(`프리시즌 기사: kind=${pre.kind} ref=${pre.ref} key=${nk}`);
log(`  헤드라인: ${pre.headline}`);

// (1) 식별자 정확성 — 프리시즌 기사만 true, 시즌 결산 순위 기사는 false
check(pre.kind === 'standing' && (pre.ref ?? '').startsWith('preseason:'), '프리시즌 기사는 kind=standing·ref=preseason: (설계대로 재사용)');
const finalStanding: NewsItem = { season: 0, kind: 'standing', headline: 'x', big: false, ref: '0:rank2', kord: '1' };
const noRef: NewsItem = { season: 0, kind: 'standing', headline: 'x', big: false };
check(isPreseasonRankNews(pre) === true, 'isPreseasonRankNews(프리시즌) === true');
check(isPreseasonRankNews(finalStanding) === false, 'isPreseasonRankNews(시즌 결산 순위) === false');
check(isPreseasonRankNews(noRef) === false, 'isPreseasonRankNews(ref 없는 standing) === false');

// (2) 부제 — 전용 전망 풀에서만, standing 결산 풀 문구 절대 미출력
const sub = newsSubtitle(pre, nk);
log(`  선택된 부제: "${sub}"`);
check(PRESEASON_SUBTITLES.includes(sub), '부제 ∈ 프리시즌 전용 풀(전망 톤)');
check(!SUBTITLE_BY_KIND.standing.includes(sub), '부제 ∉ standing 결산 풀(결산 톤 유출 0)');

// (3) 두 풀 disjoint(구조적 보장) — 전망 풀과 결산 풀이 한 문구도 겹치지 않음
const overlap = PRESEASON_SUBTITLES.filter((s) => SUBTITLE_BY_KIND.standing.includes(s));
check(overlap.length === 0, `프리시즌 풀 ∩ standing 풀 = ∅ (겹침 ${overlap.length}건)`);

// (4) 결정론 — 재생성해도 같은 부제
const pre2 = buildFeed().find((n) => isPreseasonRankNews(n))!;
check(newsSubtitle(pre2, newsKey(pre2)) === sub, `결정론(재생성 부제 동일: "${sub}")`);

// ── A/B 민감도: preseason 마커(ref)를 지우면 = 구버그(standing 재사용 미분기) → 부제가 결산 풀에서 뽑혀야 ──
log('\n--- A/B 민감도(구버그 재현 → 결산 톤 유출 검출) ---');
const buggy = { ...pre, ref: '0:rank2' } as NewsItem; // preseason 식별 실패(구버그) → standing 경로
const buggySub = newsSubtitle(buggy, nk);             // 같은 nk로 비교(해시 고정) → 풀만 달라짐
log(`  구버그 경로 부제: "${buggySub}"`);
const abReproduced = SUBTITLE_BY_KIND.standing.includes(buggySub) && buggySub !== sub;
check(abReproduced, `구버그(마커 제거) 시 결산 풀 문구 유출 재현("${buggySub}" ∈ standing 풀, 수정판과 상이)`);

log(`\nPRESEASONNEWS_GUARD ${ok ? 'PASS' : 'FAIL'}`);
process.exit(ok ? 0 : 2);
