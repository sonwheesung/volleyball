// 시즌 결산 "다음 시즌 숙제" 브리핑 산출 (SEASON_SYSTEM §5.5 ④) — 순수 셀렉터.
// 결산 화면(app/season-recap.tsx)과 상비 가드(tools/_dv_recap.ts)가 **동일 함수**를 써서
//   "예측(숙제) == 실제 오프시즌(buildOffseason)" 정합을 허위 오라클 없이 검증하게 한다(TEST_METHODOLOGY).
//
// 정본 일치(전수조사 2026-07-08): endSeason이 실제로 쓰는 명단·계약과 어긋나면 안 된다.
//   · 명단 = **시즌 중 이동 반영**(rosterIdsOnDay — 영입 포함·방출 제외). teamPlayerIds(base 시즌초 명단)는
//     시즌 중 재계약/방출/영입을 모르므로 금지(방출 선수 잔존·영입 선수 누락).
//   · 계약 = **contractOverrides 합성**(activeRoster). 시즌 중 3년 재계약한 선수는 base(잔여1)가 아니라
//     override(잔여3)로 판정 → willBeFA 오표시 방지(재계약했는데 🔥FA 자격으로 뜨는 버그).
//   · 진화 = evolveOnDay(로스터 밖 신규 영입도 진화) — getEvolvedTeamPlayers(로스터 바운드)는 영입 선수를 놓친다.
//   · 정년(39세=RETIRE_AGE−1) 확정자는 **정년 줄에만** — FA 자격 줄 중복 계상 금지("39세 정년만 확정 사실").

import type { Contract, Player } from '../types';
import { evolveOnDay } from './league';
import { rosterIdsOnDay } from './dynamics';
import { activeRoster } from './roster';
import { willBeFA } from '../engine/faMarket';
import { RETIRE_AGE } from '../engine/retire';

export interface RecapBriefing {
  faSoon: Player[];    // 🔥 다음 시즌 FA 자격 도래(정년 확정자 제외)
  expiring: Player[];  // ⚠ 계약 만료 임박(FA 예정 아닌 자만 — faSoon과 중복 제거)
  retireSoon: Player[]; // ℹ 정년 임박(현재 39세 → 이번 롤오버에 40세 도달, 은퇴 확정)
}

/**
 * 내 팀의 "다음 시즌 숙제" — day 시점 최종 명단(시즌 중 이동 반영) × contractOverrides 합성으로 산출.
 * @param day 표시 컷오프(결산은 시즌 종료라 SEASON_DAYS). rosterIdsOnDay/evolveOnDay가 이 날 기준 명단·진화를 준다.
 */
export function recapBriefing(
  myTeam: string,
  day: number,
  overrides: Record<string, Contract>,
  released: string[],
): RecapBriefing {
  // 명단: 시즌 중 영입 포함·방출 제외(rosterIdsOnDay) → 진화(로스터 밖 영입도 evolveOnDay) → 계약 override 합성
  const ids = rosterIdsOnDay(myTeam, day);
  const evolved = ids.map((id) => evolveOnDay(id, day)).filter((p): p is Player => !!p);
  const active = activeRoster(evolved, overrides, released);
  const atRetire = (p: Player) => p.age >= RETIRE_AGE - 1; // 정년(39세) — 이번 롤오버에 은퇴 확정
  return {
    faSoon: active.filter((p) => willBeFA(p) && !atRetire(p)), // 정년 확정자는 FA 줄에 안 넣음(정년 줄에만 — #2)
    expiring: active.filter((p) => !p.isForeign && p.contract.remaining <= 1 && !willBeFA(p) && !atRetire(p)),
    retireSoon: active.filter((p) => !p.isForeign && atRetire(p)),
  };
}
