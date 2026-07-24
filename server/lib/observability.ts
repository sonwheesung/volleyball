// 서버 에러 리포트 단일 진입점 (BACKEND_SYSTEM §13.21) — API 라우트 catch에서 호출.
// Sentry가 init 안 됐으면(SENTRY_DSN 미설정) captureException은 no-op → dev·미연결에서도 완전 무해.
//
// ★ 서버리스(Vercel) flush(§13.21): @sentry/node는 이벤트를 **비동기 전송**하는데, Vercel 함수는 응답 직후
//   얼어붙어(freeze) 전송 완료 전에 죽어 이벤트가 유실된다. Next의 `after()`(응답 후 실행 — Vercel이 waitUntil로
//   함수를 살려둠)로 **응답 뒤 flush**해 유실을 막는다(응답 지연 0). 요청 컨텍스트 밖(테스트 등)에선 after()가
//   throw → 무시(그쪽은 호출부가 직접 flush). 결정론/시드와 무관한 순수 운영 메타.
//
// ★ 환경 게이트(2026-07-24 사건, §13.21): 로컬 dev가 `.env.local`의 **운영 DSN**을 상속해 운영 프로젝트로 에러를
//   보내던 것을 차단 — `sentryEnabled()`(instrumentation과 **같은 판단**)이 false면 캡처 자체를 하지 않는다.
//   (init이 안 된 상태에서도 captureException은 no-op이지만, 판단을 한 곳에 모아 두 경로가 어긋나지 않게 명시한다.)
import * as Sentry from '@sentry/node';
import { afterSafe } from './afterSafe';
import { sentryEnabled } from './sentryGate';

export function reportError(e: unknown, where?: string): void {
  if (!sentryEnabled()) return; // 비배포(로컬)·DSN 미설정 = 완전 no-op
  try {
    Sentry.captureException(e, where ? { tags: { where } } : undefined);
    afterSafe(async () => { await Sentry.flush(2000); }); // 응답 후 전송 보장(서버리스). 요청 밖이면 즉시 flush
  } catch {
    /* 관측 실패는 무시 — 요청 흐름 보존 */
  }
}
