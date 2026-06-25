// 시즌 캘린더 상수 — 정규시즌 마지막 day 인덱스(= 출전비율·노쇠·팬심·시즌말 평가 기준일). 단일 출처(leaf, 무의존).
// 여러 모듈(rollover·owner·store·finance·awards·playoffs)이 손으로 164를 각자 적던 것을 통합 —
// EDGE_CASES §3.7 "상수 손복제(constant re-listing)" 드리프트 클래스. 실제 일정(data/league SEASON)의
// max dayIndex와 일치해야 하며, tools/_dv_seasondays.ts가 이를 가드(불일치 시 FAIL).
export const SEASON_DAYS = 164;
