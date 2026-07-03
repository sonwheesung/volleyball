// Next.js instrumentation (BACKEND_SYSTEM §13.21) — 서버 부팅 시 1회 register() 자동 호출.
// Sentry(서버 관측)를 여기서 init. **DSN 없으면 완전 no-op**(부팅 안전 — dev·미연결에서도 정상 기동).
// Vercel Node 런타임에서만 init(edge 제외). 결정론 격리: 관측은 재화·시드·리플레이와 무관한 운영 메타.
import * as Sentry from '@sentry/node';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return; // edge/기타 런타임 제외
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return; // DSN 미설정 = 비활성(Sentry 미연결 상태로 정상 부팅)
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
  });
}

// 우리 catch가 삼키지 않고 새어나간 미처리 라우트 에러도 Sentry로(Next 15+ 훅).
export async function onRequestError(err: unknown): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  try { Sentry.captureException(err); } catch { /* 무시 */ }
}
