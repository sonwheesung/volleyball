// 포스트시즌 대진 — 정규리그 상위 3팀. 결정론(시즌 시드 + 종료 시점 OVR).

import { coachInfoOf, getEvolvedTeamPlayers } from './league';
import { availableTeamPlayers } from './injury';
import { computeStandings } from './standings';
import { playSeries, type Series } from '../engine/playoffs';
import { SEASON_DAYS } from '../engine/calendar';

export const REF_DAY = SEASON_DAYS; // 시즌 종료 전력 — 단일 출처(engine/calendar). 포스트시즌 동결 규칙(§5): 진화 조회는 이 날로 클램프.
export const PO_TARGET = 2; // 3전 2선승
export const FINAL_TARGET = 3; // 5전 3선승

// 매치업별 결정론 시드(단일 출처) — 플옵 보드 재생(data/postseason)이 playSeries와 동일 시드로 게임 g를 재현하려고 읽는다.
export const poSeedBase = (season: number): number => 90000 + season * 17;
export const finalSeedBase = (season: number): number => 95000 + season * 17;

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
  for (const id of seeds) sq[id] = availableTeamPlayers(id, REF_DAY); // 부상자 제외(플옵 결장 드라마)

  // 플레이오프: 2위(hi) vs 3위(lo)
  const poSeries = playSeries(poSeedBase(season), sq[s2], sq[s3], PO_TARGET, coachInfoOf(s2), coachInfoOf(s3));
  const poWinner = poSeries.hiWon ? s2 : s3;
  const po: Matchup = { hiId: s2, loId: s3, series: poSeries, winnerId: poWinner };

  // 챔피언결정전: 1위(hi) vs PO 승자(lo)
  const finalSeries = playSeries(finalSeedBase(season), sq[s1], sq[poWinner], FINAL_TARGET, coachInfoOf(s1), coachInfoOf(poWinner));
  const championId = finalSeries.hiWon ? s1 : poWinner;
  const final: Matchup = { hiId: s1, loId: poWinner, series: finalSeries, winnerId: championId };

  return { seeds, po, final, championId };
}

/** 팀별 그 시즌 플옵 시리즈 경기 결과(W/L 시퀀스, 팀 시점) — 리버스 스윕·블론 등 서사 업적용.
 *  한 팀이 PO와 결승을 모두 치르면 2개 시리즈가 쌓인다(시간순: PO 먼저). */
export function seriesByTeam(p: Playoffs): Record<string, ('W' | 'L')[][]> {
  const out: Record<string, ('W' | 'L')[][]> = {};
  const add = (m: Matchup | null) => {
    if (!m) return;
    const hi: ('W' | 'L')[] = m.series.games.map((g) => (g.hiSets > g.loSets ? 'W' : 'L'));
    const lo: ('W' | 'L')[] = m.series.games.map((g) => (g.loSets > g.hiSets ? 'W' : 'L'));
    (out[m.hiId] ??= []).push(hi);
    (out[m.loId] ??= []).push(lo);
  };
  add(p.po);   // PO(2위 vs 3위) 먼저
  add(p.final); // 결승
  return out;
}
