// 포스트시즌 (KOVO 여자부 방식). 순수 함수 + 시드 결정론.
// 정규 1위 챔프전 직행 / 2위 vs 3위 PO(3전2선승) / 챔프전(5전3선승).
// 상위 시드(hi)에 홈 어드밴티지(능력 배수 +).

import type { Player } from '../types';
import { simulateMatch, type CoachInfo } from './match';

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

export const HI_EDGE = 1.03; // 상위 시드 어드밴티지(능력 배수). 플옵 보드 재생(data/postseason.buildPlayoffBox)이 playSeries와
                             //   입력 바이트 공유를 위해 읽는다 — 값 손복제 금지(_dv_playoffs 보드재생 가드).

/** 한 시리즈(best-of, target선승). hi=상위 시드(home). 결정론(seed). */
export function playSeries(
  seed: number, hi: Player[], lo: Player[], target: number,
  hiCoach?: CoachInfo, loCoach?: CoachInfo,
): Series {
  let hiWins = 0;
  let loWins = 0;
  const games: SeriesGame[] = [];
  let g = 0;
  while (hiWins < target && loWins < target) {
    const r = simulateMatch(seed + g * 1009, hi, lo, { edge: { home: HI_EDGE, away: 1 }, home: hiCoach, away: loCoach });
    games.push({ hiSets: r.homeSets, loSets: r.awaySets });
    if (r.homeSets > r.awaySets) hiWins++;
    else loWins++;
    g++;
  }
  return { hiWins, loWins, games, hiWon: hiWins > loWins };
}
