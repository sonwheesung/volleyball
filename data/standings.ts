// 리그 순위표 + 전 구단 경기 결과 — 전 경기를 결정론 시뮬해 산출.
// 경기일(dayIndex) 기준 OVR로 계산 → 사용자가 관전한 결과와 일치.
// 성능: 전 경기 1회 계산 후 baseVersion 으로 캐시.

import type { Fixture, MatchResult } from '../types';
import { baseVersion, coachInfoOf, getEvolvedTeamPlayers, getFixture, LEAGUE, SEASON } from './league';
import { availableTeamPlayers } from './injury';
import { currentTxVersion, interventionsFor } from './dynamics';
import { simulateMatch } from '../engine/match';
import { pickRest } from '../engine/lineup';
import { clinchStatus } from '../engine/clinch';
import { SEASON_DAYS } from '../engine/calendar';
import { minAffectedDaySince, spliceSeq } from './spliceLog';

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

// computedUpto(§7.7 cap): 이 캐시가 dayIndex ≤ computedUpto 인 전 경기를 계산해 담고 있음을 나타내는 인메모리
// 워터마크. 전방 확장(cap) 축 — 인과적 day 루프라 cap 이하 행은 풀 시즌 계산과 byte-동일. 영속 안 함(복원 시 행에서 유도).
let cache: { key: string; rows: ResultRow[]; seq: number; computedUpto: number } | null = null;

const maxDayOf = (rows: ResultRow[]): number => rows.reduce((m, r) => (r.dayIndex > m ? r.dayIndex : m), -1);

// 캐시 영속(REALTIME_SIM Phase1) — 계산된 시즌 결과를 세이브에 저장→복원해 재로드 시 재계산(로딩) 제거.
// 결정론 보장(Phase0 수정)이라 같은 키면 행이 동일 → 저장값을 안전히 재사용. 키 불일치(상태 변경)면 재계산(폴백).
// seq(§7 스플라이스): 인메모리 스플라이스용 계산시점 시퀀스 — 영속 안 함(복원 시 현재 seq 주입).
// computedUpto(§7.7 cap): 영속 안 함 — 복원 시 행의 max dayIndex로 유도(안전 하한. 경기 없는 gap은 재요청 시 재시도, 무해).
export const getStandingsCacheRaw = (): { key: string; rows: ResultRow[]; seq: number; computedUpto: number } | null => cache;
export const setStandingsCacheRaw = (c: { key: string; rows: ResultRow[]; seq?: number; computedUpto?: number } | null): void => {
  cache = c ? { key: c.key, rows: c.rows, seq: c.seq ?? spliceSeq(), computedUpto: c.computedUpto ?? maxDayOf(c.rows) } : null;
};

/** 전 경기 결과(결정론). baseVersion + 거래버전 단위 캐시 — 시즌 중 방출/영입 즉시 반영.
 *  두 축의 캐시 재사용을 **합성**한다(REALTIME_SIM §7.1·§7.7):
 *   - **스플라이스(후방 무효화)**: minAffectedDay(0<minDay<∞) 이전 행 재사용, minDay 이후만 재시뮬.
 *   - **cap(전방 확장)**: uptoDay 까지만 시뮬하고 computedUpto 워터마크에 기록. 더 높은 cap 요청 시 (computedUpto, cap] 접미 확장.
 *  재계산 시작일 reuseThreshold = min(minDay, prev.computedUpto+1) 로 두 축을 min 합성 — 결과는 풀 계산과 byte-동일. */
