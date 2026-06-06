// 시즌 개인 생산 집계 (조합 계층). 치른 경기(results)를 결정론 재계산해 합산.
// 저장 없이 재계산(진화 셀렉터와 같은 철학) + 경기별 1회만 처리하는 증분 캐시.
// SOLID: 엔진 순수 함수들(simMatch·production·overall)을 합성하기만 한다.

import type { MatchResult } from '../types';
import { simulateMatchSimple } from '../engine/simMatch';
import { attributeProduction, mergeProd, type ProdLine } from '../engine/production';
import { teamOverall } from '../engine/overall';
import { getEvolvedTeamPlayers, getFixture } from './league';

let cache: { ids: Set<string>; map: Map<string, ProdLine> } | null = null;

export function seasonProduction(results: Record<string, MatchResult>): Map<string, ProdLine> {
  const fixtureIds = Object.keys(results);
  // 세이브 초기화 등으로 결과가 줄면 캐시 리셋
  if (cache && fixtureIds.length < cache.ids.size) cache = null;
  if (!cache) cache = { ids: new Set(), map: new Map() };

  for (const fid of fixtureIds) {
    if (cache.ids.has(fid)) continue;
    const f = getFixture(fid);
    cache.ids.add(fid);
    if (!f) continue;

    const home = getEvolvedTeamPlayers(f.homeTeamId, f.dayIndex);
    const away = getEvolvedTeamPlayers(f.awayTeamId, f.dayIndex);
    const sim = simulateMatchSimple(f.seed, teamOverall(home), teamOverall(away));
    const line = attributeProduction(sim, home, away, f.seed);
    for (const [id, l] of line) cache.map.set(id, mergeProd(cache.map.get(id), l));
  }
  return cache.map;
}

export const getPlayerProduction = (
  id: string,
  results: Record<string, MatchResult>,
): ProdLine | undefined => seasonProduction(results).get(id);
