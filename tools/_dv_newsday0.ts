// INDEPENDENT GUARD — 첫 경기 전(관전 전) 뉴스 스포일러 차단 회귀 가드 (NEWS_SYSTEM §3.5).
//   배경: buildNewsFeed만 raw currentDay를 써서 첫 경기 전(0경기)에 미관전 경기 데뷔 + 미래 부상·사건을
//   노출(결과 화면 "치른 경기 없음"과 모순). 앱 전체 표준 leagueDisplayDay(currentDay)=currentDay-1로 통일.
//   판정: leagueDay=leagueDisplayDay(0)=-1 → 경기성·부상·사건 뉴스 0(LEAK=false).
//   A/B(허위 오라클 방지): 경계를 풀면(leagueDay=MAX) 데뷔·부상·사건이 다시 나와야 함(필터가 진짜 막는 증거).
//   Usage: npx tsx tools/_dv_newsday0.ts
import { resetLeagueBase, LEAGUE } from '../data/league';
import { seasonMatchProds } from '../data/production';
import { seasonResults, leagueDisplayDay } from '../data/standings';
import { seasonInjuryReport, seasonScandals } from '../data/dynamics';
import { buildNewsFeed } from '../data/news';

const log = (m: string) => process.stdout.write(m + '\n');
const MAX = Number.MAX_SAFE_INTEGER;

resetLeagueBase();
const MY = LEAGUE.teams[0].id;

const CUR = 0;                              // 신규 게임 currentDay 초깃값(store useGameStore.ts:166)
const LEAGUE_DAY = leagueDisplayDay(CUR);   // = -1 (첫 경기 전 = 0경기, 앱 전체 표준 컷오프)

const realtime = (n: { kind: string }) => n.kind === 'debut' || n.kind === 'injury' || n.kind === 'scandal' || n.kind === 'match' || n.kind === 'streak' || n.kind === 'standing';
const countRealtime = (feed: { kind: string }[]) => {
  const c: Record<string, number> = {};
  for (const n of feed) if (realtime(n)) c[n.kind] = (c[n.kind] ?? 0) + 1;
  return c;
};

// ── 수정 후: 앱이 실제로 넘기는 값(leagueDisplayDay(currentDay)) ──
const fixed = buildNewsFeed([], [], [], 0, [], [], LEAGUE_DAY, MY, []);
const fixedRT = countRealtime(fixed);
const fixedTotal = Object.values(fixedRT).reduce((a, b) => a + b, 0);

// ── A/B: 경계를 풀면(leagueDay=MAX) 미래 사건이 다시 노출돼야 = 필터가 진짜 막는 증거 ──
const unbounded = buildNewsFeed([], [], [], 0, [], [], MAX, MY, []);
const unbRT = countRealtime(unbounded);
const unbTotal = Object.values(unbRT).reduce((a, b) => a + b, 0);

// 정합 대조: 첫 경기 전 순위표/결과가 보는 경기 수
const standingsGames = seasonResults(LEAGUE_DAY).length;
const day0Fixtures = seasonMatchProds(MAX).filter((m) => m.dayIndex === 0).length;

log('═══ 첫 경기 전 뉴스 스포일러 차단 가드 (NEWS_SYSTEM §3.5) ═══');
log(`currentDay=${CUR} → leagueDisplayDay=${LEAGUE_DAY}  (순위표/결과가 보는 경기 ${standingsGames}건, 첫 경기일 dayIndex0 = ${day0Fixtures}건)`);
log(`\n[수정 후] leagueDay=${LEAGUE_DAY} 실시간 뉴스 ${fixedTotal}건  ${JSON.stringify(fixedRT)}`);
log(`[A/B 경계해제] leagueDay=MAX 실시간 뉴스 ${unbTotal}건  ${JSON.stringify(unbRT)}`);

// 부상·사건 원천(시즌 전체)은 존재하는데 첫 경기 전엔 안 보여야 한다
const injAll = seasonInjuryReport().filter((s) => s.severity === 'major' || s.severity === 'season').length;
const scAll = seasonScandals().length;
log(`(시즌 전체 원천: 중상+ 부상 ${injAll}건 · 사건 ${scAll}건 — 첫 경기 전엔 0이어야)`);

const noLeak = fixedTotal === 0;                 // 수정 후 첫 경기 전 실시간 뉴스 0
const abSensitive = unbTotal > 0;               // 경계 풀면 재현 → 필터가 허위 오라클 아님
const ok = noLeak && abSensitive;

log(`\n[판정] 첫 경기 전 실시간 뉴스 0(스포일러 없음) = ${noLeak}`);
log(`[A/B] 경계 해제 시 누수 재현(필터 민감) = ${abSensitive}`);
log(`\nNEWSDAY0_GUARD ${ok ? 'PASS' : 'FAIL'}`);
process.exit(ok ? 0 : 2);
