// 세트/경기 진행 (CLAUDE.md 4.4, MATCH_SYSTEM 7·8장).
// 1~4세트 25점, 5세트 15점, 모두 듀스(2점차). 5세트 3선승. 랠리포인트제.
// 매 세트 서브권 시작 팀 교대. 사이드아웃 시 회전(1.1) + 기세 갱신(7.2) + 타임아웃(7.4).
// playRally를 돌려 SimResult(간이 시뮬과 동일 계약)를 출력 → 드롭인 교체 가능.

import type { Player, Side, CoachStyle } from '../types';
import type { SimResult, PointLog } from './simMatch';
import type { Ratings } from './ratings';
import { createRng } from './rng';
import { deriveRatings } from './ratings';
import { buildLineup } from './lineup';
import { playRally, momFactor, STAM_REGEN_BASE, type RallyTeam, type Edge, type RallyStats } from './rally';
import { rotate } from './rotation';

export function targetPoints(setNo: number): number {
  return setNo >= 5 ? 15 : 25;
}

export function isSetOver(home: number, away: number, setNo: number): boolean {
  const target = targetPoints(setNo);
  return (home >= target || away >= target) && Math.abs(home - away) >= 2;
}

const START_MOMENTUM = 50;
const TIMEOUTS_PER_SET = 2;
// 감독 성향별 타임아웃 호출 임계(상대 연속득점 수). 수비형은 일찍, 공격형은 늦게(아낀다)
const TO_THRESHOLD: Record<CoachStyle, number> = { defense: 3, balanced: 4, attack: 5 };

export interface CoachInfo { style: CoachStyle; charisma: number }
export interface MatchOpts { edge?: Edge; home?: CoachInfo; away?: CoachInfo; stats?: RallyStats }

const DEFAULT_COACH: CoachInfo = { style: 'balanced', charisma: 50 };

/**
 * 풀 랠리 체인 경기 시뮬 — 양 팀 로스터(코트 선발 자동 구성) + 시드 → SimResult.
 * 결정론: 같은 (seed, 선수 스탯, 감독) = 같은 경기.
 */
export function simulateMatch(
  seed: number,
  homePlayers: Player[],
  awayPlayers: Player[],
  opts: MatchOpts = {},
): SimResult {
  const rng = createRng(seed >>> 0);
  const edge: Edge = opts.edge ?? { home: 1, away: 1 };
  const hc = opts.home ?? DEFAULT_COACH;
  const ac = opts.away ?? DEFAULT_COACH;

  const homeLineup = buildLineup(homePlayers);
  const awayLineup = buildLineup(awayPlayers);

  // 능력치 캐시 (경기당 1회 산출)
  const cache = new Map<string, Ratings>();
  const R = (p: Player): Ratings => {
    let r = cache.get(p.id);
    if (!r) { r = deriveRatings(p); cache.set(p.id, r); }
    return r;
  };

  // 코트 인원(선발+리베로) 체력 — 경기 내내 누적, 랠리/세트 사이 회복(7.1)
  const onCourt = (lu: typeof homeLineup) => [...lu.six, ...(lu.libero ? [lu.libero] : [])];
  const homeStam = new Map<string, number>();
  const awayStam = new Map<string, number>();
  for (const p of onCourt(homeLineup)) homeStam.set(p.id, 1);
  for (const p of onCourt(awayLineup)) awayStam.set(p.id, 1);

  const home: RallyTeam = { six: homeLineup.six, libero: homeLineup.libero, rotation: 0, momentum: START_MOMENTUM, stam: homeStam, injured: new Set(), style: hc.style };
  const away: RallyTeam = { six: awayLineup.six, libero: awayLineup.libero, rotation: 0, momentum: START_MOMENTUM, stam: awayStam, injured: new Set(), style: ac.style };
  const teamOf = (s: Side) => (s === 'home' ? home : away);
  const charismaOf = (s: Side) => (s === 'home' ? hc.charisma : ac.charisma);

  // 랠리 사이 회복 — 체젠(staminaRegen) 높을수록 빨리 회복
  const recover = (lu: typeof homeLineup, m: Map<string, number>, scale: number) => {
    for (const p of onCourt(lu)) {
      m.set(p.id, Math.min(1, (m.get(p.id) ?? 1) + scale * (0.4 + p.staminaRegen / 100)));
    }
  };

  const points: PointLog[] = [];
  const setScores: { home: number; away: number }[] = [];
  let homeSets = 0;
  let awaySets = 0;
  let setNo = 1;

  while (homeSets < 3 && awaySets < 3) {
    let h = 0;
    let a = 0;

    // 세트 시작: 기세 50, 회전 0, 서브권 교대(홀수 세트 홈), 타임아웃·휴식
    home.momentum = START_MOMENTUM;
    away.momentum = START_MOMENTUM;
    home.rotation = 0;
    away.rotation = 0;
    recover(homeLineup, homeStam, 0.5);
    recover(awayLineup, awayStam, 0.5);
    const timeouts = { home: TIMEOUTS_PER_SET, away: TIMEOUTS_PER_SET };
    let serving: Side = setNo % 2 === 1 ? 'home' : 'away';

    let lastScorer: Side | null = null;
    let streak = 0;

    while (!isSetOver(h, a, setNo)) {
      const winner = playRally(serving, home, away, R, rng, edge, opts.stats);
      if (opts.stats && winner !== serving) opts.stats.sideouts++;
      if (winner === 'home') h++; else a++;
      points.push({ setNo, home: h, away: a, scorer: winner });

      // 기세 갱신 (연속 득점 가속, 7.2)
      streak = winner === lastScorer ? streak + 1 : 1;
      lastScorer = winner;
      const delta = 4 + 1.2 * Math.min(streak, 6);
      teamOf(winner).momentum = Math.min(100, teamOf(winner).momentum + delta);
      const loserSide: Side = winner === 'home' ? 'away' : 'home';
      teamOf(loserSide).momentum = Math.max(0, teamOf(loserSide).momentum - delta);

      // 사이드아웃: 서브권 없던 팀이 득점 → 서브권 획득 + 회전(1.1)
      if (winner !== serving) {
        teamOf(winner).rotation = rotate(teamOf(winner).rotation);
        serving = winner;
      }

      // 타임아웃 (7.4/8장): 상대 연속득점이 임계 도달 + 잔여 보유 → 지는 팀 감독 호출.
      // 양 팀 기세를 50으로 수렴(폭 = 호출 감독 카리스마). 좋은 흐름일 때 부르면 손해.
      if (!isSetOver(h, a, setNo) && streak >= TO_THRESHOLD[teamOf(loserSide).style] && timeouts[loserSide] > 0) {
        timeouts[loserSide]--;
        const pull = (charismaOf(loserSide) / 100) * 0.6;
        home.momentum += (50 - home.momentum) * pull;
        away.momentum += (50 - away.momentum) * pull;
        streak = 0;
        lastScorer = null;
      }

      // 랠리 사이 체력 회복(7.1)
      recover(homeLineup, homeStam, STAM_REGEN_BASE);
      recover(awayLineup, awayStam, STAM_REGEN_BASE);
    }

    setScores.push({ home: h, away: a });
    if (h > a) homeSets++; else awaySets++;
    setNo++;
  }

  return { homeSets, awaySets, setScores, points };
}

// momFactor 재노출(테스트/튜닝용)
export { momFactor };