function allResults(uptoDay?: number): ResultRow[] {
  const key = `${baseVersion()}:${currentTxVersion()}`;
  const cap = uptoDay ?? Number.MAX_SAFE_INTEGER; // 미지정 = 전 시즌(하위호환). 초과 행은 seasonResults가 필터.
  // 조기반환(cap 일반화): 키 일치 **및** 이미 cap 이상까지 계산됐을 때만 저장 행 재사용(낮으면 확장 계산으로 진행).
  if (cache && cache.key === key && cache.computedUpto >= cap) return cache.rows;

  const prev = cache;
  const minDay = prev ? minAffectedDaySince(prev.seq) : Infinity;
  const sameKey = !!prev && prev.key === key;
  // 재사용 가능: sameKey(base 불변, 대개 minDay=∞로 전방 확장) 또는 splice(키 변경, minDay 유한&>0). minDay=0(소급)=재사용 불가.
  const canReuse = !!prev && minDay > 0 && (sameKey || Number.isFinite(minDay));
  // 재계산 시작일 = 두 축의 min. **prev.computedUpto+1 로 clamp**(이전 캐시가 실제 가진 범위 초과 재사용 금지 —
  // 안 하면 gap [computedUpto, minDay) 이 재사용도 재시뮬도 안 돼 누락된다).
  const reuseThreshold = canReuse ? Math.min(minDay, prev!.computedUpto + 1) : 0;
  // 재사용 = [0, reuseThreshold) ∩ [0, cap] (cap 초과 행은 버림 → computedUpto=cap 불변식 유지, 필요 시 나중에 재확장).
  const reuse: ResultRow[] = reuseThreshold > 0 ? prev!.rows.filter((r) => r.dayIndex < reuseThreshold && r.dayIndex <= cap) : [];

  // 경기일별로 묶어 그 날 OVR 한 번만 계산 (재사용 구간 [0,reuseThreshold) 제외 + cap 초과 제외)
  const byDay = new Map<number, Fixture[]>();
  for (const f of SEASON) {
    if (f.dayIndex < reuseThreshold) continue; // 재사용 구간 — 시뮬 생략
    if (f.dayIndex > cap) continue;            // cap 초과 — 전방 확장 시 미계산(요청 시 확장)
    const arr = byDay.get(f.dayIndex) ?? [];
    arr.push(f);
    byDay.set(f.dayIndex, arr);
  }

  // 로드 매니지먼트(#3): 러닝 순위를 누적하며 진행 — day일 휴식은 day−1까지의 실제 순위로 판정(인과적·비순환).
  const totalGames: Record<string, number> = {};
  for (const f of SEASON) { totalGames[f.homeTeamId] = (totalGames[f.homeTeamId] ?? 0) + 1; totalGames[f.awayTeamId] = (totalGames[f.awayTeamId] ?? 0) + 1; }
  const running: Record<string, { wins: number; played: number }> = {};
  for (const t of LEAGUE.teams) running[t.id] = { wins: 0, played: 0 };
  // 러닝 상태 재구성(§7.1): 재사용 행(dayIndex<reuseThreshold)에서 reuseThreshold 진입 시점 순위를 다시 쌓는다
  // (재시뮬 아님 — 합산이라 순서 무관, 전체 경로가 reuseThreshold 진입 시 가지는 running과 동일).
  for (const r of reuse) {
    running[r.homeTeamId].played++; running[r.awayTeamId].played++;
    if (r.homeSets > r.awaySets) running[r.homeTeamId].wins++; else running[r.awayTeamId].wins++;
  }

  const rows: ResultRow[] = [...reuse];
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
        home: coachInfoOf(f.homeTeamId, f.dayIndex), away: coachInfoOf(f.awayTeamId, f.dayIndex), // 축3: 그날의 감독(부임 이전 경기는 이전 감독)
        interventions: interventionsFor(f.id), // 개입 로그 주입(MATCH_INTERVENTION §2.2) — 비면 [] = 바이트 동일
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
  cache = { key, rows, seq: spliceSeq(), computedUpto: cap };
  return rows;
}

