// 통산 기록 셀렉터 (역사 화면 — 현역 + 은퇴 통합 리더보드, 시즌 스냅샷).
// SOLID: 순수 셀렉터. 현역은 data/league 로스터에서, 은퇴는 store.hallOfFame 을 인자로 받는다
//        (awardHistoryOf 와 동일 패턴 — store 무의존). 시즌 스냅샷은 archive(과거)/라이브(현재)를 합성.

import type { HofEntry, Position, SeasonArchive, SeasonAwards } from '../types';
import { currentRosters, getPlayer } from './league';
import { currentSeasonAwards } from './awards';
import { computeStandings } from './standings';

// ─── 통산 리더보드 (현역 + 은퇴) ───────────────────────────────
// CareerStats 누적 6종 — HOF 는 spikes/aces/assists 가 구세이브에서 없을 수 있어 ?? 0.
export type RecordCat = 'points' | 'spikes' | 'blocks' | 'aces' | 'digs' | 'assists';

export const RECORD_CATS: { key: RecordCat; label: string; short: string; unit: string }[] = [
  { key: 'points', label: '통산 득점', short: '득점', unit: '점' },
  { key: 'spikes', label: '통산 공격', short: '공격', unit: '개' },
  { key: 'blocks', label: '통산 블로킹', short: '블로킹', unit: '개' },
  { key: 'aces', label: '통산 서브', short: '서브', unit: '개' },
  { key: 'digs', label: '통산 디그', short: '디그', unit: '개' },
  { key: 'assists', label: '통산 도움(세트)', short: '도움', unit: '개' },
];

export interface CareerRow {
  id: string;
  name: string;
  position: Position;
  teamId: string;     // 현역=현 소속, 은퇴=마지막(영구결번) 소속
  value: number;
  seasons: number;
  retired: boolean;
  legend: boolean;    // 영구결번급(은퇴 한정)
}

/** 전 현역 선수 한 명씩(중복 없음) */
function activePlayers(): { id: string; teamId: string }[] {
  const out: { id: string; teamId: string }[] = [];
  const rs = currentRosters();
  for (const tid of Object.keys(rs)) for (const id of rs[tid]) out.push({ id, teamId: tid });
  return out;
}

/** 통산 리더보드 — 현역+은퇴 통합, 값>0, 내림차순(동률 시 시즌 수→이름). 호출부가 TOP N 슬라이스. */
export function careerLeaderboard(cat: RecordCat, hof: HofEntry[]): CareerRow[] {
  const rows: CareerRow[] = [];
  for (const { id, teamId } of activePlayers()) {
    const p = getPlayer(id);
    if (!p) continue;
    rows.push({
      id, name: p.name, position: p.position, teamId,
      value: p.career[cat], seasons: p.career.seasons, retired: false, legend: false,
    });
  }
  for (const h of hof) {
    rows.push({
      id: h.id, name: h.name, position: h.position, teamId: h.teamId,
      value: h[cat] ?? 0, seasons: h.seasons, retired: true, legend: h.legend,
    });
  }
  return rows
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value || b.seasons - a.seasons || a.name.localeCompare(b.name));
}

/** 구단별 통산 리더보드 — teamId(현 소속 또는 마지막 소속) 기준 필터 */
export function teamCareerLeaderboard(cat: RecordCat, teamId: string, hof: HofEntry[]): CareerRow[] {
  return careerLeaderboard(cat, hof).filter((r) => r.teamId === teamId);
}

// ─── 시즌 스냅샷 (시즌별 이동) ─────────────────────────────────
export interface SeasonStandingRow { teamId: string; wins: number; losses: number }

export interface SeasonSnapshot {
  season: number;          // 0-based
  isCurrent: boolean;      // 진행 중(라이브 집계)
  championId: string | null;
  awards: SeasonAwards | null;
  standings: SeasonStandingRow[];  // 1위 → 꼴찌
}

/**
 * 특정 시즌의 스냅샷. 과거 시즌은 archive(영구 보존)에서, 현재 진행 시즌은 라이브 재계산에서.
 * 과거 시즌의 선수 단위 리더보드는 보존되지 않음(리그가 매 시즌 리롤) — 시상(수상자=그 시즌 1위)으로 대체.
 */
export function seasonSnapshot(
  season: number, currentSeason: number, currentDay: number, archive: SeasonArchive[],
): SeasonSnapshot {
  if (season >= currentSeason) {
    // 현재(진행 중) 시즌 — 라이브
    const st = computeStandings(currentDay);
    return {
      season, isCurrent: true, championId: null,
      awards: currentSeasonAwards(season, currentDay),
      standings: st.map((s) => ({ teamId: s.teamId, wins: s.wins, losses: s.losses })),
    };
  }
  const a = archive.find((x) => x.season === season);
  const order = a?.standings ?? [];
  const rec = a?.record ?? {};
  return {
    season, isCurrent: false, championId: a?.championId ?? null,
    awards: a?.awards ?? null,
    standings: order.map((tid) => ({ teamId: tid, wins: rec[tid]?.[0] ?? 0, losses: rec[tid]?.[1] ?? 0 })),
  };
}
