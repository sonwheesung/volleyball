// 포스트시즌 달력 편입 — 진행/스포일러/보드재생의 단일 진실 (SEASON_SYSTEM §5, 2026-07-08).
// ★ 신규 영속 필드 0 — "치른 플옵 경기"는 오직 currentDay + buildPlayoffs(결정론)에서 파생한다(results에 안 씀).
//   포스트시즌 전용 컷오프 트랙: displayCutoff(정규, SEASON_DAYS 승격)와 별개로 "currentDay가 도달한 플옵 슬롯까지만" 공개.
//
// 동결 규칙(사실화): 진화 조회는 전역 min(day, SEASON_DAYS) 클램프(availableTeamPlayers(id, REF_DAY)) —
//   "포스트시즌 엔트리·훈련은 정규 종료 시점 확정". 플옵 기간 훈련/노쇠/부상복귀 시제 워트 없음.
//
// 보드 재생 = playSeries 바이트 공유(최대 급소): buildPlayoffBox가 REF_DAY(164) 동결 스쿼드 + HI_EDGE + 게임 시드(base+g*1009)로
//   playSeries와 동일 입력을 만든다 → 점수판(series.games[g])과 보드 재생 세트 스코어가 항상 일치(_dv_playoffs 가드가 증명).

import { coachInfoOf } from './league';
import { availableTeamPlayers } from './injury';
import {
  buildPlayoffs, REF_DAY, PO_TARGET, FINAL_TARGET, poSeedBase, finalSeedBase,
  type Playoffs, type Matchup,
} from './playoffs';
import { simulateMatch } from '../engine/match';
import { HI_EDGE } from '../engine/playoffs';
import { PO_SLOTS, FINAL_SLOTS, POSTSEASON_LAST_DAY } from '../engine/calendar';
import type { BoxSink } from '../engine/rally';
import type { SimResult } from '../engine/simMatch';
import type { Player } from '../types';

export type PoRound = 'po' | 'final';

/** currentDay가 정규 종료(SEASON_DAYS=164)를 넘어 포스트시즌 구간에 있는가 */
export function inPostseason(currentDay: number): boolean {
  return currentDay > REF_DAY && currentDay <= POSTSEASON_LAST_DAY;
}

/** 한 시리즈에서 currentDay 기준 "치른(공개) 게임 수" — 실제 게임 수와 슬롯 도달을 함께 만족.
 *  slots[g] <= currentDay 인 g만 공개(내 미관전 미래 게임 누수 0 — 보드 경유 후에만 currentDay가 그 슬롯에 도달). */
function revealedGames(m: Matchup | null, slots: readonly number[], currentDay: number): number {
  if (!m) return 0;
  const played = m.series.games.length;
  let n = 0;
  for (let g = 0; g < played; g++) if (currentDay >= slots[g]) n++; else break;
  return n;
}

export interface PostseasonReveal {
  poRevealed: number;      // 공개된 준PO 게임 수(0..po.games.length)
  finalRevealed: number;   // 공개된 결승 게임 수
  poDone: boolean;         // 준PO 전 게임 공개(승자 확정 노출 가능)
  finalDone: boolean;      // 결승 전 게임 공개
  championRevealed: boolean; // 우승 확정 노출 가능(= 결승 마지막 게임 슬롯 도달) → recordChampion 게이트
}

/** currentDay에서 파생한 공개 상태(스포일러 컷오프 트랙). buildPlayoffs는 결정론이라 내부 계산만, 노출은 이 함수로 클립. */
export function postseasonReveal(p: Playoffs, currentDay: number): PostseasonReveal {
  const poRevealed = revealedGames(p.po, PO_SLOTS, currentDay);
  const finalRevealed = revealedGames(p.final, FINAL_SLOTS, currentDay);
  const poDone = !!p.po && poRevealed === p.po.series.games.length;
  const finalDone = !!p.final && finalRevealed === p.final.series.games.length;
  // 우승 노출 = 결승 전 게임 공개(결승 없으면 — 진출 3팀 미만 — po 승자/시드1을 champion으로 즉시).
  const championRevealed = p.final ? finalDone : true;
  return { poRevealed, finalRevealed, poDone, finalDone, championRevealed };
}

