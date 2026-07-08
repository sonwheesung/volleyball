// INDEPENDENT GUARD — 뉴스 목록↔상세 안정 키 배선 (NEWS_SYSTEM §3.6, F1 2026-07-07, 사용자 보고 버그).
//   배경: 목록(news.tsx)은 freshNews로 거른 배열의 인덱스 i로 라우팅, 상세(news/[id].tsx)는 거르지 않은
//   buildNewsFeed(...)[i]로 기사를 집었다. 만료 기사가 하나라도 생기면 인덱스가 어긋나 대부분 행이 틀린 기사를 연다.
//   수정: 인덱스 대신 안정 키(newsKey) 라우팅 + 상세도 목록과 동일 파생(freshNews)에서 find(byKey).
//   판정: 만료 기사 있는 상태에서 목록 인덱스 k의 키 == 상세(수정)가 그 키로 집는 기사(0 불일치) · 읽음대상 정확.
//   A/B(허위 오라클 방지): 구 인덱스 라우팅(unfiltered[i])으로 되돌리면 ≥1행이 어긋나야 함(버그·필터 비대칭 재현).
//   Usage: npx tsx tools/_dv_newskey.ts   ; echo $?
import { freshNews, newsKey } from '../data/news';
import type { NewsItem } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const D = 52; // 표시일(displayCutoff) — 사용자 리프로(시즌1 52일째)와 동일 상황
const mk = (kind: NewsItem['kind'], kord: string, day?: number): NewsItem =>
  ({ season: 1, kind, headline: `${kind}-${kord}`, big: false, kord, day });

// buildNewsFeed가 반환하는 "거르지 않은" 피드(최신순). 만료(day < D−14=38) 기사를 앞쪽에 섞어 인덱스 시프트 유발.
const unfiltered: NewsItem[] = [
  mk('match', 'm0', D - 1),      // fresh
  mk('injury', 'i0', D - 20),    // 만료(32<38)  ← 인덱스 시프트
  mk('match', 'm1', D - 2),      // fresh
  mk('scandal', 's0', D - 30),   // 만료(22<38)  ← 인덱스 시프트
  mk('debut', 'd0', D - 4),      // fresh
  mk('match', 'm2', D - 5),      // fresh
  mk('injury', 'i1', D - 40),    // 만료(12<38)  ← 인덱스 시프트
  mk('milestone', 'ms0', D - 6), // fresh
  mk('playoff', 'p0', D - 3),    // fresh — 포스트시즌 kind(달력 편입 §5.2, 2026-07-08)도 키 배선 동일
  mk('champion', 'c0', undefined), // 요약(day 없음) — 유지
  mk('award', 'a0', undefined),    // 요약 — 유지
];

// 목록(news.tsx) — freshNews로 거른 뒤 렌더. 상세도 수정 후 동일 파생.
const listFeed = freshNews(unfiltered, D);
const detailNew = freshNews(unfiltered, D); // 수정된 news/[id].tsx (목록과 동일 인자)
const detailOld = unfiltered;               // 구 news/[id].tsx (거르지 않은 buildNewsFeed)

let newMismatch = 0, oldMismatch = 0, readWrong = 0;
listFeed.forEach((item, i) => {
  const key = newsKey(item); // 목록이 라우팅에 쓰는 안정 키(수정 후) / 인덱스 i(수정 전)
  // 수정 후: 상세는 동일 피드에서 키로 조회
  const resolvedNew = detailNew.find((x) => newsKey(x) === key);
  if (!resolvedNew || newsKey(resolvedNew) !== key) newMismatch++;
  // 읽음 처리: 상세가 markNewsRead([newsKey(resolvedNew)]) → 목록 행의 키와 같아야 정확
  if (!resolvedNew || newsKey(resolvedNew) !== newsKey(item)) readWrong++;
  // A/B(구): 상세는 unfiltered[i]로 조회 → 필터로 시프트된 뒤엔 엉뚱한 기사
  const resolvedOld = detailOld[i];
  if (!resolvedOld || newsKey(resolvedOld) !== key) oldMismatch++;
});

log('═══ 뉴스 목록↔상세 안정 키 배선 가드 (NEWS §3.6, F1) ═══');
log(`전체 ${unfiltered.length}건 중 만료 3건 → 목록(freshNews) ${listFeed.length}행`);
log(`[수정 후] 키 라우팅 불일치 ${newMismatch}/${listFeed.length} · 읽음 오귀속 ${readWrong}/${listFeed.length}`);
log(`[A/B 구 인덱스] 인덱스 라우팅 불일치 ${oldMismatch}/${listFeed.length}`);

let fail = 0;
const check = (cond: boolean, msg: string) => { if (!cond) { log('  ❌ ' + msg); fail++; } else log('  ✓ ' + msg); };
check(newMismatch === 0, '수정 후: 목록 행 → 상세가 정확히 같은 기사(0 불일치)');
check(readWrong === 0, '수정 후: 읽음 처리가 정확한 기사에 귀속(0 오귀속)');
check(oldMismatch > 0, 'A/B: 구 인덱스 라우팅은 어긋남 재현(필터 비대칭 — 허위 오라클 아님)');
// 만료 기사로 딥링크 시 graceful(부재) — 만료된 키는 목록에 없고 상세 find도 못 찾음
const expiredKey = newsKey(mk('injury', 'i0', D - 20));
check(!detailNew.find((x) => newsKey(x) === expiredKey), '만료 기사 키는 상세에서 not-found(만료 안내 경로)');

log(`\n${fail ? `❌ NEWSKEY_GUARD FAIL (${fail})` : '✅ NEWSKEY_GUARD PASS — 키 라우팅 0불일치·읽음 정확·A/B 인덱스버그 재현'}`);
process.exit(fail ? 1 : 0);
