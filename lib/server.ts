// 서버 클라이언트 — 앱의 유일한 서버 연결점 (BACKEND_SYSTEM §13.1·§13.6).
//
// 원칙(광고 계약과 동일): **절대 throw 안 함**. 모든 메서드가 typed 결과를 돌려준다(성공 | offline | error).
// online-first ≠ online-only: 서버가 안 떠도(EXPO_PUBLIC_SERVER_URL 비었거나 네트워크 끊김) 앱은 정상 동작해야
//   하므로 여기서 fetch 실패를 흡수하고 `{ ok:false, reason:'offline' }`로 조용히 반환한다. 관전/시뮬은 이 계층을
//   전혀 안 탄다(로컬 결정론). 서버가 필요한 건 오직 다이아 지갑·결제·로그·문의·통계.
//
// 잔액 '표시'는 캐시(스토어), 사용/적립/결제는 이 응답(서버 확정) 후에만 반영한다(§2·§4).
import { logError } from './log';

// 배포 후 실 Vercel URL을 EXPO_PUBLIC_SERVER_URL로 주입. 비면 오프라인(로컬 미연결) — fetch 안 함.
const SERVER_URL = (process.env.EXPO_PUBLIC_SERVER_URL ?? '').replace(/\/$/, '');

// 자체 Bearer 세션 토큰(마일스톤3: 소셜 ID토큰 검증 후 서버가 발급 → SecureStore). 지금은 null(익명).
let bearer: string | null = null;
export function setServerToken(token: string | null): void {
  bearer = token;
}
export function isServerConfigured(): boolean {
  return !!SERVER_URL;
}

export type WalletReason = 'purchase' | 'ad' | 'achievement' | 'camp' | 'refund' | 'adjust' | 'coupon' | 'welcome';
export interface LedgerRow {
  delta: number;
  reason: string;
  balanceAfter: number;
  createdAt: string;
}
export type TicketCategory = 'bug' | 'suggestion' | 'question' | 'etc' | 'refund';
export interface DeviceInfo { platform: string; osVersion: string; appVersion: string } // 진단 기기정보(§13.17)

type Fail = { ok: false; reason: 'offline' | 'unauthorized' | 'insufficient' | 'bad-request' | 'cap' | 'error'; status?: number };
export type ServerResult<T> = ({ ok: true } & T) | Fail;

const REQ_TIMEOUT_MS = 8000; // 대화형 호출 기본(지갑·로그인 등 — 빠른 응답 기대)

/** 공통 호출 — throw 없이 typed 결과. 서버 미설정/네트워크 실패는 offline로 흡수.
 *  timeoutMs: 무거운 백그라운드 업로드(진단 스냅샷 §13.20 — 재현키 포함 수백KB)는 8초로 부족 → 호출부가 상향. */
async function call<T>(path: string, init?: RequestInit, timeoutMs: number = REQ_TIMEOUT_MS): Promise<ServerResult<T>> {
  if (!SERVER_URL) return { ok: false, reason: 'offline' };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(SERVER_URL + path, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    clearTimeout(timer);
    if (res.status === 401) return { ok: false, reason: 'unauthorized', status: 401 };
    let body: any = {};
    try {
      body = await res.json();
    } catch {
      /* 빈/비JSON 응답 허용 */
    }
    if (!res.ok || body?.ok === false) {
      const reason = (body?.reason as Fail['reason']) ?? 'error';
      return { ok: false, reason, status: res.status };
    }
    return { ok: true, ...(body as T) };
  } catch (e) {
    // AbortError(타임아웃)·네트워크 실패 → offline. 로깅만, 흐름은 안 깸.
    logError('server.call:' + path, e);
    return { ok: false, reason: 'offline' };
  }
}

// ── 인증(AUTH_SYSTEM) ──
/** 신원 → 자체 Bearer 세션. google=idToken(서버가 검증해 sub 도출) · dev=providerId(기기ID). 개인정보 최소화(이메일·이름 미전송).
 *  성공 시 setServerToken은 호출부(useAuthStore)가. */
export function login(provider: string, cred: { providerId?: string; idToken?: string }, device?: DeviceInfo) {
  return call<{ token: string; userId: string; provider: string; displayName: string | null }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ provider, providerId: cred.providerId, idToken: cred.idToken, device }),
  });
}

// ── 부팅 게이트(점검·버전·공지) ──
export interface BootstrapData {
  maintenance: { active: boolean; title?: string; body?: string };
  version: { min: string | null; latest: string | null; androidUrl: string | null; iosUrl: string | null };
  announcements: Array<{ id: string; title: string; body: string; pinned: boolean }>;
}
export function getBootstrap(): Promise<ServerResult<BootstrapData>> {
  return call('/api/bootstrap');
}

// ── 지갑 ──
export function getWallet(): Promise<ServerResult<{ balance: number; ledger: LedgerRow[]; adToday?: { count: number; lastAtMs: number | null } }>> {
  return call('/api/wallet');
}
/** 다이아 차감(전지훈련). 서버 확정 후에만 앱이 반영. **금액은 서버 권위**(camp=−300 강제(2026-07-06 인하), §13.12) — amount는 표시/호환용.
 *  idempotencyKey = camp:<userId>:<saveId>:<season>:<playerId>. ref = 감사용 상세(playerId:course). */
