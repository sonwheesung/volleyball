// 개인 생산 집계 — 전 구단, 전 경기를 결정론 재계산(경기일 OVR, 관전 결과와 일치).
// 전 경기 1회 계산 후 baseVersion 캐시. uptoDay 로 시점 집계.
// SOLID: 엔진 순수 함수(simMatch·production·overall)를 합성.

import type { Fixture } from '../types';
import { simulateMatch } from '../engine/match';
import { attributeProduction, mergeProd, splitLineup, type ProdLine } from '../engine/production';
import { baseVersion, coachInfoOf, getEvolvedTeamPlayers, LEAGUE, SEASON } from './league';
import { availableTeamPlayers } from './injury';
import { currentTxVersion } from './dynamics';

interface ProdRow {
  dayIndex: number;
  homeTeamId: string;
  awayTeamId: string;
  homeIds: Set<string>; // 홈팀 출전 명단 id(팀 귀속용)
  lines: Map<string, ProdLine>;
  starters: Set<string>; // 그 경기 선발(코트 위 7×2) id — 데뷔=첫 선발 판정용(가비지/서브 출전 제외)
}

/** 경기 1건의 선수별 생산 + 선발 명단(뉴스 실시간 소재: 트리플크라운·데뷔·커리어하이) */
export interface MatchProd {
  dayIndex: number;
  homeTeamId: string;
  awayTeamId: string;
  homeIds: Set<string>;
  lines: Map<string, ProdLine>;
  starters: Set<string>;
}

let cache: { key: string; rows: ProdRow[] } | null = null;

/** 전 경기 선수별 생산(결정론). baseVersion + 거래버전 단위 캐시 — 시즌 중 방출/영입 즉시 반영 */
function allProdRows(): ProdRow[] {
  const key = `${baseVersion()}:${currentTxVersion()}`;
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
    for (const t of LEAGUE.teams) roster[t.id] = availableTeamPlayers(t.id, day); // 부상자 제외 명단(백업 출전)
    for (const f of byDay.get(day)!) {
      const sim = simulateMatch(f.seed, roster[f.homeTeamId], roster[f.awayTeamId], {
        home: coachInfoOf(f.homeTeamId), away: coachInfoOf(f.awayTeamId),
      });
      const lines = attributeProduction(sim, roster[f.homeTeamId], roster[f.awayTeamId], f.seed);
      const starters = new Set<string>([
        ...splitLineup(roster[f.homeTeamId]).starters.map((p) => p.id),
        ...splitLineup(roster[f.awayTeamId]).starters.map((p) => p.id),
      ]);
      const homeIds = new Set<string>(roster[f.homeTeamId].map((p) => p.id));
      rows.push({ dayIndex: f.dayIndex, homeTeamId: f.homeTeamId, awayTeamId: f.awayTeamId, homeIds, lines, starters });
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

/** uptoDay 까지 치러진 경기별 생산 + 선발 명단(경기일 오름차순). 뉴스 실시간 소재용. */
export function seasonMatchProds(uptoDay: number): MatchProd[] {
  return allProdRows()
    .filter((r) => r.dayIndex <= uptoDay)
    .map((r) => ({ dayIndex: r.dayIndex, homeTeamId: r.homeTeamId, awayTeamId: r.awayTeamId, homeIds: r.homeIds, lines: r.lines, starters: r.starters }));
}