/** uptoDay 까지 치른 경기 결과(최근순 정렬은 호출측에서) */
export function seasonResults(uptoDay: number): ResultRow[] {
  // 빈 구간 가드(2026-07-08, leagueProductionRange 선례) — day0 오프시즌 대시보드가 computeStandings(-1)/
  // seasonResults(-1)를 부르면 옛 코드는 allResults()(전 시즌 시드 재생, 콜드 265~544ms)를 돌려 **빈 결과**를 냈다.
  // 경기일(dayIndex)은 항상 ≥0이라 uptoDay<0이면 치른 경기 0 → 시뮬 없이 즉시 빈 배열.
  if (uptoDay < 0) return [];
  // cap=uptoDay 전달(§7.7): allResults가 uptoDay 까지만 계산(전방 확장). 초과 행이 캐시에 있어도 필터로 잘림.
  return allResults(uptoDay).filter((r) => r.dayIndex <= uptoDay);
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

/** §3.2(2026-06-24) — 표시용 "리그 진행" 컷오프 = 현재 경기일 **직전**까지. 현재 경기일은 관전 중이라 제외.
 *  ⚠ **표시엔 deprecated(§3.3, 2026-07-07)** — 이 단독 헬퍼는 "방금 관전한 경기"(F2-a)와 "시즌 마지막 경기일"(F2-b)을
 *  놓친다. 표시 화면은 `displayCutoff(currentDay, results, myTeamId)`를 써라. 비표시 용도(진단 리플레이)만 유지.
 *  ~~계약 시장가~~ 도 **표시**라 `displayCutoff`로 이행(2026-07-07, §3.3) — player 상세(displayCutoff)와 계약 화면(leagueDisplayDay) 이원화 해소. */
export const leagueDisplayDay = (currentDay: number): number => currentDay - 1;

/** 내 팀의 이번 시즌 전 일정을 기록(관전) 완료했는가 — 시즌 종료 판정(표시 컷오프 승격·잠정 라벨 경계용, §3.3). */
export function seasonComplete(results: Record<string, MatchResult>, myTeamId: string): boolean {
  let total = 0, played = 0;
  for (const f of SEASON) {
    if (f.homeTeamId !== myTeamId && f.awayTeamId !== myTeamId) continue;
    total++;
    if (results[f.id]) played++;
  }
  return total > 0 && played === total;
}

/** §3.3(2026-07-07) — 결과 인지 표시 컷오프. `leagueDisplayDay`(currentDay−1) 단독의 두 사각을 보완:
 *  (F2-a) 방금 관전·기록한 현재 경기일(currentDay는 다음 경기 진행 때까지 안 올라감) → `playedThroughDay`로 포함.
 *  (F2-b) 시즌 종료(내 팀 전 일정 완료) → 다음 경기가 없어 currentDay가 마지막 경기일에 멈춤 → `SEASON_DAYS`로
 *         승격해 리그 최종일 전체 공개(순위·결과·기록·뉴스가 PO/시상/아카이브와 일치).
 *  스포일러 안전: `playedThroughDay`는 내가 이미 관전·기록한 경기만 반영(같은 날 타팀 경기는 "다음" 버튼과 동일하게 공개),
 *  내 미관전 미래 경기일은 항상 `playedThroughDay`보다 크므로 미래 결과 누수 0. clinch는 계속 `playedThroughDay`(문서화된 예외). */
export function displayCutoff(currentDay: number, results: Record<string, MatchResult>, myTeamId?: string): number {
  if (myTeamId && seasonComplete(results, myTeamId)) return SEASON_DAYS;
  return Math.max(currentDay - 1, playedThroughDay(results));
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

/** 드래프트 순번용 — 시즌 전체 기준 하위 팀부터. §7.8: pre 주입(끝난 시즌 캡처 순위) 시 COLD 재시뮬 회피(미제공=라이브). */
export function standingsWorstFirst(pre?: Standing[]): string[] {
  return (pre ?? computeStandings(Number.MAX_SAFE_INTEGER)).slice().reverse().map((s) => s.teamId);
}
