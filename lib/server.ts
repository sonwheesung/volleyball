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

export type WalletReason = 'purchase' | 'ad' | 'achievement' | 'camp' | 'refund' | 'adjust';
export interface LedgerRow {
  delta: number;
  reason: string;
  balanceAfter: number;
  createdAt: string;
}
export type TicketCategory = 'bug' | 'suggestion' | 'question' | 'etc';

type Fail = { ok: false; reason: 'offline' | 'unauthorized' | 'insufficient' | 'bad-request' | 'error'; status?: number };
export type ServerResult<T> = ({ ok: true } & T) | Fail;

const REQ_TIMEOUT_MS = 8000;

/** 공통 호출 — throw 없이 typed 결과. 서버 미설정/네트워크 실패는 offline로 흡수. */
async function call<T>(path: string, init?: RequestInit): Promise<ServerResult<T>> {
  if (!SERVER_URL) return { ok: false, reason: 'offline' };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
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

// ── 지갑 ──
export function getWallet(): Promise<ServerResult<{ balance: number; ledger: LedgerRow[] }>> {
  return call('/api/wallet');
}
/** 다이아 차감(전지훈련). 서버 확정 후에만 앱이 반영. idempotencyKey = (saveId,season,playerId,stat) 등 자연키. */
export function spendDiamonds(amount: number, reason: WalletReason, idempotencyKey: string) {
  return call<{ balance: number; applied: boolean }>('/api/wallet/spend', {
    method: 'POST',
    body: JSON.stringify({ amount, reason, idempotencyKey }),
  });
}
/** 다이아 적립(광고 SSV/업적/구매). 멱등키로 이중지급 차단. */
export function earnDiamonds(amount: number, reason: WalletReason, idempotencyKey: string) {
  return call<{ balance: number; applied: boolean }>('/api/wallet/earn', {
    method: 'POST',
    body: JSON.stringify({ amount, reason, idempotencyKey }),
  });
}

// ── 로그(기기 롤링 버퍼 업로드) ──
export function uploadLogs(entries: unknown[]) {
  return call<{ received: number }>('/api/log', { method: 'POST', body: JSON.stringify({ entries }) });
}

// ── 문의 ──
export function createTicket(category: TicketCategory, content: string) {
  return call<{ ticketId: string }>('/api/ticket', {
    method: 'POST',
    body: JSON.stringify({ category, content }),
  });
}
export function listTickets() {
  return call<{ tickets: Array<{ id: string; category: TicketCategory; content: string; reply?: string; createdAt: string }> }>(
    '/api/ticket',
  );
}
/** 진단 스냅샷(최근 10시즌 재생 JSON)을 비동기로 티켓에 첨부. 무거우니 제출 후 백그라운드. */
export function uploadSnapshot(ticketId: string, snapshot: unknown) {
  return call<{ ok: true }>('/api/snapshot', { method: 'POST', body: JSON.stringify({ ticketId, snapshot }) });
}

// ── 텔레메트리(통계 — 세션/하트비트) ──
export function telemetry(kind: 'session' | 'heartbeat', payload?: Record<string, unknown>) {
  return call<{ ok: true }>('/api/telemetry', { method: 'POST', body: JSON.stringify({ kind, ...payload }) });
}
