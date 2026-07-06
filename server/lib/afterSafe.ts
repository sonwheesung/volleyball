// after()의 가드판 (§13.22) — 관찰 사이드채널(알림·로그·Sentry flush)이 머니패스 응답을 오염시키지 않게.
// next/server의 after()는 요청 컨텍스트 밖(tsx 테스트 하니스·스크립트)에서 throw → 무가드로 라우트에서 직접 부르면
// 지갑 반영 후 알림 예약이 throw → "돈은 이동했는데 응답 500" (발견: _dv_purchase 2FAIL, 2026-07-06 · 검증 Fable 5).
import { after } from 'next/server';

/** 응답 후 실행 예약 — 요청 밖이면 즉시 실행(테스트/스크립트). task는 throw-none이어야 함(알림·로그류). */
export function afterSafe(task: () => void | Promise<void>): void {
  try { after(task); } catch { void task(); }
}
