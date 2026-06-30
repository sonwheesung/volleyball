// 경량 로거 (MONETIZATION_SYSTEM) — 결제·광고 등 이벤트/오류를 한 곳에서 일관 기록.
//
// ★ "진실 로그"는 서버측에: 결제 = RevenueCat 대시보드(검증·구매·환불·복원 이벤트), 광고 = AdMob 대시보드.
//   → 자체 로그 백엔드/DB는 두지 않는다(local-first, CLAUDE 8). 여기 로컬 로그는 **개발 디버그/추적용**.
//   추후 분석 SDK(예: PostHog)가 생기면 이 두 함수만 확장하면 전 호출부가 따라온다.

/** 이벤트 기록(개발 콘솔). 운영 빌드에선 조용(필요 시 분석 SDK로 확장). */
export function logEvent(category: string, data?: Record<string, unknown>): void {
  if (__DEV__) console.log(`[${category}]`, data ?? '');
}

/** 오류 기록 — 어디서 났는지 + 메시지. 절대 throw하지 않는다(로깅이 흐름을 깨지 않게). */
export function logError(where: string, err: unknown): void {
  try {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[error:${where}]`, msg);
  } catch { /* 로깅 자체 실패는 무시 */ }
}
