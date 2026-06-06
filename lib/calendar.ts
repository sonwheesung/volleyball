// 캘린더 날짜 유틸. dayIndex(시즌 시작 후 경과 일수) ↔ 실제 날짜 변환.
// KOVO 여자부 정규리그는 10월 중순 개막 → 이듬해 3월경. 시즌 시작 고정.

export const SEASON_START_Y = 2025;
export const SEASON_START_M = 9; // 0-indexed = 10월
export const SEASON_START_D = 18;

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** dayIndex → Date (명시 인자 생성, 결정론) */
export function dateForDay(dayIndex: number): Date {
  return new Date(SEASON_START_Y, SEASON_START_M, SEASON_START_D + dayIndex);
}

/** 캘린더 셀 매칭용 날짜 키 */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function keyForDay(dayIndex: number): string {
  return dayKey(dateForDay(dayIndex));
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
