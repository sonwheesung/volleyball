// Sentry 활성 게이트 — **단일 판단처**(BACKEND_SYSTEM §13.21 "운영 DSN은 배포 환경에서만", 2026-07-24).
//
// 왜: Next는 dev에서도 `.env.local`을 로드한다. `.env.local`엔 운영 크리덴셜(SENTRY_DSN)이 있으므로
//   **로컬 dev 서버가 운영 Sentry 프로젝트로 에러를 전송**해 왔다(DB는 로컬인데 관측만 운영으로 샘).
//   가드/뮤턴트 검수가 의도적으로 500을 대량 생성하면 그대로 운영 이슈·알림 폭주(사건 2026-07-24).
//   `.env.development.local`에 빈 DSN을 넣는 로컬 대증요법은 gitignore라 **다른 머신·CI·새 클론에선 다시 샌다**
//   → 코드에 환경 게이트를 둔다.
//
// 규칙(우선순위 순):
//   1. DSN 없음/빈값 → 항상 비활성(기존 부팅 안전 계약 유지 — 미연결에서도 정상 기동).
//   2. `SENTRY_FORCE_LOCAL=1` → 로컬에서도 활성(탈출구 — 연동 검증 `_dv_sentry_verify` 등 의도적 전송 전용).
//   3. 그 외엔 **Vercel 배포 환경에서만** 활성: `VERCEL_ENV`가 'production' | 'preview'.
//      - 로컬 dev/tsx 가드에는 이 변수가 아예 없다 → 비활성.
//      - `vercel dev`(로컬)은 `VERCEL_ENV='development'`라 **허용목록에서 제외**(로컬이므로 배제 — 화이트리스트가
//        "VERCEL_ENV 존재 여부"보다 정확하다).
//
// ⚠ 이 판단을 `instrumentation.ts`(init·onRequestError)와 `lib/observability.ts`(reportError)가 **공유**한다.
//   두 곳이 어긋나면 절반만 막혀 또 샌다(onRequestError가 DSN만 보던 게 실제 결함이었다).
//   순수 함수(부작용·import 0) — 가드가 라이브 전송 없이 단위 검증 가능. 회귀 가드: `tools/_dv_sentry_gate.ts`.

/** Sentry로 실제 전송할 환경인가 — init·onRequestError·reportError가 공유하는 단일 판단. */
export function sentryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (!env.SENTRY_DSN) return false; // (1) DSN 없음/빈 문자열 = 완전 no-op
  if (env.SENTRY_FORCE_LOCAL === '1') return true; // (2) 탈출구(디버깅·연동 검증)
  return env.VERCEL_ENV === 'production' || env.VERCEL_ENV === 'preview'; // (3) 배포에서만
}
