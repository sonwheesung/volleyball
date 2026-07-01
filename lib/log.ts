// 경량 로거 (MONETIZATION_SYSTEM) — 결제·광고 등 이벤트/오류를 한 곳에서 일관 기록.
//
// ~~★ "진실 로그"는 서버측에: 결제 = RevenueCat 대시보드, 광고 = AdMob 대시보드. 자체 로그백엔드 없음(local-first).~~
//   → **정정(2026-07-01, 온라인 전환)**: RevenueCat 폐기·오프라인 기둥 폐기. 결제 진실=우리 Vercel DB(직접 검증),
//   진단 로그=**기기 롤링 버퍼(`lib/deviceLog.ts`, 최근 10시즌)** + 중요 이벤트 서버 적재(BACKEND_SYSTEM §7·§13.6).
//   여기 `logEvent`/`logError`는 개발 콘솔용 저수준 훅으로 유지 — 진단 버퍼/서버 전송은 deviceLog·server가 담당.

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
