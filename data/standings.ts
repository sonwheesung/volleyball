// 리그 순위표 + 전 구단 경기 결과 — 전 경기를 결정론 시뮬해 산출.
// 경기일(dayIndex) 기준 OVR로 계산 → 사용자가 관전한 결과와 일치.
// 성능: 전 경기 1회 계산 후 baseVersion 으로 캐시.

import type { Fixture, MatchResult } from '../types';
import { baseVersion, coachInfoOf, getEvolvedTeamPlayers, getFixture, LEAGUE, SEASON } from './league';
import { availableTeamPlayers } from './injury';
import { currentTxVersion } from './dynamics';
import { simulateMatch } from '../engine/match';
import { pickRest } from '../engine/lineup';
import { clinchStatus } from '../engine/clinch';

const PLAYOFF_CUTOFF = 3; // data/clinch.PLAYOFF_CUTOFF와 동일(순환 import 회피 위해 로컬 — 로드매니지먼트 #3)

export interface ResultRow {
  fixtureId: string;
  round: number;
  dayIndex: number;
  homeTeamId: string;
  awayTeamId: string;
  homeSets: number;
  awaySets: number;
  homePoints: number; // 전 세트 합산 득점(점수득실률 타이브레이크용)
  awayPoints: number;
}

export interface Standing {
  teamId: string;
  played: number;
  wins: number;
  losses: number;
  points: number;     // 승점(KOVO): 3-0·3-1=3 / 3-2=2 / 2-3=1 / 0-3·1-3=0
  setsWon: number;
  setsLost: number;
  pointsWon: number;
  pointsLost: number;
  setDiff: number;    // 세트 득실차(표시·구버전 호환). 순위 결정은 승점→승률→세트득실률→점수득실률
}

/** KOVO 타이브레이크 비율 — 분모 0(미실시·전패 없음) 보호 */
const ratio = (won: number, lost: number): number => (lost > 0 ? won / lost : won > 0 ? Infinity : 0);
const winRate = (s: Standing): number => (s.played > 0 ? s.wins / s.played : 0);

let cache: { key: string; rows: ResultRow[] } | null = null;

/** 전 경기 결과(결정론). baseVersion + 거래버전 단위 캐시 — 시즌 중 방출/영입 즉시 반영 */
function allResults(): ResultRow[] {
  const key = `${baseVersion()}:${currentTxVersion()}`;
  if (cache && cache.key === key) return cache.rows;

  // 경기일별로 묶어 그 날 OVR 한 번만 계산
  const byDay = new Map<number, Fixture[]>();
  for (const f of SEASON) {
    const arr = byDay.get(f.dayIndex) ?? [];
    arr.push(f);
    byDay.set(f.dayIndex, arr);
  }

  // 로드 매니지먼트(#3): 러닝 순위를 누적하며 진행 — day일 휴식은 day−1까지의 실제 순위로 판정(인과적·비순환).
  const totalGames: Record<string, number> = {};
  for (const f of SEASON) { totalGames[f.homeTeamId] = (totalGames[f.homeTeamId] ?? 0) + 1; totalGames[f.awayTeamId] = (totalGames[f.awayTeamId] ?? 0) + 1; }
  const running: Record<string, { wins: number; played: number }> = {};
  for (const t of LEAGUE.teams) running[t.id] = { wins: 0, played: 0 };

  const rows: ResultRow[] = [];
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    // 그 시점(day−1까지) 순위가 굳은(확정/탈락) 팀만 휴식 자격
    const clinch = clinchStatus(LEAGUE.teams.map((t) => ({ teamId: t.id, wins: running[t.id].wins, remaining: Math.max(0, (totalGames[t.id] ?? 0) - running[t.id].played) })), PLAYOFF_CUTOFF);
    const eligible = new Set(clinch.filter((c) => c.state === 'clinched' || c.state === 'eliminated').map((c) => c.teamId));
    const squad: Record<string, ReturnType<typeof getEvolvedTeamPlayers>> = {};
    for (const t of LEAGUE.teams) {
      const avail = availableTeamPlayers(t.id, day); // 부상자 제외 명단
      const rest = eligible.has(t.id) ? pickRest(avail, t.id, day) : new Set<string>();
      squad[t.id] = rest.size ? avail.filter((p) => !rest.has(p.id)) : avail; // 굳은 순위면 주전 1~2명 휴식(백업 출전)
    }
    for (const f of byDay.get(day)!) {
      const sim = simulateMatch(f.seed, squad[f.homeTeamId], squad[f.awayTeamId], {
        home: coachInfoOf(f.homeTeamId), away: coachInfoOf(f.awayTeamId),
      });
      rows.push({
        fixtureId: f.id,
        round: f.round,
        dayIndex: f.dayIndex,
        homeTeamId: f.homeTeamId,
        awayTeamId: f.awayTeamId,
        homeSets: sim.homeSets,
        awaySets: sim.awaySets,
        homePoints: sim.setScores.reduce((s, x) => s + x.home, 0), // 점수득실률 타이브레이크
        awayPoints: sim.setScores.reduce((s, x) => s + x.away, 0),
      });
      running[f.homeTeamId].played++; running[f.awayTeamId].played++;
      if (sim.homeSets > sim.awaySets) running[f.homeTeamId].wins++; else running[f.awayTeamId].wins++;
    }
  }
  rows.sort((a, b) => a.dayIndex - b.dayIndex);
  cache = { key, rows };
  return rows;
}

