// 리그 순위표 + 전 구단 경기 결과 — 전 경기를 결정론 시뮬해 산출.
// 경기일(dayIndex) 기준 OVR로 계산 → 사용자가 관전한 결과와 일치.
// 성능: 전 경기 1회 계산 후 baseVersion 으로 캐시.

import type { Fixture } from '../types';
import { baseVersion, coachInfoOf, getEvolvedTeamPlayers, LEAGUE, SEASON } from './league';
import { availableTeamPlayers } from './injury';
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

let cache: { key: number; rows: ResultRow[] } | null = null;

/** 전 경기 결과(결정론). baseVersion 단위 캐시 */
function allResults(): ResultRow[] {
  const key = baseVersion();
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