export function spendDiamonds(amount: number, reason: WalletReason, idempotencyKey: string, ref?: string) {
  return call<{ balance: number; applied: boolean }>('/api/wallet/spend', {
    method: 'POST',
    body: JSON.stringify({ amount, reason, idempotencyKey, ref }),
  });
}
/** 다이아 적립(광고 SSV/업적/구매). 멱등키로 이중지급 차단. ad는 서버 상수(+50), achievement만 클라값(캡). ref=감사(achId 등). */
export function earnDiamonds(amount: number, reason: WalletReason, idempotencyKey: string, ref?: string) {
  return call<{ balance: number; applied: boolean }>('/api/wallet/earn', {
    method: 'POST',
    body: JSON.stringify({ amount, reason, idempotencyKey, ref }),
  });
}
/** 업적 보상 **배치** 적립 — reason은 서버가 'achievement' 강제(§4). 업적 N개 수령을 **1왕복 1트랜잭션**으로(순차 earn N회 ≈40s → ≈2~4s).
 *  results는 items와 **동일 순서** — applied(신규지급)·capped(평생합 캡, 지급 0)·둘 다 아님(멱등 재시도). balance=최종 잔액.
 *  멱등키는 achKey(userId,id) 그대로(서버가 userId로 네임스페이스) — achId별 계정평생 dedup 보존. */
export function earnDiamondsBatch(items: Array<{ amount: number; idempotencyKey: string; ref?: string }>) {
  // 타임아웃 20s(기본 8s 상향) — 업적 수십 건 배치 + Vercel 콜드스타트면 8s를 넘겨 "서버는 지급 완료·클라는 실패 표시"
  // 응답 유실이 났다(운영 사고 2026-07-11: 연결 오류 표시 후 재시도에 '수령할 보상 없음'). 수령 중 로딩 오버레이가 가린다.
  return call<{ results: Array<{ applied: boolean; capped?: boolean }>; balance: number }>('/api/wallet/earn-batch', {
    method: 'POST',
    body: JSON.stringify({ items }),
  }, 20000);
}

// ── 결제 폴백(§13.18) ──
/** 클라 구매 resolve 후 폴백 — 스토어 거래id로 서버가 RC REST 재검증 → 같은 멱등키 지급. 웹훅 지연·유실 메꿈.
 *  성공/이미지급(applied:false) 모두 ok. 실패해도 웹훅이 결국 지급하므로 호출부는 로그만 남기고 syncWallet로 수렴.
 *  ctx = 감사 상관(§13.22): requestId(클라 브레드크럼↔서버 로그 이음)·platform·appVersion. */
export function confirmPurchase(storeTxnId: string, productId: string, ctx?: { requestId?: string; platform?: string; appVersion?: string }) {
  return call<{ applied: boolean; balance: number }>('/api/purchase/confirm', {
    method: 'POST',
    body: JSON.stringify({ storeTxnId, productId, ...ctx }),
  });
}

// ── 쿠폰 ──
export type CouponRedeemResult =
  | { ok: true; reward: number; balance: number }
  | { ok: false; reason: 'invalid' | 'expired' | 'used' | 'not-eligible' | 'offline' | 'unauthorized' | 'error' };
/** 쿠폰 코드 사용 — 서버 단일 트랜잭션 확정(§13.14). 성공 후 앱은 syncWallet로만 캐시 갱신(낙관적 반영 금지). */
export async function redeemCoupon(code: string): Promise<CouponRedeemResult> {
  const r = await call<{ reward: number; balance: number }>('/api/coupon/redeem', { method: 'POST', body: JSON.stringify({ code }) });
  return r as CouponRedeemResult; // 서버 reason(invalid/expired/used/not-eligible)이 call()의 body.reason으로 전달됨
}

// ── 로그(기기 롤링 버퍼 업로드) ──
export function uploadLogs(entries: unknown[]) {
  return call<{ received: number }>('/api/log', { method: 'POST', body: JSON.stringify({ entries }) });
}

// ── 문의 ──
export function createTicket(category: TicketCategory, content: string, device?: DeviceInfo) {
  return call<{ ticketId: string }>('/api/ticket', {
    method: 'POST',
    body: JSON.stringify({ category, content, device }),
  });
}
export function listTickets() {
  return call<{ tickets: Array<{ id: string; category: TicketCategory; content: string; status?: string; reply?: string; createdAt: string }> }>(
    '/api/ticket',
  );
}
/** 진단 스냅샷(최근 10시즌 재생 JSON)을 비동기로 티켓에 첨부. 무거우니 제출 후 백그라운드. */
export function uploadSnapshot(ticketId: string, snapshot: unknown) {
  // 재현키(§13.20) 포함으로 수백KB — 백그라운드/비블로킹이라 넉넉히 30초(8초 기본은 Aborted, 실기 발견 2026-07-04).
  return call<{ ok: true }>('/api/snapshot', { method: 'POST', body: JSON.stringify({ ticketId, snapshot }) }, 30000);
}

// ── 텔레메트리(통계 — 세션/하트비트) ──
export function telemetry(kind: 'session' | 'heartbeat', payload?: Record<string, unknown>) {
  return call<{ ok: true }>('/api/telemetry', { method: 'POST', body: JSON.stringify({ kind, ...payload }) });
}
