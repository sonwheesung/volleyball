// 개인 생산 집계 — 전 구단, 전 경기를 결정론 재계산(경기일 OVR, 관전 결과와 일치).
// 전 경기 1회 계산 후 baseVersion 캐시. uptoDay 로 시점 집계.
// SOLID: 엔진 순수 함수(simMatch·production·overall)를 합성.

import type { Fixture } from '../types';
import { simulateMatch } from '../engine/match';
import { attributeProduction, mergeProd, splitLineup, type ProdLine } from '../engine/production';
import type { BoxSink } from '../engine/rally';
import { baseVersion, coachInfoOf, getEvolvedTeamPlayers, LEAGUE, SEASON } from './league';
import { availableTeamPlayers } from './injury';
import { currentTxVersion } from './dynamics';
import { restedOnDay } from './rotation';
import { minAffectedDaySince, spliceSeq } from './spliceLog';

export interface ProdRow {
  dayIndex: number;
  homeTeamId: string;
  awayTeamId: string;
  homeIds: Set<string>; // 홈팀 출전 명단 id(팀 귀속용)
  lines: Map<string, ProdLine>;
  starters: Set<string>; // 그 경기 선발(코트 위 7×2) id — 데뷔=첫 선발 판정용(가비지/서브 출전 제외)
}

/** 경기 1건의 선수별 생산 + 선발 명단(뉴스 실시간 소재: 트리플크라운·데뷔·커리어하이) */
export interface MatchProd {
  dayIndex: number;
  homeTeamId: string;
  awayTeamId: string;
  homeIds: Set<string>;
  lines: Map<string, ProdLine>;
  starters: Set<string>;
}

let cache: { key: string; rows: ProdRow[]; seq: number } | null = null;

// 캐시 영속(REALTIME_SIM Phase1) — 생산 결과를 세이브에 저장→복원해 재로드 시 재계산 제거(standings와 동일 패턴).
// seq(§7 스플라이스): 인메모리 계산시점 시퀀스(영속 안 함 — 복원 시 현재 seq 주입).
export const getProductionCacheRaw = (): { key: string; rows: ProdRow[]; seq: number } | null => cache;
export const setProductionCacheRaw = (c: { key: string; rows: ProdRow[]; seq?: number } | null): void => {
  cache = c ? { key: c.key, rows: c.rows, seq: c.seq ?? spliceSeq() } : null;
};

/** 전 경기 선수별 생산(결정론). baseVersion + 거래버전 단위 캐시 — 시즌 중 방출/영입 즉시 반영.
 *  스플라이스(REALTIME_SIM §7): dayIndex<minAffectedDay 행은 재사용, 이후만 재시뮬. 생산은 러닝 상태를
 *  자체로 안 나르고 restedOnDay(→순위 캐시)에 의존하므로 순위 스플라이스가 byte-동일하면 재시뮬 구간도 올바른 휴식을 본다. */
