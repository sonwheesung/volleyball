// 서버 에러 리포트 단일 진입점 (BACKEND_SYSTEM §13.21) — API 라우트 catch에서 호출.
// Sentry가 init 안 됐으면(SENTRY_DSN 미설정) captureException은 no-op → dev·미연결에서도 완전 무해.
// 원칙: 관측 실패가 요청 처리를 절대 깨지 않는다(try/catch로 감쌈). 결정론/시드와 무관한 순수 운영 메타.
import * as Sentry from '@sentry/node';

export function reportError(e: unknown, where?: string): void {
  try {
    Sentry.captureException(e, where ? { tags: { where } } : undefined);
  } catch {
    /* 관측 실패는 무시 — 요청 흐름 보존 */
  }
}
