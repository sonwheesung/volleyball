// 시즌 캘린더 상수 — 정규시즌 마지막 day 인덱스(= 출전비율·노쇠·팬심·시즌말 평가 기준일). 단일 출처(leaf, 무의존).
// 여러 모듈(rollover·owner·store·finance·awards·playoffs)이 손으로 164를 각자 적던 것을 통합 —
// EDGE_CASES §3.7 "상수 손복제(constant re-listing)" 드리프트 클래스. 실제 일정(data/league SEASON)의
// max dayIndex와 일치해야 하며, tools/_dv_seasondays.ts가 이를 가드(불일치 시 FAIL).
export const SEASON_DAYS = 164;

// ── 포스트시즌 달력 편입 (SEASON_SYSTEM §5, 2026-07-08) ────────────────────────────────
// 정규 종료(164) 뒤 고정 슬롯 격일 배치 — currentDay가 164를 넘어 흐른다. 시리즈 조기 종료 시
// 남은 슬롯은 자연 소멸(진행이 다음 라운드/오프시즌으로 점프). 이 상수는 "치른 플옵 경기"를
// currentDay에서 파생(신규 영속 0)하는 단일 출처 — data/postseason.ts가 소비, _dv_postseason이 가드.
//   휴식 2일(165·166) → 준PO 1·2·3차전(167·169·171 격일) → 휴식(172~174) → 결승 1~5차전(175·177·179·181·183 격일).
export const PO_SLOTS = [167, 169, 171] as const;              // 준PO 3전2선승 — 최대 3게임
export const FINAL_SLOTS = [175, 177, 179, 181, 183] as const; // 챔프전 5전3선승 — 최대 5게임
export const POSTSEASON_LAST_DAY = FINAL_SLOTS[FINAL_SLOTS.length - 1]; // 183 — 시즌 전체(정규+포스트) 마지막 day

/** 라운드별 게임 인덱스 g(0-based) → 달력 day. 존재하지 않는 g(시리즈 조기 종료)는 undefined. */
export function poSlotDay(g: number): number | undefined { return PO_SLOTS[g]; }
export function finalSlotDay(g: number): number | undefined { return FINAL_SLOTS[g]; }