function allProdRows(): ProdRow[] {
  const key = `${baseVersion()}:${currentTxVersion()}`;
  if (cache && cache.key === key) return cache.rows;

  const prev = cache;
  const minDay = prev ? minAffectedDaySince(prev.seq) : Infinity;
  const splice = !!prev && minDay > 0 && Number.isFinite(minDay);
  const reuse: ProdRow[] = splice ? prev!.rows.filter((r) => r.dayIndex < minDay) : [];

  const byDay = new Map<number, Fixture[]>();
  for (const f of SEASON) {
    if (splice && f.dayIndex < minDay) continue; // 재사용 구간 — 시뮬 생략
    const arr = byDay.get(f.dayIndex) ?? [];
    arr.push(f);
    byDay.set(f.dayIndex, arr);
  }

  const rows: ProdRow[] = [...reuse]; // 재사용 행(dayIndex<minDay, day-정렬) 뒤에 재시뮬 행을 이어 붙임 → 전체 경로와 동일 순서
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    const roster: Record<string, ReturnType<typeof getEvolvedTeamPlayers>> = {};
    for (const t of LEAGUE.teams) {
      const avail = availableTeamPlayers(t.id, day); // 부상자 제외 명단(백업 출전)
      const rest = restedOnDay(t.id, day); // 로드매니지먼트(#3) — 순위 굳으면 주전 휴식(순위 재시뮬과 동일 집합)
      roster[t.id] = rest.size ? avail.filter((p) => !rest.has(p.id)) : avail;
    }
    for (const f of byDay.get(day)!) {
      // 통계 단일화(2026-06-24): 스코어박스(box)를 통산 생산의 단일 진실로 — 관전 보드가 그린 기록이
      // 그대로 통산/시즌/시상/연봉에 쌓인다(SALARY_SYSTEM 1.3). box는 승패 불변(클론 누적만).
      const box: BoxSink = new Map();
      const sim = simulateMatch(f.seed, roster[f.homeTeamId], roster[f.awayTeamId], {
        home: coachInfoOf(f.homeTeamId, f.dayIndex), away: coachInfoOf(f.awayTeamId, f.dayIndex), box, // 축3: 그날의 감독
      });
      const lines = attributeProduction(sim, roster[f.homeTeamId], roster[f.awayTeamId], f.seed, box);
      const starters = new Set<string>([
        ...splitLineup(roster[f.homeTeamId]).starters.map((p) => p.id),
        ...splitLineup(roster[f.awayTeamId]).starters.map((p) => p.id),
      ]);
      const homeIds = new Set<string>(roster[f.homeTeamId].map((p) => p.id));
      rows.push({ dayIndex: f.dayIndex, homeTeamId: f.homeTeamId, awayTeamId: f.awayTeamId, homeIds, lines, starters });
    }
  }
  cache = { key, rows, seq: spliceSeq() };
  return rows;
}

/** uptoDay 까지 선수별 누적 생산 */
export function leagueProduction(uptoDay: number): Map<string, ProdLine> {
  return leagueProductionRange(0, uptoDay);
}

/** [fromDay, toDay] 구간 선수별 생산(양끝 포함) — 라운드 MVP 등 구간 집계용 */
export function leagueProductionRange(fromDay: number, toDay: number): Map<string, ProdLine> {
  const out = new Map<string, ProdLine>();
  // 빈 구간 가드(2026-06-28) — 집계할 경기가 하나도 없으면 allProdRows()(전 경기 시드 재생, 콜드 ~3s·폰 15s)를
  // 부르지 않고 즉시 빈 결과. 핵심 케이스: 구단 선택/시즌 시작 전 leagueDisplayDay(0)=−1 → range[0,−1]은
  // toDay<fromDay라 경기 0개인데 옛 코드는 전 시즌을 시뮬했다(선수 화면 진입 15s의 원인).
  if (toDay < fromDay) return out;
  let hasFixture = false;
  for (const f of SEASON) { if (f.dayIndex >= fromDay && f.dayIndex <= toDay) { hasFixture = true; break; } }
  if (!hasFixture) return out;
  for (const r of allProdRows()) {
    if (r.dayIndex < fromDay || r.dayIndex > toDay) continue;
    for (const [id, l] of r.lines) out.set(id, mergeProd(out.get(id), l));
  }
  return out;
}

export const getPlayerProduction = (id: string, uptoDay: number): ProdLine | undefined =>
  leagueProduction(uptoDay).get(id);

/** uptoDay 까지 치러진 경기별 생산 + 선발 명단(경기일 오름차순). 뉴스 실시간 소재용. */
export function seasonMatchProds(uptoDay: number): MatchProd[] {
  // 빈 구간 가드(2026-07-08, leagueProductionRange 선례) — day0 오프시즌 뉴스 피드가 seasonMatchProds(-1)를
  // 부르면 옛 코드는 allProdRows()(전 시즌 시드 재생, 콜드 265~544ms)를 돌려 **빈 결과**를 냈다.
  // 경기일(dayIndex)은 항상 ≥0이라 uptoDay<0이면 치른 경기 0 → 시뮬 없이 즉시 빈 배열.
  if (uptoDay < 0) return [];
  return allProdRows()
    .filter((r) => r.dayIndex <= uptoDay)
    .map((r) => ({ dayIndex: r.dayIndex, homeTeamId: r.homeTeamId, awayTeamId: r.awayTeamId, homeIds: r.homeIds, lines: r.lines, starters: r.starters }));
}
