// 리그 순위표 — 전 경기를 결정론 시뮬해 산출(드래프트 순번·순위 UI용).
// 성능: 시즌 중 1개 기준일의 팀 OVR로 고정해 한 번만 진화 계산 + 126경기 시뮬.

import { SEASON, getEvolvedTeamPlayers, LEAGUE } from './league';
import { teamOverall } from '../engine/overall';
import { simulateMatchSimple } from '../engine/simMatch';

export interface Standing {
  teamId: string;
  wins: number;
  losses: number;
  setDiff: number;
}

const REF_DAY = 120; // 시즌 후반 기준 전력

export function computeStandings(): Standing[] {
  const ovr: Record<string, number> = {};
  for (const t of LEAGUE.teams) ovr[t.id] = teamOverall(getEvolvedTeamPlayers(t.id, REF_DAY));

  const table: Record<string, Standing> = {};
  for (const t of LEAGUE.teams) table[t.id] = { teamId: t.id, wins: 0, losses: 0, setDiff: 0 };

  for (const f of SEASON) {
    const sim = simulateMatchSimple(f.seed, ovr[f.homeTeamId], ovr[f.awayTeamId]);
    const h = table[f.homeTeamId];
    const a = table[f.awayTeamId];
    const sd = sim.homeSets - sim.awaySets;
    h.setDiff += sd;
    a.setDiff -= sd;
    if (sim.homeSets > sim.awaySets) {
      h.wins++;
      a.losses++;
    } else {
      a.wins++;
      h.losses++;
    }
  }

  return Object.values(table).sort((x, y) => y.wins - x.wins || y.setDiff - x.setDiff);
}

/** 하위 팀부터(드래프트 순번 기준) */
export function standingsWorstFirst(): string[] {
  return computeStandings()
    .slice()
    .reverse()
    .map((s) => s.teamId);
}
