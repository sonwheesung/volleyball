// 업적 판정 입력 조립 — **단일 셀렉터**(ACHIEVEMENT_SYSTEM §입력 배선, 2026-08-08).
//
// 왜 이 파일이 있나: `evalAchievements(AchInput)`을 호출부가 **손으로 조립**하던 곳이 5군데였고
// 그중 2곳(탭 빨간 점 `app/(tabs)/_layout.tsx`, 구세이브 claim 시드 `store/useGameStore` rehydrate)이
// 스토어 raw `careerTotals`를 그대로 넣었다. `careerTotals`는 `endSeason`에서만 누적되므로 **시즌 하나 통째**로
// 0 — 탭 빨간 점이 첫 시즌 내내 안 켜져 신규 유저가 다이아를 못 받았다(운영 실피해 2026-08-08, 6건 60💎 지연).
// 호출부가 늘 때마다 같은 사고가 재발하므로 **입력 조립을 여기 하나로 접는다**(UI는 evalAchievements 직접 호출 금지 —
// 구조 가드 `_dv_arch` [ach-eval] 규칙이 강제).
//
// 두 모드:
//   · 'exact' — `achTotals(저장 + 이번 시즌 진행분)`. 진행분은 `leagueProduction`/`computeStandings` 리플레이라
//                콜드에 무겁다(폰 20~30s). **화면(마이페이지·업적)·수령 경로 전용.**
//   · 'floor' — **시뮬 0회 하한.** `results`(MatchResult{fixtureId,homeSets,awaySets})만으로 순수 산술 유도.
//                세트 승/패·경기 승/패는 직독 가능, 득점·에이스(선수별 생산)는 유도 불가라 저장값 그대로.
//                **앱 루트에 상시 마운트되는 탭(`_layout.tsx`) 전용** — 거기서 시뮬을 켜면 동기 프리즈.
//
// 하한 성질(필수 불변식): `floor ≤ exact` 필드별. `exact`는 cutoff(=playedThroughDay) 이하 **모든** 픽스처를
//   리플레이하고 `results`는 그 부분집합이므로 자연히 성립 → **거짓 양성(없는데 점 켜짐) 0**. 업적 `cur`는 전부
//   totals에 단조 증가라 floor로 열린 업적은 exact에서도 반드시 열린다.
//   ⚠ 고아 fixtureId(시즌 롤오버 후 남은 키 — `getFixture`가 undefined)는 **반드시 스킵**(data/standings.ts
//   `playedThroughDay`와 같은 패턴). 안 하면 승패 과다 집계로 하한 성질이 깨진다.
//
// 기회주의 캐시: 화면·수령 경로가 이미 계산한 exact totals를 스토어 **비영속** 필드에 {teamId,season,cutoff}
//   키와 함께 남겨두면, 탭이 그 키가 신선할 때만 정확값을 쓴다(아니면 하한). 새 영속 필드는 금지 —
//   세이브 마이그레이션 체인 부채가 생긴다.
import type { HofEntry, MatchResult, Milestone, SeasonArchive } from '../types';
import { evalAchievements, type AchStatus, type CareerLog, type CareerTotals } from '../engine/achievements';
import { unclaimedReward } from '../engine/diamonds';
import { achTotals } from './careerTotals';
import { getFixture } from './league';
import { playedThroughDay } from './standings';

export type AchMode = 'floor' | 'exact';

/** 정확값 기회주의 캐시(비영속) — 이 키가 현재 상태와 같을 때만 신선. */
export interface AchTotalsCache {
  teamId: string;
  season: number;
  cutoff: number;   // playedThroughDay(results)
  totals: CareerTotals;
}

/**
 * 셀렉터 입력 = 게임 스토어 상태의 구조적 부분집합(`GameState`가 그대로 만족).
 * data → store 역방향 의존 금지(CLAUDE §8)이라 스토어 타입을 import하지 않고 구조로 받는다.
 * 전 필드 optional — rehydrate 중 persisted 부분 상태(구세이브 claim 시드)도 그대로 먹인다.
 */
export interface AchStateSlice {
  selectedTeamId?: string | null;
  season?: number;
  archive?: SeasonArchive[];
  hallOfFame?: HofEntry[];
  milestones?: Milestone[];
  cash?: number;
  fanScore?: number;
  careerLog?: CareerLog;
  careerTotals?: CareerTotals;
  results?: Record<string, MatchResult>;
  claimedAch?: string[];
}

const ZERO: CareerTotals = { points: 0, aces: 0, setsWon: 0, setsLost: 0, matchWins: 0, matchLosses: 0 };

/** 캐시 신선도 키 — (내 팀, 시즌, 치른 마지막 경기일). 이 3개가 같으면 achTotals 결과는 동일하다
 *  (저장 careerTotals는 endSeason에서만 바뀌고 그건 season을 올린다 · 진행분은 cutoff의 함수). */
export function achCacheKey(s: AchStateSlice): { teamId: string; season: number; cutoff: number } {
  return { teamId: s.selectedTeamId ?? '', season: s.season ?? 0, cutoff: playedThroughDay(s.results ?? {}) };
}

