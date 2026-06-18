// 리그 순위표 + 전 구단 경기 결과 — 전 경기를 결정론 시뮬해 산출.
// 경기일(dayIndex) 기준 OVR로 계산 → 사용자가 관전한 결과와 일치.
// 성능: 전 경기 1회 계산 후 baseVersion 으로 캐시.

import type { Fixture, MatchResult } from '../types';
import { baseVersion, coachInfoOf, getEvolvedTeamPlayers, getFixture, LEAGUE, SEASON } from './league';
import { availableTeamPlayers } from './injury';
import { currentTxVersion } from './dynamics';
import { simulateMatch } from '../engine/match';

export interface ResultRow {
  fixtureId: string;
  round: number;
  dayIndex: number;
  homeTeamId: string;
  awayTeamId: string;
  homeSets: number;
  awaySets: number;
}

export interface Standing {
  teamId: string;
  played: number;
  wins: number;
  losses: number;
  setDiff: number;
}

let cache: { key: string; rows: ResultRow[] } | null = null;

/** 전 경기 결과(결정론). baseVersion + 거래버전 단위 캐시 — 시즌 중 방출/영입 즉시 반영 */
function allResults(): ResultRow[] {
  const key = `${baseVersion()}:${currentTxVersion()}`;
  if (cache && cache.key === key) return cache.rows;

  // 경기일별로 묶어 그 날 OVR 한 번만 계산
  const byDay = new Map<number, Fixture[]>();
  for (const f of SEASON) {
    const arr = byDay.get(f.dayIndex) ?? [];
    arr.push(f);
    byDay.set(f.dayIndex, arr);
  }

  const rows: ResultRow[] = [];
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    const squad: Record<string, ReturnType<typeof getEvolvedTeamPlayers>> = {};
    for (const t of LEAGUE.teams) squad[t.id] = availableTeamPlayers(t.id, day); // 부상자 제외 명단
    for (const f of byDay.get(day)!) {
      const sim = simulateMatch(f.seed, squad[f.homeTeamId], squad[f.awayTeamId], {
        home: coachInfoOf(f.homeTeamId), away: coachInfoOf(f.awayTeamId),
      });
      rows.push({
        fixtureId: f.id,
        round: f.round,
        dayIndex: f.dayIndex,
        homeTeamId: f.homeTeamId,
        awayTeamId: f.awayTeamId,
        homeSets: sim.homeSets,
        awaySets: sim.awaySets,
      });
    }
  }
  rows.sort((a, b) => a.dayIndex - b.dayIndex);
  cache = { key, rows };
  return rows;
}

/** uptoDay 까지 치른 경기 결과(최근순 정렬은 호출측에서) */
export function seasonResults(uptoDay: number): ResultRow[] {
  return allResults().filter((r) => r.dayIndex <= uptoDay);
}

/**
 * "실제로 치른 마지막 경기일" — 사용자가 기록(results)으로 완료한 경기 중 최대 dayIndex.
 * currentDay 는 다음 경기로 진행(setDay)하는 순간 미리 올라가므로, 아직 관전·기록하지 않은
 * 경기까지 순위표에 반영돼 대시보드 성적(results 기반)과 어긋났다(사용자 보고). 순위/결과 화면은
 * currentDay 대신 이 값을 쓰면 "치르지 않은 경기는 반영 안 됨"이 보장된다(대시보드와 일치).
 * 기록이 없으면 -1(시즌 전 — 0경기).
 */
export function playedThroughDay(results: Record<string, MatchResult>): number {
  let max = -1;
  for (const id of Object.keys(results)) {
    const f = getFixture(id);
    if (f && f.dayIndex > max) max = f.dayIndex;
  }
  return max;
}

/** 팀별 그 시즌 최장 연승·연패 — 각 팀의 경기를 날짜순으로 보고 W/L 런 최댓값(연승/연패 업적용) */
export function seasonStreaks(uptoDay: number): Record<string, [number, number]> {
  const rows = seasonResults(uptoDay).slice().sort((a, b) => a.dayIndex - b.dayIndex);
  const out: Record<string, [number, number]> = {};
  const acc: Record<string, { w: number; l: number; mw: number; ml: number }> = {};
  for (const r of rows) {
    const homeWon = r.homeSets > r.awaySets;
    for (const [team, won] of [[r.homeTeamId, homeWon], [r.awayTeamId, !homeWon]] as [string, boolean][]) {
      const a = (acc[team] ??= { w: 0, l: 0, mw: 0, ml: 0 });
      if (won) { a.w += 1; a.l = 0; if (a.w > a.mw) a.mw = a.w; }
      else { a.l += 1; a.w = 0; if (a.l > a.ml) a.ml = a.l; }
    }
  }
  for (const t of Object.keys(acc)) out[t] = [acc[t].mw, acc[t].ml];
  return out;
}

/** uptoDay 시점 순위표 */
export function computeStandings(uptoDay: number): Standing[] {
  const table: Record<string, Standing> = {};
  for (const t of LEAGUE.teams) table[t.id] = { teamId: t.id, played: 0, wins: 0, losses: 0, setDiff: 0 };
  for (const r of seasonResults(uptoDay)) {
    const h = table[r.homeTeamId];
    const a = table[r.awayTeamId];
    const sd = r.homeSets - r.awaySets;
    h.played++; a.played++;
    h.setDiff += sd; a.setDiff -= sd;
    if (r.homeSets > r.awaySets) { h.wins++; a.losses++; }
    else { a.wins++; h.losses++; }
  }
  return Object.values(table).sort((x, y) => y.wins - x.wins || y.setDiff - x.setDiff);
}

/** 드래프트 순번용 — 시즌 전체 기준 하위 팀부터 */
export function standingsWorstFirst(): string[] {
  return computeStandings(Number.MAX_SAFE_INTEGER).slice().reverse().map((s) => s.teamId);
}
