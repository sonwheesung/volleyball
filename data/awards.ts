// 시상식 셀렉터 (AWARDS_SYSTEM). 엔진(computeSeasonAwards)에 줄 입력을 리그 상태에서 조립.
// "프리뷰 = 결과": store.endSeason 이 롤오버 직전 이 함수를 호출해 archive 에 박는다.

import type { SeasonAwards } from '../types';
import { computeSeasonAwards } from '../engine/awards';
import { overall } from '../engine/overall';
import { LEAGUE, SEASON, getPlayer, getEvolvedTeamPlayers, currentRosters } from './league';
import { leagueProduction, leagueProductionRange } from './production';
import { computeStandings } from './standings';
import { buildPlayoffs } from './playoffs';

const REF_DAY = 164; // 시즌 종료 전력(playoffs 와 동일)
const LEGS = 6;      // KOVO 여자부 6라운드

/** 라운드(leg)별 [from, to] 일자 구간 — SEASON 의 round 구조에서 도출 */
export function seasonLegRanges(): { from: number; to: number }[] {
  const rounds = [...new Set(SEASON.map((f) => f.round))].sort((a, b) => a - b);
  const total = rounds.length;
  if (total === 0) return [];
  const rpl = Math.max(1, Math.round(total / LEGS));
  const legs: { from: number; to: number }[] = [];
  for (let leg = 0; leg < LEGS; leg++) {
    const lo = leg * rpl;
    const hi = leg === LEGS - 1 ? total : (leg + 1) * rpl;
    const days = SEASON.filter((f) => f.round >= lo && f.round < hi).map((f) => f.dayIndex);
    if (!days.length) continue;
    legs.push({ from: Math.min(...days), to: Math.max(...days) });
  }
  return legs;
}

/** 선수 → 현재 소속팀 맵 */
function rosterTeamMap(): Map<string, string> {
  const m = new Map<string, string>();
  const rs = currentRosters();
  for (const tid of Object.keys(rs)) for (const id of rs[tid]) m.set(id, tid);
  return m;
}

/** 시즌 OVR 델타(시즌 시작 base → day 시점 진화) — 기량발전상용 */
function improvementMap(day: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of LEAGUE.teams) {
    for (const p of getEvolvedTeamPlayers(t.id, day)) {
      const base = getPlayer(p.id);
      if (base) out.set(p.id, overall(p) - overall(base));
    }
  }
  return out;
}

/**
 * 시즌 시상 결과. season = 0-based 시즌 번호.
 * uptoDay = 집계 기준일(기본 = 시즌 전체). history 탭은 currentDay 를 넘겨 "현재까지" 표시,
 * store.endSeason 은 전체(MAX)로 계산해 archive 에 박는다. 챔프전 MVP 는 시즌 종료 후에만.
 */
export function currentSeasonAwards(season: number, uptoDay: number = Number.MAX_SAFE_INTEGER): SeasonAwards {
  const teamMap = rosterTeamMap();
  const standings = computeStandings(uptoDay);
  const teamRank = new Map<string, number>();
  standings.forEach((s, i) => teamRank.set(s.teamId, i));

  const rookies = new Set<string>();
  for (const id of teamMap.keys()) if (getPlayer(id)?.career.seasons === 0) rookies.add(id);

  const legProd = seasonLegRanges()
    .filter((r) => r.from <= uptoDay)
    .map((r) => leagueProductionRange(r.from, Math.min(r.to, uptoDay)));

  const seasonDone = uptoDay >= REF_DAY;

  return computeSeasonAwards({
    prod: leagueProduction(uptoDay),
    player: getPlayer,
    teamOf: (id) => teamMap.get(id),
    teamRank,
    teamCount: standings.length,
    rookies,
    improvement: improvementMap(Math.min(uptoDay, REF_DAY)),
    championId: seasonDone ? buildPlayoffs(season).championId : null,
    legProd,
  });
}

// ─── 선수 수상 이력 (선수 상세 화면) ───────────────────────────

export interface AwardHistoryItem { season: number; label: string }

const TITLE_KO: Record<string, string> = {
  scoring: '득점왕', spike: '공격상', block: '블로킹왕',
  serve: '서브왕', dig: '디그왕', set: '세트왕', receive: '리시브왕',
};

/** archive(영구 보존된 시즌별 시상)를 선수 기준으로 훑어 수상 연표를 만든다. 순수 함수(store 무의존). */
export function awardHistoryOf(
  archive: { season: number; awards?: SeasonAwards }[],
  playerId: string,
): AwardHistoryItem[] {
  const out: AwardHistoryItem[] = [];
  for (const a of archive) {
    const w = a.awards;
    if (!w) continue;
    if (w.mvp?.playerId === playerId) out.push({ season: a.season, label: '정규리그 MVP' });
    if (w.finalsMvp?.playerId === playerId) out.push({ season: a.season, label: '챔프전 MVP' });
    if (w.rookie?.playerId === playerId) out.push({ season: a.season, label: '신인상' });
    if (w.mostImproved?.playerId === playerId) out.push({ season: a.season, label: '기량발전상' });
    for (const [k, t] of Object.entries(w.titles)) {
      if (t?.playerId === playerId) out.push({ season: a.season, label: TITLE_KO[k] ?? k });
    }
    if (w.best7.some((b) => b.winner?.playerId === playerId)) out.push({ season: a.season, label: '베스트7' });
    const rounds = w.roundMvps.filter((m) => m?.playerId === playerId).length;
    if (rounds > 0) out.push({ season: a.season, label: `라운드 MVP ${rounds}회` });
  }
  return out.sort((x, y) => y.season - x.season);
}
