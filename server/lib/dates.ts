// 날짜 정규화 공용 헬퍼 (BACKEND_SYSTEM §13.14·§13.15) — endsAt date-only KST 함정 방지.
// 공지·쿠폰 등 운영자 입력 endsAt은 date-only('YYYY-MM-DD')로 들어오는데, new Date('YYYY-MM-DD')는
// UTC 자정 = KST 오전 9시라 운영자 기대(그날 밤까지)보다 9시간 일찍 만료된다. 그날 KST 23:59:59.999
// (= 해당일 UTC T14:59:59.999Z)로 정규화한다. 시각을 포함한 ISO 전체 문자열은 그대로 파싱(무변).
export function normalizeEndsAt(raw: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T14:59:59.999Z`);
  return new Date(raw);
}
