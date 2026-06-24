import { coachInfoOf } from './league';
import { availableTeamPlayers } from './injury';
import { restedOnDay } from './rotation';
import { simulateMatch } from '../engine/match';
import type { BoxSink } from '../engine/rally';
import type { SimResult } from '../engine/simMatch';
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

export function buildMatchBox(homeId: string, awayId: string, dayIndex: number, seed: number): MatchBox {
  const homeRest = restedOnDay(homeId, dayIndex);
  const awayRest = restedOnDay(awayId, dayIndex);
  const homeSquad = homeRest.size ? availableTeamPlayers(homeId, dayIndex).filter((p) => !homeRest.has(p.id)) : availableTeamPlayers(homeId, dayIndex);
  const awaySquad = awayRest.size ? availableTeamPlayers(awayId, dayIndex).filter((p) => !awayRest.has(p.id)) : availableTeamPlayers(awayId, dayIndex);
  const box: BoxSink = new Map();
  const boxTimeline: BoxSink[] = [];
  const sim = simulateMatch(seed, homeSquad, awaySquad, {
    home: coachInfoOf(homeId), away: coachInfoOf(awayId), box, boxTimeline, touches: true, // touches: 보드가 디그 마커를 박스 귀속자로 재생(2b)
  });
  return { homeSquad, awaySquad, sim, box, boxTimeline };
}
