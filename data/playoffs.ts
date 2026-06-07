// 포스트시즌 대진 — 정규리그 상위 3팀. 결정론(시즌 시드 + 종료 시점 OVR).

import { coachInfoOf, getEvolvedTeamPlayers } from './league';
import { computeStandings } from './standings';
import { playSeries, type Series } from '../engine/playoffs';

const REF_DAY = 164; // 시즌 종료 전력
const PO_TARGET = 2; // 3전 2선승
const FINAL_TARGET = 3; // 5전 3선승

export interface Matchup {
  hiId: string;
  loId: string;
  series: Series;
  winnerId: string;
}

export interface Playoffs {
  seeds: string[];          // [1위, 2위, 3위]
  po: Matchup | null;       // 2위 vs 3위
  final: Matchup | null;    // 1위 vs PO 승자
  championId: string | null;
}

export function buildPlayoffs(season: number): Playoffs {
  const standings = computeStandings(Number.MAX_SAFE_INTEGER);
  const seeds = standings.slice(0, 3).map((s) => s.teamId);
  if (seeds.length < 3) {
    return { seeds, po: null, final: null, championId: seeds[0] ?? null };
  }
  const [s1, s2, s3] = seeds;
  const sq: Record<string, ReturnType<typeof getEvolvedTeamPlayers>> = {};
  for (const id of seeds) sq[id] = getEvolvedTeamPlayers(id, REF_DAY);

  // 플레이오프: 2위(hi) vs 3위(lo)
  const poSeries = playSeries(90000 + season * 17, sq[s2], sq[s3], PO_TARGET, coachInfoOf(s2), coachInfoOf(s3));
  const poWinner = poSeries.hiWon ? s2 : s3;
  const po: Matchup = { hiId: s2, loId: s3, series: poSeries, winnerId: poWinner };

  // 챔피언결정전: 1위(hi) vs PO 승자(lo)
  const finalSeries = playSeries(95000 + season * 17, sq[s1], sq[poWinner], FINAL_TARGET, coachInfoOf(s1), coachInfoOf(poWinner));
  const championId = finalSeries.hiWon ? s1 : poWinner;
  const final: Matchup = { hiId: s1, loId: poWinner, series: finalSeries, winnerId: championId };

  return { seeds, po, final, championId };
}
