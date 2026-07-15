// 캘린더 날짜 유틸. dayIndex(시즌 시작 후 경과 일수) ↔ 실제 날짜 변환.
// KOVO 여자부 정규리그는 10월 중순 개막 → 이듬해 3월경. 시즌 시작 고정.
// SEASON_START_Y는 시즌 idx 0(2025-26)의 앵커 — data/seasonLabel.ts SEASON_BASE_YEAR와 동일.
// 시즌마다 개막 연도가 +1 전진하도록 dateForDay는 season(0-based 인덱스)을 받는다(UI_RULES UV-6).

export const SEASON_START_Y = 2025;
export const SEASON_START_M = 9; // 0-indexed = 10월
export const SEASON_START_D = 18;

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** dayIndex + season(0-based) → Date (명시 인자 생성, 결정론). 시즌마다 개막 연도 +1 전진. */
export function dateForDay(dayIndex: number, season: number): Date {
  return new Date(SEASON_START_Y + season, SEASON_START_M, SEASON_START_D + dayIndex);
}

/** 캘린더 셀 매칭용 날짜 키 */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function keyForDay(dayIndex: number, season: number): string {
  return dayKey(dateForDay(dayIndex, season));
}

/** 해당 월의 6주 그리드(앞뒤 달 칸 포함). 각 셀은 Date. */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const startWeekday = first.getDay(); // 0=일
  const gridStart = new Date(year, month, 1 - startWeekday);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    cells.push(new Date(year, month, 1 - startWeekday + i));
  }
  return cells;
}

export function formatMonth(year: number, month: number): string {
  return `${year}년 ${month + 1}월`;
}

export function formatDate(d: Date): string {
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}
