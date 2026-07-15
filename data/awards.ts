// 시상식 셀렉터 (AWARDS_SYSTEM). 엔진(computeSeasonAwards)에 줄 입력을 리그 상태에서 조립.
// "프리뷰 = 결과": store.endSeason 이 롤오버 직전 이 함수를 호출해 archive 에 박는다.

import type { SeasonAwards } from '../types';
import { computeSeasonAwards } from '../engine/awards';
import { overall } from '../engine/overall';
import { LEAGUE, SEASON, getPlayer, getEvolvedTeamPlayers, currentRosters } from './league';
import { leagueProduction, leagueProductionRange } from './production';
import { computeStandings } from './standings';
import { buildPlayoffs } from './playoffs';
import { revealedChampionId } from './postseason';
import { SEASON_DAYS } from '../engine/calendar';
import { legRanges } from '../engine/season';

const REF_DAY = SEASON_DAYS; // 시즌 종료 전력(playoffs 와 동일) — 단일 출처(engine/calendar)

/** 라운드(leg)별 [from, to] 일자 구간 — SEASON 의 round 구조에서 도출(공용 legRanges) */
export function seasonLegRanges(): { from: number; to: number }[] {
  return legRanges(SEASON);
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
 *
 * poDay(2026-07-08 포스트시즌 달력 편입) = 우승/챔프MVP **공개 게이트**용 raw currentDay(기본 = uptoDay).
 *   챔프MVP(finalsMvp)·championId는 우승팀 소속 = 우승 스포일러다. displayCutoff는 시즌완료 시 SEASON_DAYS(164)로
 *   승격돼 championId를 새므로, 포스트시즌 컷오프 트랙(revealedChampionId)으로 **결승 전 게임 공개 후에만** 산출한다.
 *   호출측이 clamped cutoff(uptoDay=164)만 넘기면 결승 전엔 자동 은폐(안전 기본) — 결승 종료 후 노출하려면 raw currentDay를 poDay로 전달.
 */
export function currentSeasonAwards(season: number, uptoDay: number = Number.MAX_SAFE_INTEGER, poDay: number = uptoDay): SeasonAwards {
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
    // 우승/챔프MVP 스포일러 게이트(§5) — 결승 전 게임 공개(poDay가 결승 마지막 슬롯 도달) 후에만. 그 전엔 null.
    championId: seasonDone ? revealedChampionId(buildPlayoffs(season), poDay) : null,
    legProd,
  });
}

// ─── 선수 수상 이력 (선수 상세 화면) ───────────────────────────

export interface AwardHistoryItem { season: number; label: string }

/**
 * 부문 기록상 7종: 부문 키 → 사용자 노출 라벨. **전 화면 단일 출처**(복붙 드리프트 방지 — UI-3).
 * 라벨 = KOVO 기준 "~상" 계열(사용자 결정 2026-07-15 — "~왕"은 언론 표현, 정식 부문상은 "~상"). AWARDS_SYSTEM §1.
 * ⚠ 표시 전용 파생 — archive에 저장되는 건 `AwardWinner`(playerId/teamId/value)뿐, 이 라벨 문자열은 저장 안 됨.
 *   따라서 라벨을 바꿔도 과거 세이브와 갈라지지 않는다(마이그레이션 불필요).
 */
export const TITLE_LABELS: Record<string, string> = {
  scoring: '득점상', spike: '공격상', block: '블로킹상',
  serve: '서브상', dig: '디그상', set: '세트상', receive: '리시브상',
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
      if (t?.playerId === playerId) out.push({ season: a.season, label: TITLE_LABELS[k] ?? k });
    }
    if (w.best7.some((b) => b.winner?.playerId === playerId)) out.push({ season: a.season, label: '베스트7' });
    const rounds = w.roundMvps.filter((m) => m?.playerId === playerId).length;
    if (rounds > 0) out.push({ season: a.season, label: `라운드 MVP ${rounds}회` });
  }
  return out.sort((x, y) => y.season - x.season);
}
