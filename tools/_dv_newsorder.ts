// 뉴스 2주 만료 + 정렬 검증 (NEWS_SYSTEM §9, 2026-07-05 최신순 전환). freshNews 필터 정확성 + A/B 민감도(허위 오라클 방지).
//   최신순 정렬(day↓·big↓)은 buildNewsFeed 내부 — simNews(결정론·내용 무회귀)가 커버.
//   여기선 (1) 표시 계층 만료(freshNews) + (2) 프리시즌 예상순위(day=−1)가 개막일(day=0) 경기·데뷔 뉴스보다 **아래**인지(§3.7·§10b 정렬 규칙, 사용자 보고 2026-07-29).
//   npx tsx tools/_dv_newsorder.ts
import { resetLeagueBase, LEAGUE } from '../data/league';
import { buildNewsFeed, freshNews, isPreseasonRankNews, NEWS_FRESH_DAYS } from '../data/news';
import type { NewsItem } from '../types';

const mk = (id: string, day?: number, big = false): NewsItem => ({ season: 0, kind: 'match', headline: id, big, day, kord: id });

const D = 30; // 표시일(leagueDisplayDay)
const feed: NewsItem[] = [
  mk('summary', undefined, true),            // 요약(day 없음) — 항상 유지(영속 기록)
  mk('fresh', D - 3),                         // 3일 전 — 유지
  mk('edge', D - NEWS_FRESH_DAYS),            // 정확히 14일 전 — 경계 포함 유지
  mk('old', D - NEWS_FRESH_DAYS - 1),         // 15일 전 — 만료
  mk('older', D - 40),                        // 40일 전 — 만료
];

let fail = 0;
const check = (cond: boolean, msg: string) => { if (!cond) { console.log('  ❌ ' + msg); fail++; } else console.log('  ✓ ' + msg); };

const kept = new Set(freshNews(feed, D).map((n) => n.headline));
check(kept.has('summary'), '요약뉴스(day 없음) 유지');
check(kept.has('fresh'), '3일 전 인게임 유지');
check(kept.has('edge'), '정확히 14일 전(경계) 유지');
check(!kept.has('old'), '15일 전 인게임 만료');
check(!kept.has('older'), '40일 전 인게임 만료');
check(NEWS_FRESH_DAYS === 14, '만료 기준 14일');

// A/B(허위 오라클 방지): 표시일을 크게 밀면 인게임 전부 만료, 요약(day 없음)만 남아야 = 필터가 진짜 day로 거른다
const ab = freshNews(feed, 10000).map((n) => n.headline);
check(ab.length === 1 && ab[0] === 'summary', 'A/B: 표시일 급증 시 인게임 전부 만료(요약만 잔존)');

// ── (2) 정렬 규칙: 프리시즌 예상순위는 개막일(day≥0) 경기·데뷔 뉴스보다 아래(§3.7·§10b, 2026-07-29) ──
console.log('── 프리시즌 예상순위 정렬(day=−1 → 경기·데뷔 아래) ──');
resetLeagueBase();
const teams = LEAGUE.teams.map((t) => t.id);
const MY = teams[0];
// leagueDay=0(개막일): day=0 데뷔 뉴스 존재 + 프리시즌 예상순위(mediaPredictionLog 주입)
const realFeed = buildNewsFeed([], [], [], 0, [], [], 0, MY, [], [], [], [], 0, [{ season: 0, order: teams }]);
const preIdx = realFeed.findIndex(isPreseasonRankNews);
const inGameIdx = realFeed.map((n, i) => ({ n, i })).filter((x) => x.n.day != null && x.n.day >= 0 && !isPreseasonRankNews(x.n));
check(preIdx >= 0, '프리시즌 예상순위 기사 생성됨');
check(inGameIdx.length > 0, `개막일(day≥0) 경기·데뷔 뉴스 존재(${inGameIdx.length}건) — 비교 대상 비어있지 않음`);
const preBelowAll = inGameIdx.every((x) => x.i < preIdx); // 모든 인게임 뉴스가 프리시즌보다 앞(위)
check(preBelowAll, `프리시즌 예상순위(idx ${preIdx})가 개막일 모든 경기·데뷔 뉴스 아래(최대 인게임 idx ${Math.max(...inGameIdx.map((x) => x.i))})`);
const pre = realFeed[preIdx];
check(pre.day === -1, `프리시즌 예상순위 day = −1(개막 전 소식, 실제 ${pre.day})`);

// A/B 민감도(구버그 재현 — day=0·big float): 같은 아이템셋에 프리시즌 day를 0으로 되돌려 실제 정렬 comparator를 다시 태우면
//   big=true라 day=0 동률에서 비-big 데뷔 뉴스 위로 떠올라야(구 증상). comparator를 news.ts와 동일하게 미러(정렬 규칙 falsifiable 증명).
const cmp = (x: NewsItem, y: NewsItem) => {
  const xd = x.day, yd = y.day;
  if (xd != null && yd != null) return (yd - xd) || (Number(y.big) - Number(x.big));
  if (xd != null) return -1;
  if (yd != null) return 1;
  return (y.season - x.season) || (Number(y.big) - Number(x.big));
};
const buggy = realFeed.map((n) => (isPreseasonRankNews(n) ? { ...n, day: 0 } : n)).sort(cmp);
const bPreIdx = buggy.findIndex(isPreseasonRankNews);
const bInGame = buggy.map((n, i) => ({ n, i })).filter((x) => x.n.day != null && x.n.day >= 0 && !isPreseasonRankNews(x.n));
const bFloatsAbove = bInGame.some((x) => x.i > bPreIdx); // 구버그: 프리시즌이 일부 데뷔 뉴스 위로 떠오름
check(bFloatsAbove, `A/B: day=0 되돌리면 프리시즌(idx ${bPreIdx})이 일부 개막일 뉴스 위로 부상(구버그 재현 → 정렬 검사 민감)`);

console.log(fail ? `\n❌ FAIL ${fail}` : '\n✅ PASS — freshNews 2주 만료 정확·요약 유지·프리시즌 정렬(day=−1) 아래·A/B 민감');
process.exit(fail ? 1 : 0);