/** 스포일러 안전 챔피언 id — 결승이 전부 공개된 뒤에만 실제 챔피언, 그 전엔 null. recordChampion/우승기사/finalsMvp 게이트 공용. */
export function revealedChampionId(p: Playoffs, currentDay: number): string | null {
  return postseasonReveal(p, currentDay).championRevealed ? p.championId : null;
}

// ── 진행(schedule) — "다음 플옵 경기일로 점프" ────────────────────────────────
// 각 게임에 달력 슬롯 day를 매핑. 시리즈 조기 종료로 없는 g는 스킵. 마지막 게임 뒤 → done(오프시즌 진입).
export interface PoGameSlot {
  round: PoRound;
  g: number;          // 시리즈 내 게임 인덱스(0-based)
  day: number;        // 달력 슬롯 day
  hiId: string;
  loId: string;
  mine: boolean;      // 내 팀 경기 = 보드 경유 강제(정규와 동일)
}

/** 이번 포스트시즌의 전 게임 슬롯을 시간순으로 나열(존재하는 게임만). */
export function postseasonSchedule(p: Playoffs, myTeamId: string | null): PoGameSlot[] {
  const out: PoGameSlot[] = [];
  const push = (m: Matchup | null, round: PoRound, slots: readonly number[]) => {
    if (!m) return;
    for (let g = 0; g < m.series.games.length; g++) {
      const day = slots[g];
      if (day == null) continue;
      out.push({ round, g, day, hiId: m.hiId, loId: m.loId, mine: !!myTeamId && (m.hiId === myTeamId || m.loId === myTeamId) });
    }
  };
  push(p.po, 'po', PO_SLOTS);
  push(p.final, 'final', FINAL_SLOTS);
  return out;
}

/** currentDay 기준 다음(미공개) 플옵 게임 슬롯 — 없으면 null(포스트시즌 종료 → 세리머니/오프시즌). */
export function nextPoGame(p: Playoffs, currentDay: number, myTeamId: string | null): PoGameSlot | null {
  for (const s of postseasonSchedule(p, myTeamId)) if (s.day > currentDay) return s;
  return null;
}

// ── 보드 재생 전용 박스 빌더(playSeries 바이트 공유) ────────────────────────────
// 일반 buildMatchBox(dayIndex 기반 restedOnDay·부상)를 쓰면 점수판과 다른 경기가 재생된다(금지). 이 함수는
// playSeries의 게임 g 호출과 동일한 입력(164 동결 스쿼드·HI_EDGE·hi=홈·base+g*1009 시드·rest 미적용)을 만든다.
export interface PlayoffBox {
  homeSquad: Player[]; // = hi(상위 시드, 홈)
  awaySquad: Player[]; // = lo
  sim: SimResult;
  box: BoxSink;
  boxTimeline: BoxSink[];
}

/** 시리즈 게임 g의 보드 재생 입력. hi=홈. 반환 sim.homeSets/awaySets == series.games[g].hiSets/loSets(가드 증명). */
export function buildPlayoffBox(season: number, round: PoRound, g: number, p?: Playoffs): PlayoffBox {
  const pp = p ?? buildPlayoffs(season);
  const m = round === 'po' ? pp.po : pp.final;
  if (!m) throw new Error(`buildPlayoffBox: ${round} 시리즈 없음`);
  const seedBase = round === 'po' ? poSeedBase(season) : finalSeedBase(season);
  const homeSquad = availableTeamPlayers(m.hiId, REF_DAY); // 164 동결(playSeries sq와 동일 소스)
  const awaySquad = availableTeamPlayers(m.loId, REF_DAY);
  const box: BoxSink = new Map();
  const boxTimeline: BoxSink[] = [];
  const sim = simulateMatch(seedBase + g * 1009, homeSquad, awaySquad, {
    edge: { home: HI_EDGE, away: 1 }, // playSeries와 동일(상위시드 홈 어드밴티지)
    home: coachInfoOf(m.hiId), away: coachInfoOf(m.loId),
    box, boxTimeline, touches: true, // sink/터치는 결정론 점수에 무영향(buildMatchBox 선례)
  });
  return { homeSquad, awaySquad, sim, box, boxTimeline };
}

export { PO_TARGET, FINAL_TARGET, POSTSEASON_LAST_DAY };
