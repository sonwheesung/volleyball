// Sentry 연동 검증 — 실제 init(우리 instrumentation) → reportError → flush로 이벤트 전송 확인.
//   npx tsx tools/_dv_sentry_verify.ts (dev는 .env.development.local 우선, 없으면 .env.local — SENTRY_DSN은 .env.local에서 보충)
// flush(true)면 이벤트가 Sentry로 전송됨 → 대시보드 Issues에 뜬다. (짧은 프로세스라 flush 필수 — 안 하면 배치 큐에서 소실)
process.env.NEXT_RUNTIME = 'nodejs'; // register()가 Node 런타임에서만 init하므로 지정
import './_env'; // env 주입(다른 import보다 먼저 — 호이스팅 순서상 첫 import)
import * as Sentry from '@sentry/node';
import { register } from '../instrumentation';
import { reportError } from '../lib/observability';

(async () => {
  await register();
  console.log('SENTRY_DSN 설정됨:', !!process.env.SENTRY_DSN);
  console.log('Sentry 클라이언트 활성:', !!Sentry.getClient());
  // 두 경로 모두 검증: reportError(라우트 catch용) + 직접 captureMessage
  reportError(new Error('배구명가 Sentry 연동 검증 — 의도적 테스트 에러'), 'sentry-verify');
  Sentry.captureMessage('배구명가 Sentry 연동 검증 — 테스트 메시지', 'info');
  const flushed = await Sentry.flush(8000);
  console.log('flush 결과(true=전송 완료):', flushed);
})();
