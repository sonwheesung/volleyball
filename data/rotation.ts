// 로드 매니지먼트 (ROTATION_MORALE #3) — 순위가 굳으면(확정/탈락) 감독이 주전을 일부 경기 쉬게 한다.
//   결정론: 휴식은 "그 경기일 직전(day−1)까지의 실제 순위"로 판정(인과적 — 자기 결과 안 봄, 순환 없음).
//   생산(allProdRows)·관전 보드가 restedOnDay()를, 순위 재시뮬(allResults)은 같은 pickRest를 러닝 순위로 호출 →
//   세 경로가 동일 휴식 집합 → 관전==순위==생산 일치 유지. pickRest는 engine/lineup(순수).
import { pickRest } from '../engine/lineup';
import { availableTeamPlayers } from './injury';
import { teamClinch } from './clinch';

/** day일 teamId가 쉬게 할 선수 — 순위가 굳었을(확정/탈락) 때만. day−1까지의 순위 기준(인과적·비순환).
 *  생산(allProdRows)·관전 보드가 사용. (순위 재시뮬 allResults는 러닝 순위로 같은 pickRest를 직접 호출) */
export function restedOnDay(teamId: string, day: number): Set<string> {
  const c = teamClinch(teamId, day - 1);
  if (!c || (c.state !== 'clinched' && c.state !== 'eliminated')) return new Set();
  return pickRest(availableTeamPlayers(teamId, day), teamId, day);
}
