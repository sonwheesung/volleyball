// 라이벌 구도 (CLUB_IDENTITY_SYSTEM 6) — 숙적을 누적 데이터에서 결정론 파생(새 저장 0).
// 순위 인접도(최근 5시즌 ±1위로 마친 횟수) + 이번 시즌 접전 상대전적. SOLID: UI→data(여기)→타입만.

import type { Fixture, MatchResult, SeasonArchive } from '../types';

export interface Rival {
  teamId: string;
  adjacent: number;  // 최근 시즌 ±1위로 마친 횟수
  h2hW: number;      // 이번 시즌 상대전적 승
  h2hL: number;      // 패
  close: number;     // 이번 시즌 접전(세트차 ≤1) 횟수
}

/** 내 라이벌(없으면 null — 정립 전). archive=과거 시즌(standings), results=이번 시즌, fixtures=전체 일정. */
export function rivalOf(
  myTeam: string,
  archive: SeasonArchive[],
  results: Record<string, MatchResult>,
  fixtures: Fixture[],
  teams: string[],
): Rival | null {
  // 1) 최근 5시즌 순위 인접도(같은 자리를 다툰 사이)
  const adj: Record<string, number> = {};
  for (const a of archive.slice(-5)) {
    const order = a.standings;
    if (!order) continue;
    const myRank = order.indexOf(myTeam);
    if (myRank < 0) continue;
    for (let r = 0; r < order.length; r++) {
      if (order[r] === myTeam) continue;
      if (Math.abs(r - myRank) <= 1) adj[order[r]] = (adj[order[r]] ?? 0) + 1;
    }
  }
  // 2) 이번 시즌 head-to-head(접전 가중)
  const w: Record<string, number> = {}, l: Record<string, number> = {}, close: Record<string, number> = {};
  for (const f of fixtures) {
    const side = f.homeTeamId === myTeam ? 'home' : f.awayTeamId === myTeam ? 'away' : null;
    if (!side) continue;
    const res = results[f.id];
    if (!res) continue;
    const opp = side === 'home' ? f.awayTeamId : f.homeTeamId;
    const myS = side === 'home' ? res.homeSets : res.awaySets;
    const oppS = side === 'home' ? res.awaySets : res.homeSets;
    if (myS > oppS) w[opp] = (w[opp] ?? 0) + 1; else l[opp] = (l[opp] ?? 0) + 1;
    if (Math.abs(myS - oppS) <= 1) close[opp] = (close[opp] ?? 0) + 1; // 풀세트/한 세트차
  }
  // 3) 라이벌 점수 = 순위인접 ×2 + 접전 ×2 + 맞대결 수
  let best: string | null = null, bestScore = 0;
  for (const t of teams) {
    if (t === myTeam) continue;
    const score = (adj[t] ?? 0) * 2 + (close[t] ?? 0) * 2 + ((w[t] ?? 0) + (l[t] ?? 0));
    if (score > bestScore) { bestScore = score; best = t; }
  }
  if (!best || bestScore < 3) return null; // 정립된 라이벌만(초반 무라이벌)
  return { teamId: best, adjacent: adj[best] ?? 0, h2hW: w[best] ?? 0, h2hL: l[best] ?? 0, close: close[best] ?? 0 };
}