/** uptoDay 까지 치른 경기 결과(최근순 정렬은 호출측에서) */
export function seasonResults(uptoDay: number): ResultRow[] {
  return allResults().filter((r) => r.dayIndex <= uptoDay);
}

/**
 * "실제로 치른 마지막 경기일" — 사용자가 기록(results)으로 완료한 경기 중 최대 dayIndex.
 * currentDay 는 다음 경기로 진행(setDay)하는 순간 미리 올라가므로, 아직 관전·기록하지 않은
 * 경기까지 순위표에 반영돼 대시보드 성적(results 기반)과 어긋났다(사용자 보고). 순위/결과 화면은
 * currentDay 대신 이 값을 쓰면 "치르지 않은 경기는 반영 안 됨"이 보장된다(대시보드와 일치).
 * 기록이 없으면 -1(시즌 전 — 0경기).
 */
export function playedThroughDay(results: Record<string, MatchResult>): number {
  let max = -1;
  for (const id of Object.keys(results)) {
    const f = getFixture(id);
    if (f && f.dayIndex > max) max = f.dayIndex;
  }
  return max;
}

/** 팀별 그 시즌 최장 연승·연패 — 각 팀의 경기를 날짜순으로 보고 W/L 런 최댓값(연승/연패 업적용) */
export function seasonStreaks(uptoDay: number): Record<string, [number, number]> {
  const rows = seasonResults(uptoDay).slice().sort((a, b) => a.dayIndex - b.dayIndex);
  const out: Record<string, [number, number]> = {};
  const acc: Record<string, { w: number; l: number; mw: number; ml: number }> = {};
  for (const r of rows) {
    const homeWon = r.homeSets > r.awaySets;
    for (const [team, won] of [[r.homeTeamId, homeWon], [r.awayTeamId, !homeWon]] as [string, boolean][]) {
      const a = (acc[team] ??= { w: 0, l: 0, mw: 0, ml: 0 });
      if (won) { a.w += 1; a.l = 0; if (a.w > a.mw) a.mw = a.w; }
      else { a.l += 1; a.w = 0; if (a.l > a.ml) a.ml = a.l; }
    }
  }
  for (const t of Object.keys(acc)) out[t] = [acc[t].mw, acc[t].ml];
  return out;
}

/** 승점(KOVO): 승 3-0·3-1=3 / 3-2=2 · 패 2-3=1 / 0-3·1-3=0 — **패자 세트수**로 판정
 *  (승자 세트는 항상 3이므로 패자가 1세트 이하면 3-0/3-1=완승, 2세트면 3-2 풀세트). */
export function matchPoints(winnerSets: number, loserSets: number): [number, number] {
  if (loserSets <= 1) return [3, 0]; // 3-0 / 3-1 (완승 3점)
  return [2, 1];                      // 3-2 (풀세트 — 승자 2점·패자 1점)
}

/** uptoDay 시점 순위표 — KOVO 순위 결정: 승점 → 승률 → 세트득실률 → 점수득실률 */
export function computeStandings(uptoDay: number): Standing[] {
  const table: Record<string, Standing> = {};
  for (const t of LEAGUE.teams) table[t.id] = { teamId: t.id, played: 0, wins: 0, losses: 0, points: 0, setsWon: 0, setsLost: 0, pointsWon: 0, pointsLost: 0, setDiff: 0 };
  for (const r of seasonResults(uptoDay)) {
    const h = table[r.homeTeamId];
    const a = table[r.awayTeamId];
    h.played++; a.played++;
    h.setsWon += r.homeSets; h.setsLost += r.awaySets; a.setsWon += r.awaySets; a.setsLost += r.homeSets;
    h.pointsWon += r.homePoints; h.pointsLost += r.awayPoints; a.pointsWon += r.awayPoints; a.pointsLost += r.homePoints;
    h.setDiff += r.homeSets - r.awaySets; a.setDiff += r.awaySets - r.homeSets;
    const homeWon = r.homeSets > r.awaySets;
    const [wp, lp] = matchPoints(Math.max(r.homeSets, r.awaySets), Math.min(r.homeSets, r.awaySets));
    if (homeWon) { h.wins++; a.losses++; h.points += wp; a.points += lp; }
    else { a.wins++; h.losses++; a.points += wp; h.points += lp; }
  }
  // 승점 → 승률 → 세트득실률 → 점수득실률 (KOVO 정렬)
  return Object.values(table).sort((x, y) =>
    y.points - x.points
    || winRate(y) - winRate(x)
    || ratio(y.setsWon, y.setsLost) - ratio(x.setsWon, x.setsLost)
    || ratio(y.pointsWon, y.pointsLost) - ratio(x.pointsWon, x.pointsLost));
}

/** 드래프트 순번용 — 시즌 전체 기준 하위 팀부터 */
export function standingsWorstFirst(): string[] {
  return computeStandings(Number.MAX_SAFE_INTEGER).slice().reverse().map((s) => s.teamId);
}
