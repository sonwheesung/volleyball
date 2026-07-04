// 업적용 통산 경기 기록 — 저장값(과거 시즌말 누적) + **이번 시즌 진행분(실시간)**.
// 왜: careerTotals(store)는 endSeason에서만 누적된다 → 시즌 중엔 0이라 통산 업적(첫 득점·첫 승·백점…)이
//     시즌 끝까지 안 뜬다(사용자 보고 2026-07-04, 진단 스냅샷 12e03390: 4경기 진행·careerTotals 전부 0).
// 이번 시즌 진행분을 endSeason 누적 공식과 **동일**하게(같은 leagueProduction/seasonResults/computeStandings, cutoff만
// 현재 진행까지) 계산해 더한다 → 시즌말 값과 이음매 없음(경계에서 stored += 시즌분, 새 시즌 진행분 0 → 이중계산 없음).
import type { CareerTotals } from '../engine/achievements';
import type { MatchResult } from '../types';
import { leagueProduction } from './production';
import { seasonResults, computeStandings, playedThroughDay } from './standings';
import { currentRosters } from './league';

const ZERO: CareerTotals = { points: 0, aces: 0, setsWon: 0, setsLost: 0, matchWins: 0, matchLosses: 0 };

/** 이번 시즌 내 팀 진행분(치른 경기까지). endSeason(store) 누적 로직과 동일 — cutoff=playedThroughDay. */
export function seasonToDateTotals(myTeamId: string, results: Record<string, MatchResult>): CareerTotals {
  const cutoff = playedThroughDay(results);
  if (cutoff < 0) return ZERO; // 0경기
  const prod = leagueProduction(cutoff);
  let points = 0, aces = 0;
  for (const id of currentRosters()[myTeamId] ?? []) { const pr = prod.get(id); if (pr) { points += pr.points; aces += pr.aces; } }
  let setsWon = 0, setsLost = 0;
  for (const r of seasonResults(cutoff)) {
    if (r.homeTeamId === myTeamId) { setsWon += r.homeSets; setsLost += r.awaySets; }
    else if (r.awayTeamId === myTeamId) { setsWon += r.awaySets; setsLost += r.homeSets; }
  }
  const row = computeStandings(cutoff).find((s) => s.teamId === myTeamId);
  return { points, aces, setsWon, setsLost, matchWins: row?.wins ?? 0, matchLosses: row?.losses ?? 0 };
}

/** 업적 평가용 통산 = 저장(과거 시즌말 누적) + 이번 시즌 진행분(실시간). */
export function achTotals(myTeamId: string, stored: CareerTotals | undefined, results: Record<string, MatchResult>): CareerTotals {
  const a = stored ?? ZERO;
  const b = seasonToDateTotals(myTeamId, results);
  return {
    points: a.points + b.points, aces: a.aces + b.aces,
    setsWon: a.setsWon + b.setsWon, setsLost: a.setsLost + b.setsLost,
    matchWins: a.matchWins + b.matchWins, matchLosses: a.matchLosses + b.matchLosses,
  };
}
