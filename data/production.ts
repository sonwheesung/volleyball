// 개인 생산 집계 — 전 구단, 전 경기를 결정론 재계산(경기일 OVR, 관전 결과와 일치).
// 전 경기 1회 계산 후 baseVersion 캐시. uptoDay 로 시점 집계.
// SOLID: 엔진 순수 함수(simMatch·production·overall)를 합성.

import type { Fixture } from '../types';
import { simulateMatch } from '../engine/match';
import { attributeProduction, mergeProd, type ProdLine } from '../engine/production';
import { baseVersion, coachInfoOf, getEvolvedTeamPlayers, LEAGUE, SEASON } from './league';

interface ProdRow {
  dayIndex: number;
  lines: Map<string, ProdLine>;
}

let cache: { key: number; rows: ProdRow[] } | null = null;

/** 전 경기 선수별 생산(결정론). baseVersion 단위 캐시 */
function allProdRows(): ProdRow[] {
  const key = baseVersion();
  if (cache && cache.key === key) return cache.rows;

  const byDay = new Map<number, Fixture[]>();
  for (const f of SEASON) {
    const arr = byDay.get(f.dayIndex) ?? [];
    arr.push(f);
    byDay.set(f.dayIndex, arr);
  }

  const rows: ProdRow[] = [];
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    const roster: Record<string, ReturnType<typeof getEvolvedTeamPlayers>> = {};
    for (const t of LEAGUE.teams) roster[t.id] = getEvolvedTeamPlayers(t.id, day);
    for (const f of byDay.get(day)!) {
      const sim = simulateMatch(f.seed, roster[f.homeTeamId], roster[f.awayTeamId], {
        home: coachInfoOf(f.homeTeamId), away: coachInfoOf(f.awayTeamId),
      });
      const lines = attributeProduction(sim, roster[f.homeTeamId], roster[f.awayTeamId], f.seed);
      rows.push({ dayIndex: f.dayIndex, lines });
    }
  }
  cache = { key, rows };
  return rows;
}

/** uptoDay 까지 선수별 누적 생산 */
export function leagueProduction(uptoDay: number): Map<string, ProdLine> {
  return leagueProductionRange(0, uptoDay);
}

/** [fromDay, toDay] 구간 선수별 생산(양끝 포함) — 라운드 MVP 등 구간 집계용 */
export function leagueProductionRange(fromDay: number, toDay: number): Map<string, ProdLine> {
  const out = new Map<string, ProdLine>();
  for (const r of allProdRows()) {
    if (r.dayIndex < fromDay || r.dayIndex > toDay) continue;
    for (const [id, l] of r.lines) out.set(id, mergeProd(out.get(id), l));
  }
  return out;
}

export const getPlayerProduction = (id: string, uptoDay: number): ProdLine | undefined =>
  leagueProduction(uptoDay).get(id);
