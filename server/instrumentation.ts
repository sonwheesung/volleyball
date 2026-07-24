// Next.js instrumentation (BACKEND_SYSTEM §13.21) — 서버 부팅 시 1회 register() 자동 호출.
// Sentry(서버 관측)를 여기서 init. **DSN 없으면 완전 no-op**(부팅 안전 — dev·미연결에서도 정상 기동).
// Vercel Node 런타임에서만 init(edge 제외). 결정론 격리: 관측은 재화·시드·리플레이와 무관한 운영 메타.
//
// ★ 환경 게이트(2026-07-24 사건): DSN이 있어도 **배포(VERCEL_ENV=production|preview)에서만** init한다.
//   Next는 dev에서도 `.env.local`(운영 크리덴셜)을 읽어 로컬 dev가 운영 Sentry로 에러를 보내던 것을 차단.
//   판단은 `lib/sentryGate.ts` 한 곳에서 — init·onRequestError·reportError가 같은 함수를 쓴다(어긋나면 절반만 막힘).
import * as Sentry from '@sentry/node';
import { sentryEnabled } from './lib/sentryGate';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return; // edge/기타 런타임 제외
  if (!sentryEnabled()) return; // DSN 미설정 또는 로컬(비배포) = 비활성 — Sentry 미연결 상태로 정상 부팅
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
  });
}

// 우리 catch가 삼키지 않고 새어나간 미처리 라우트 에러도 Sentry로(Next 15+ 훅).
// Next가 이 async 훅을 await하므로 여기선 직접 flush(서버리스 유실 방지 — after 불필요).
// register()와 **동일 게이트**를 탄다(구: SENTRY_DSN만 확인 → 로컬에서 절반만 막히던 구멍).
export async function onRequestError(err: unknown): Promise<void> {
  if (!sentryEnabled()) return;
  try {
    Sentry.captureException(err);
    await Sentry.flush(2000);
  } catch {
    /* 무시 */
  }
}
