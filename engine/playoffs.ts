// 포스트시즌 (KOVO 여자부 방식). 순수 함수 + 시드 결정론.
// 정규 1위 챔프전 직행 / 2위 vs 3위 PO(3전2선승) / 챔프전(5전3선승).
// 상위 시드(hi)에 홈 어드밴티지(+2 OVR).

import { simulateMatchSimple } from './simMatch';

export interface SeriesGame {
  hiSets: number;
  loSets: number;
}

export interface Series {
  hiWins: number;
  loWins: number;
  games: SeriesGame[];
  hiWon: boolean; // 상위 시드 승리 여부
}

const HOME_ADV = 2;

/** 한 시리즈(best-of, target선승). hi=상위 시드. 결정론(seed). */
export function playSeries(seed: number, ovrHi: number, ovrLo: number, target: number): Series {
  let hiWins = 0;
  let loWins = 0;
  const games: SeriesGame[] = [];
  let g = 0;
  while (hiWins < target && loWins < target) {
    const r = simulateMatchSimple(seed + g * 1009, ovrHi + HOME_ADV, ovrLo);
    games.push({ hiSets: r.homeSets, loSets: r.awaySets });
    if (r.homeSets > r.awaySets) hiWins++;
    else loWins++;
    g++;
  }
  return { hiWins, loWins, games, hiWon: hiWins > loWins };
}
