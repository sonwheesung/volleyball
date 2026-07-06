// 결제 이벤트 감사 로그 (BACKEND_SYSTEM §13.22, 2026-07-05) — 결제 생애주기 단계마다 purchase_event에 1행.
//
// 원칙(리서치 §F16·§F18):
//   • **관찰 전용·fire-and-forget** — 절대 throw 안 함(로깅 실패가 지급/응답을 되돌리지 않게). 실패는 Sentry로만.
//   • **돈 진실 아님** — 잔액 진실은 walletLedger. 여기는 진단(상관ID·dedup·실패사유). idempotencyKey로 원장과 JOIN.
//   • **원장 커밋 뒤 로깅** — 별도 insert라 로깅이 트랜잭션을 안 잡는다(지급 롤백 불가).
//   • **PII/토큰/시크릿 금지(§E)** — 이메일·영수증·purchaseToken·Authorization·API키는 스크럽. 원본 웹훅 바디 덤프 금지(화이트리스트만).
import { db } from '../db';
import { purchaseEvent } from '../db/schema';
import { PROJ_CODE } from './proj';
import { reportError } from './observability';
import { afterSafe } from './afterSafe';

export type PaymentSource = 'client' | 'webhook' | 'confirm';
export type PaymentOutcome = 'applied' | 'deduped' | 'rejected' | 'pending' | 'cancelled' | 'ignored' | 'error';

export interface PaymentEventInput {
  source: PaymentSource;
  stage: string;                 // 예: webhook.received / confirm.grant.applied (리서치 §A)
  ok: boolean;
  outcome?: PaymentOutcome;
  reasonCode?: string | null;    // 실패/무시 사유(정규화 코드 또는 원사유)
  errorMessage?: string | null;
  userId?: string | null;
  rcAppUserId?: string | null;
  requestId?: string | null;
  storeTxnId?: string | null;
  rcEventId?: string | null;
  idempotencyKey?: string | null;
  eventType?: string | null;
  productId?: string | null;
  price?: number | null;
  currency?: string | null;
  diamondsDelta?: number | null;
  balanceAfter?: number | null;
  environment?: string | null;
  platform?: string | null;
  appVersion?: string | null;
  detail?: Record<string, unknown> | null;
}

// 민감 키 차단(§E) — 토큰·영수증·이메일·시크릿·서명은 detail에서 제외. 이름 기반 deny-list(값이 아니라 키로 거른다).
const DENY_KEY = /(authorization|token|receipt|secret|password|email|api[_-]?key|signed|jws|credential)/i;

/** detail 화이트리스트 스크럽 — 문자열은 300자 컷, 원시값만 통과. 객체/배열은 스킵(원본 바디 덤프 방지). null이면 null. */
function scrubDetail(obj: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (DENY_KEY.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 300);
    else if (v === null || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    // 중첩 객체·배열은 통과 안 시킴 — 필요한 값은 호출부가 평탄화해 넣는다(토큰 유출/폭증 방지)
  }
  return Object.keys(out).length ? out : null;
}

const trunc = (s?: string | null): string | null => (s == null ? null : String(s).slice(0, 500));

/** ★ 라우트용 — **응답 후(after)** 로깅해 서버리스(Vercel) freeze로 insert가 유실되는 걸 막는다(§13.21과 동일 함정).
 *  `void logPaymentEvent()`는 await 안 된 채 응답이 나가면 함수가 얼어 insert가 죽는다(로컬은 살아서 통과 — 운영만 누락).
 *  after()는 응답 뒤 waitUntil로 함수를 유지해 insert 완료 보장(응답 지연 0). 요청 컨텍스트 밖(테스트/tsx)이면 after() throw → 즉시 실행. */
export function logPaymentEventAfter(e: PaymentEventInput): void {
  afterSafe(() => logPaymentEvent(e)); // 요청 밖(테스트/tsx)이면 즉시 실행
}

/** 결제 이벤트 1건 기록. **절대 throw 안 함**. 라우트에선 `logPaymentEventAfter`를 쓸 것(서버리스 유실 방지). */
export async function logPaymentEvent(e: PaymentEventInput): Promise<void> {
  try {
    await db.insert(purchaseEvent).values({
      projCode: PROJ_CODE,
      source: e.source,
      stage: e.stage,
      ok: e.ok,
      outcome: e.outcome ?? null,
      reasonCode: e.reasonCode ?? null,
      errorMessage: trunc(e.errorMessage),
      userId: e.userId ?? null,
      rcAppUserId: e.rcAppUserId ?? null,
      requestId: e.requestId ?? null,
      storeTxnId: e.storeTxnId ?? null,
      rcEventId: e.rcEventId ?? null,
      idempotencyKey: e.idempotencyKey ?? null,
      eventType: e.eventType ?? null,
      productId: e.productId ?? null,
      price: e.price ?? null,
      currency: e.currency ?? null,
      diamondsDelta: e.diamondsDelta ?? null,
      balanceAfter: e.balanceAfter ?? null,
      environment: e.environment ?? null,
      platform: e.platform ?? null,
      appVersion: e.appVersion ?? null,
      detail: scrubDetail(e.detail),
    });
  } catch (err) {
    reportError(err, 'paymentLog'); // 로깅 실패는 관측만 — 결제 흐름 절대 안 깬다
  }
}
