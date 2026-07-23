// 출석 패스 클라 표시 헬퍼 (ATTENDANCE_PASS_SYSTEM §UI) — 리셋보정 오늘 날짜만(표시용).
// 진실(수령·창 판정)은 서버(server/lib/dates.todayKstResetAdjusted). 여기 값은 D-N·며칠차·유예 **표시**에만 쓴다(결정 아님).
//   engine/diamonds.passView(endDate, today)에 넘길 today를 UI 런타임 시각으로 계산(엔진은 순수 유지 — new Date는 여기서만).
import { PASS_RESET_HOUR_KST } from '../engine/diamonds';

/** 리셋보정 오늘(KST) 'YYYY-MM-DD' — 서버 todayKstResetAdjusted 미러. 리셋 KST 00:00(자정)이라 순수 KST 캘린더 날짜와 동일(2026-07-23 Q6 재확정 — 유예/04시 보호는 우편 30일 보존이 대체). resetHour>0이면 [00:00, resetHour) 는 전날 귀속. */
export function todayKstReset(nowMs: number = Date.now()): string {
  const shifted = new Date(nowMs + (9 * 60 - PASS_RESET_HOUR_KST * 60) * 60_000);
  return shifted.toISOString().slice(0, 10);
}
