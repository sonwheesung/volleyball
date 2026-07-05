// 뉴스 2주 만료 검증 (NEWS_SYSTEM §9, 2026-07-05 최신순 전환). freshNews 필터 정확성 + A/B 민감도(허위 오라클 방지).
//   최신순 정렬(day↓·big↓)은 buildNewsFeed 내부 — simNews(결정론·내용 무회귀)가 커버. 여기선 표시 계층 만료(freshNews)를 검증.
//   npx tsx tools/_dv_newsorder.ts
import { freshNews, NEWS_FRESH_DAYS } from '../data/news';
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

console.log(fail ? `\n❌ FAIL ${fail}` : '\n✅ PASS — freshNews 2주 만료 정확·요약 유지·A/B 민감');
process.exit(fail ? 1 : 0);
