// 간이 경기 시뮬 (Phase 0 임시판).
// OVR 비율 + 시드 RNG로 점수를 한 점씩 굴려 경기를 끝까지 진행한다.
// 풀 엔진(MATCH_SYSTEM: 랠리 체인/로테이션/기세)으로 추후 교체 예정.
// 결정론: 같은 (seed, ovr) = 같은 경기.

import { createRng } from './rng';

export interface PointLog {
  setNo: number;
  home: number;
  away: number;
  scorer: 'home' | 'away';
}

export interface SimResult {
  homeSets: number;
  awaySets: number;
  setScores: { home: number; away: number }[];
  points: PointLog[];
}

function targetPoints(setNo: number): number {
  return setNo >= 5 ? 15 : 25;
}

export function simulateMatchSimple(seed: number, homeOvr: number, awayOvr: number): SimResult {
  const rng = createRng(seed);

  // 기본 득점 확률 = OVR 비율, 0.32~0.68로 클램프(블로아웃 방지)
  let pHome = homeOvr / (homeOvr + awayOvr);
  pHome = Math.max(0.32, Math.min(0.68, pHome));

  const points: PointLog[] = [];
  const setScores: { home: number; away: number }[] = [];
  let homeSets = 0;
  let awaySets = 0;
  let setNo = 1;

  while (homeSets < 3 && awaySets < 3) {
    const target = targetPoints(setNo);
    let h = 0;
    let a = 0;
    while (!((h >= target || a >= target) && Math.abs(h - a) >= 2)) {
      // 약간의 랜덤 흔들림으로 런(연속 득점) 느낌
      const noise = (rng.next() - 0.5) * 0.08;
      const homeScores = rng.chance(pHome + noise);
      if (homeScores) h++;
      else a++;
      points.push({ setNo, home: h, away: a, scorer: homeScores ? 'home' : 'away' });
    }
    setScores.push({ home: h, away: a });
    if (h > a) homeSets++;
    else awaySets++;
    setNo++;
  }

  return { homeSets, awaySets, setScores, points };
}
