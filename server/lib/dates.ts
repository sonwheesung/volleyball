// 날짜 정규화 공용 헬퍼 (BACKEND_SYSTEM §13.14·§13.15) — endsAt date-only KST 함정 방지.
// 공지·쿠폰 등 운영자 입력 endsAt은 date-only('YYYY-MM-DD')로 들어오는데, new Date('YYYY-MM-DD')는
// UTC 자정 = KST 오전 9시라 운영자 기대(그날 밤까지)보다 9시간 일찍 만료된다. 그날 KST 23:59:59.999
// (= 해당일 UTC T14:59:59.999Z)로 정규화한다. 시각을 포함한 ISO 전체 문자열은 그대로 파싱(무변).
export function normalizeEndsAt(raw: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T14:59:59.999Z`);
  return new Date(raw);
}

// ── 다이아 패스 KST 리셋보정 날짜·월귀속(DIAMOND_PASS_SYSTEM §2.1·§3.1) ──
// 서버 시각만 사용(클라 시계 절대 미사용 — §13.12 "재화는 서버 진실"). 엔진/시드 무접근(서버 라우트 런타임 한정).
const KST_OFFSET_MIN = 9 * 60; // KST = UTC+9

/** 리셋보정 오늘(KST) 날짜 'YYYY-MM-DD' — dayIndex·start·발송 판정 기준(Q6 리셋 KST 00:00 자정, 재확정 2026-07-23).
 *  KST 벽시계에서 resetHour를 뺀 날짜 = [00:00, resetHour) 시간대는 전날에 귀속. resetHour=0(현행)이면 곧 KST 캘린더 날짜.
 *  구현: now(UTC) + (9 - resetHour)h 의 UTC 날짜(오프셋을 타임스탬프에 접어넣음). resetHour=0 → now+9h(=KST)의 날짜. */
export function todayKstResetAdjusted(resetHour: number, now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + (KST_OFFSET_MIN - resetHour * 60) * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** KST 연월 'YYYY-MM'(R4 — 1+1 월귀속. 리셋보정 아님 = 캘린더 월경계, purchased_at 기준). */
export function kstYearMonth(at: Date = new Date()): string {
  const kst = new Date(at.getTime() + KST_OFFSET_MIN * 60_000);
  return kst.toISOString().slice(0, 7);
}

/** 'YYYY-MM-DD' 에 n일 더한 날짜 문자열(UTC 자정 앵커라 DST/타임존 무관 — 순수 날짜 산술). */
export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** toStr - fromStr (일수). 두 'YYYY-MM-DD' 사이 정수 일수(offset 계산용). */
export function diffDays(fromStr: string, toStr: string): number {
  const a = Date.parse(`${fromStr}T00:00:00Z`);
  const b = Date.parse(`${toStr}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** 두 날짜 문자열 중 늦은 것(큐 패스 start = max(오늘, 앵커 end+1) — §2.2a·R1a). */
export function maxDateStr(a: string, b: string): string {
  return diffDays(a, b) >= 0 ? b : a;
}
