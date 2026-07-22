import { coachInfoOf } from './league';
import { availableTeamPlayers } from './injury';
import { manualSideFor } from './dynamics';
import { restedOnDay, promotedOnDay } from './rotation';
import { simulateMatch } from '../engine/match';
import type { BoxSink } from '../engine/rally';
import type { SimResult, MatchIntervention } from '../engine/simMatch';
import type { Player } from '../types';

// 경기 박스스코어 단일 소스 — 관전 보드(match/[id])와 경기 상세(matchresult)가 **같은 기록**을 그리도록
// 명단 선택(부상·정지·벤치 + 휴식 #3 restedOnDay) + 시뮬 + 박스 싱크를 한곳에서 만든다.
// 두 화면이 이 함수만 호출 → squad·시드·감독·엔진이 동일 → 박스가 항상 일치(드리프트 차단).
// box(클론만, 승패 불변)와 boxTimeline(득점별 누적)을 함께 채운다 — 상세는 box, 관전은 boxTimeline.
export interface MatchBox {
  homeSquad: Player[];
  awaySquad: Player[];
  sim: SimResult;
  box: BoxSink;           // 최종 누적 박스(경기 상세·관전 종료)
  boxTimeline: BoxSink[]; // 득점별 누적 스냅샷(관전 실시간 스코어박스)
}

// interventions(§2.2): fixtureId를 아는 호출부(관전 보드·상세)는 interventionsFor(id)를 넘긴다. 모르는 호출부(샌드박스·도구)는
// 기본 [] → 바이트 동일. buildPlayoffBox(data/postseason)는 이 함수를 안 쓴다(별 경로 — 2단계 범위 밖).
// manualSide(§4.1): homeId/awayId/dayIndex로 내부 파생(standings·production 호출부와 동일 소스 = 정합) — 내 팀 정규시즌 경기 +
//   그날 "구단주 직접" 설정일 때만 사이드 반환. 샌드박스·도구는 myTeamId 미설정/설정로그 빈값이라 undefined = 미주입(바이트 동일).
export function buildMatchBox(homeId: string, awayId: string, dayIndex: number, seed: number, interventions: MatchIntervention[] = []): MatchBox {
  const homeRest = restedOnDay(homeId, dayIndex);
  const awayRest = restedOnDay(awayId, dayIndex);
  const homeSquad = homeRest.size ? availableTeamPlayers(homeId, dayIndex).filter((p) => !homeRest.has(p.id)) : availableTeamPlayers(homeId, dayIndex);
  const awaySquad = awayRest.size ? availableTeamPlayers(awayId, dayIndex).filter((p) => !awayRest.has(p.id)) : availableTeamPlayers(awayId, dayIndex);
  const homeForce = promotedOnDay(homeId, dayIndex); // 신인 등용(F) — 탈락 팀만 비어있지 않음(순위/생산과 동일 집합)
  const awayForce = promotedOnDay(awayId, dayIndex);
  const box: BoxSink = new Map();
  const boxTimeline: BoxSink[] = [];
  const sim = simulateMatch(seed, homeSquad, awaySquad, {
    home: coachInfoOf(homeId), away: coachInfoOf(awayId), box, boxTimeline, touches: true, // touches: 보드가 디그 마커를 박스 귀속자로 재생(2b)
    interventions,
    manualSide: manualSideFor(homeId, awayId, dayIndex), // 완전 수동 사이드(§4.1) — 정규시즌 내 팀+구단주 직접 설정만, 그 외 undefined = 바이트 동일
    homeForce, awayForce, // 신인 등용(F) — 선발 승격. 빈 셋이면 byte-동일
  });
  return { homeSquad, awaySquad, sim, box, boxTimeline };
}