/**
 * **시뮬 0회 하한** — 유저가 기록한 `results`만으로 순수 산술 유도(고아 fixtureId 스킵).
 * 유도 가능: setsWon/setsLost/matchWins/matchLosses. 유도 불가(선수별 생산 필요): points/aces → 0.
 */
export function resultsOnlyTotals(myTeamId: string, results: Record<string, MatchResult>): CareerTotals {
  if (!myTeamId) return { ...ZERO };
  let setsWon = 0, setsLost = 0, matchWins = 0, matchLosses = 0;
  for (const id of Object.keys(results)) {
    const f = getFixture(id);
    if (!f) continue; // 고아 키(시즌 롤오버 잔존) — 스킵 안 하면 승패 과다 집계 → 하한 성질 붕괴
    const isHome = f.homeTeamId === myTeamId;
    const isAway = f.awayTeamId === myTeamId;
    if (!isHome && !isAway) continue; // 타팀 경기
    const r = results[id];
    const mine = isHome ? r?.homeSets : r?.awaySets;
    const opp = isHome ? r?.awaySets : r?.homeSets;
    if (!Number.isFinite(mine) || !Number.isFinite(opp)) continue; // 손상 세이브 방어(하한이라 버리는 쪽이 안전)
    setsWon += Math.max(0, mine as number);
    setsLost += Math.max(0, opp as number);
    if ((mine as number) > (opp as number)) matchWins += 1;
    else if ((opp as number) > (mine as number)) matchLosses += 1; // 무승부는 배구에 없음 — 방어적으로 어느 쪽도 안 셈
  }
  return { points: 0, aces: 0, setsWon, setsLost, matchWins, matchLosses };
}

const addTotals = (a: CareerTotals, b: CareerTotals): CareerTotals => ({
  points: a.points + b.points, aces: a.aces + b.aces,
  setsWon: a.setsWon + b.setsWon, setsLost: a.setsLost + b.setsLost,
  matchWins: a.matchWins + b.matchWins, matchLosses: a.matchLosses + b.matchLosses,
});

const maxTotals = (a: CareerTotals, b: CareerTotals): CareerTotals => ({
  points: Math.max(a.points, b.points), aces: Math.max(a.aces, b.aces),
  setsWon: Math.max(a.setsWon, b.setsWon), setsLost: Math.max(a.setsLost, b.setsLost),
  matchWins: Math.max(a.matchWins, b.matchWins), matchLosses: Math.max(a.matchLosses, b.matchLosses),
});

const cacheFresh = (s: AchStateSlice, cache?: AchTotalsCache | null): boolean => {
  if (!cache) return false;
  const k = achCacheKey(s);
  return cache.teamId === k.teamId && cache.season === k.season && cache.cutoff === k.cutoff;
};

/**
 * 모드별 통산 totals.
 * - 'exact': `achTotals`(저장 + 이번 시즌 진행분 리플레이).
 * - 'floor': 저장 + `resultsOnlyTotals`. 캐시가 신선하면 필드별 max로 정확값을 흡수
 *   (신선 캐시 = 같은 키의 exact이므로 max == exact. 하한보다 작아지는 일은 구조적으로 없음).
 */
export function achTotalsFor(s: AchStateSlice, mode: AchMode, cache?: AchTotalsCache | null): CareerTotals {
  const my = s.selectedTeamId ?? '';
  const stored = s.careerTotals ?? ZERO;
  const results = s.results ?? {};
  if (mode === 'exact') return achTotals(my, stored, results);
  const floor = addTotals(stored, resultsOnlyTotals(my, results));
  return cacheFresh(s, cache) ? maxTotals(floor, cache!.totals) : floor;
}

export interface AchEval {
  statuses: AchStatus[];
  totals: CareerTotals;
  key: { teamId: string; season: number; cutoff: number };
}

/** 업적 상태 평가 — **모든 호출부의 단일 입구**. exact 결과는 호출부가 `key`+`totals`로 캐시에 남긴다. */
export function achEvalFor(s: AchStateSlice, mode: AchMode, cache?: AchTotalsCache | null): AchEval {
  const totals = achTotalsFor(s, mode, cache);
  const statuses = evalAchievements({
    myTeamId: s.selectedTeamId ?? '',
    archive: s.archive ?? [],
    hof: s.hallOfFame ?? [],
    milestones: s.milestones ?? [],
    cash: s.cash ?? 0,
    fanScore: s.fanScore ?? 50,
    careerLog: s.careerLog,
    careerTotals: totals,
  });
  return { statuses, totals, key: achCacheKey(s) };
}

/** 편의 — 상태 평가 결과만. */
export const achStatusesFor = (s: AchStateSlice, mode: AchMode, cache?: AchTotalsCache | null): AchStatus[] =>
  achEvalFor(s, mode, cache).statuses;

/** 달성했는데 아직 다이아를 안 받은 업적 id — **반드시 `claimedAch` 필터 뒤**(눌러도 못 받는 점 방지). */
export const unclaimedAchIds = (s: AchStateSlice, mode: AchMode, cache?: AchTotalsCache | null): string[] =>
  unclaimedReward(achEvalFor(s, mode, cache).statuses, s.claimedAch ?? []).ids;
