// INDEPENDENT GUARD — 결과 인지 표시 컷오프 (SEASON_SYSTEM §3.3, F2 2026-07-07).
//   배경: leagueDisplayDay(currentDay)=currentDay−1 단독 컷오프는 (a) 방금 관전·기록한 현재 경기일과
//   (b) 시즌 마지막 경기일을 놓쳐 순위/결과/대시보드가 PO/시상/아카이브와 모순됐다. displayCutoff(results-aware)로 승격.
//   판정: (a) 내 D일 경기 기록 직후 컷오프가 day D를 포함(구 컷오프는 제외) · (b) 내 전 일정 완료 시 컷오프=SEASON_DAYS →
//   순위/경기수 == 풀시즌(MAX)==PO 시드 · (c) 내 D일 경기 미기록이면 day D 이상 미노출(미래 누수 0).
//   A/B(허위 오라클 방지): 구 leagueDisplayDay 단독으로 되돌리면 (a)방금경기·(b)시즌말 최종일이 누락돼야 함.
//   Usage: npx tsx tools/_dv_displaycutoff.ts   ; echo $?
import { resetLeagueBase, reseedLeague, LEAGUE, SEASON } from '../data/league';
import { displayCutoff, seasonComplete, computeStandings, seasonResults } from '../data/standings';
import { SEASON_DAYS } from '../engine/calendar';
import type { MatchResult } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const MAX = Number.MAX_SAFE_INTEGER;
const oldCutoff = (currentDay: number) => currentDay - 1; // 구(결함) 컷오프 = leagueDisplayDay

let fail = 0;
const check = (cond: boolean, msg: string) => { if (!cond) { log('  ❌ ' + msg); fail++; } else log('  ✓ ' + msg); };

function runUniverse(label: string, setup: () => void) {
  setup();
  log(`\n─── 유니버스: ${label} ───`);
  const MY = LEAGUE.teams[0].id;
  const myFix = SEASON.filter((f) => f.homeTeamId === MY || f.awayTeamId === MY).sort((a, b) => a.dayIndex - b.dayIndex);
  const myDays = [...new Set(myFix.map((f) => f.dayIndex))];
  const midDay = myDays[Math.floor(myDays.length / 2)]; // 시즌말 아닌 중간 경기일
  const lastDay = myDays[myDays.length - 1];

  // results 맵 — displayCutoff는 fixtureId 키(playedThroughDay)와 존재여부(seasonComplete)만 본다(값은 무관, 순위는 결정론 재시뮬).
  const resultsThrough = (day: number): Record<string, MatchResult> => {
    const r: Record<string, MatchResult> = {};
    for (const f of myFix) if (f.dayIndex <= day) r[f.id] = { fixtureId: f.id, homeSets: 3, awaySets: 0 };
    return r;
  };

  // 풀시즌(MAX) 기준값 = 아카이브/PO가 쓰는 진실
  const fullStand = computeStandings(MAX);
  const fullTop3 = fullStand.slice(0, 3).map((s) => s.teamId);
  const fullMyGames = seasonResults(MAX).filter((r) => r.homeTeamId === MY || r.awayTeamId === MY).length;

  // ── (a) 방금 내 midDay 경기 기록 직후: currentDay=midDay(setDay가 미리 올림), 그 경기 results에 있음 ──
  const rMid = resultsThrough(midDay);
  const cutMid = displayCutoff(midDay, rMid, MY);
  const newHasMid = seasonResults(cutMid).some((r) => r.dayIndex === midDay);
  const oldHasMid = seasonResults(oldCutoff(midDay)).some((r) => r.dayIndex === midDay);
  check(newHasMid, `(a) 방금 기록한 ${midDay}일 경기가 컷오프에 포함(cut=${cutMid})`);
  check(!oldHasMid, `(a-A/B) 구 컷오프(=${oldCutoff(midDay)})는 ${midDay}일 경기 누락(결함 재현)`);
  check(!seasonComplete(rMid, MY), '(a) 중간 시점은 시즌 미완료(SEASON_DAYS 미승격)');

  // ── (c) 내 midDay 경기 아직 미기록: currentDay=midDay이나 results엔 직전 my경기까지만 → day midDay 이상 미노출 ──
  const prevDay = myDays[Math.floor(myDays.length / 2) - 1];
  const rBefore = resultsThrough(prevDay); // midDay 경기 제외
  const cutBefore = displayCutoff(midDay, rBefore, MY);
  const leak = seasonResults(cutBefore).some((r) => r.dayIndex >= midDay);
  check(!leak, `(c) 내 ${midDay}일 경기 미기록 → ${midDay}일 이상 미노출(미래 누수 0, cut=${cutBefore})`);

  // ── (b) 내 전 일정 완료(시즌 종료): 컷오프=SEASON_DAYS, 순위/경기수/PO시드 == 풀시즌 ──
  const rAll = resultsThrough(lastDay);
  check(seasonComplete(rAll, MY), '(b) 내 전 일정 기록 → seasonComplete=true');
  const cutEnd = displayCutoff(lastDay, rAll, MY);
  check(cutEnd === SEASON_DAYS, `(b) 컷오프=SEASON_DAYS(${SEASON_DAYS}) 승격 (cut=${cutEnd})`);
  const endTop3 = computeStandings(cutEnd).slice(0, 3).map((s) => s.teamId);
  const endMyGames = seasonResults(cutEnd).filter((r) => r.homeTeamId === MY || r.awayTeamId === MY).length;
  check(JSON.stringify(endTop3) === JSON.stringify(fullTop3), `(b) 시즌말 순위 top3 == 풀시즌 PO 시드 [${fullTop3.join(',')}]`);
  check(endMyGames === fullMyGames, `(b) 내 시즌 경기수 ${endMyGames} == 풀시즌 ${fullMyGames}(대시보드 성적 일치)`);
  // A/B: 구 컷오프(currentDay=lastDay−1)면 lastDay..SEASON_DAYS 리그 최종일들이 누락
  const oldEndGames = seasonResults(oldCutoff(lastDay)).length;
  const fullGames = seasonResults(MAX).length;
  check(oldEndGames < fullGames, `(b-A/B) 구 컷오프는 리그 최종일 누락 (구 ${oldEndGames} < 전체 ${fullGames})`);
}

runUniverse('default(resetLeagueBase)', () => resetLeagueBase());
runUniverse('adversarial(1003,2003)', () => reseedLeague(1003, 2003));
runUniverse('adversarial(1019,2019)', () => reseedLeague(1019, 2019));

log(`\n${fail ? `❌ DISPLAYCUTOFF_GUARD FAIL (${fail})` : '✅ DISPLAYCUTOFF_GUARD PASS — 방금경기 포함·시즌말 전체공개(==PO/아카이브)·미래 누수 0·A/B 민감'}`);
process.exit(fail ? 1 : 0);
