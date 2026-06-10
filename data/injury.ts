// 부상 셀렉터 — 이제 시즌 다이내믹스(부상+이동 통합 forward-pass)에서 재노출.
// 기존 import 경로 호환(production·standings·playoffs·store·UI·tools).
// 실제 로직: data/dynamics.ts.

export {
  availableTeamPlayers,
  injuredOnDay,
  teamInjuriesOn,
  seasonInjuryReport,
  seasonInjuryDays,
  rosterIdsOnDay,
  type InjurySpan,
} from './dynamics';
