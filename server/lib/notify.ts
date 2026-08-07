// 디스코드 알림 (BACKEND_SYSTEM §13.22·§13.28) — 결제/환불·신규 문의·신규 가입을 디스코드 채널로 통지.
//
// 원칙: **웹훅 URL 미설정이면 완전 no-op**(dev·미연결 무해). **절대 throw 없음**(알림 실패가 요청 흐름과 무관).
//   호출은 라우트에서 `after(() => notifyXxx(...))`로 **응답 후** 실행(응답 지연 0 — 서버리스 freeze 유실 방지 §13.22).
//   결제 알림은 **정확히 1건**: 웹훅·confirm 중 원장에 실제 반영된(applied=true) 쪽만 → 멱등 dedup으로 중복 없음.
//   PII 금지(§E): 이메일·이름 없음. userId는 뒤 6자만 마스킹. 문의 본문은 사용자가 직접 쓴 것이라 표시하되 길이 컷.
//   채널: 결제=`DISCORD_WEBHOOK_URL`. 문의=`DISCORD_TICKET_WEBHOOK_URL`(없으면 결제 채널로 폴백).
//        가입=`DISCORD_SIGNUP_WEBHOOK_URL`(없으면 결제 채널로 폴백, §13.28).

/** 공통 전송 — url 없으면 no-op, 실패는 삼킴, 4초 타임아웃. */
async function postDiscord(url: string, username: string, embed: Record<string, unknown>): Promise<void> {
  if (!url) return;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000); // 디스코드 지연에도 함수 안 물리게
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, embeds: [embed] }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
  } catch {
    /* 알림 실패는 무시 — 요청/응답 흐름과 완전 분리 */
  }
}

const maskUser = (userId?: string | null): string => (userId ? '…' + userId.slice(-6) : '-'); // PII 마스킹(부분만)

export interface PurchaseNotice {
  kind: 'purchase' | 'refund';
  productId: string;
  diamonds: number;            // 지급/회수 다이아(양수 절대값)
  priceKrw: number | null;     // 실매출(원) — 통화 미제공/비KRW면 null
  environment?: string | null; // PRODUCTION | SANDBOX
  source: 'webhook' | 'confirm';
  userId?: string | null;
}

/** 결제/환불 1건 디스코드 통지. no-op·throw-none. 라우트에서 after()로 감싸 응답 후 전송 권장. */
export async function notifyPurchase(n: PurchaseNotice): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL ?? ''; // 호출 시점 읽기(콜드스타트 env 타이밍·테스트 견고)
  const isRefund = n.kind === 'refund';
  await postDiscord(url, '배구명가 결제', {
    title: isRefund ? '↩️ 환불' : '💎 결제 완료',
    color: isRefund ? 0xe03e3e : 0x2ecc71,
    fields: [
      { name: '상품', value: n.productId || '-', inline: true },
      { name: '다이아', value: `${isRefund ? '−' : '+'}${n.diamonds.toLocaleString()}`, inline: true },
      { name: '금액', value: n.priceKrw != null ? `₩${n.priceKrw.toLocaleString()}` : '—', inline: true },
      { name: '환경', value: n.environment ?? '—', inline: true },
      { name: '경로', value: n.source, inline: true },
      { name: '유저', value: maskUser(n.userId), inline: true },
    ],
    timestamp: new Date().toISOString(), // 서버 런타임 시각(엔진/시드 무관)
  });
}

export interface RefundDroppedNotice {
  productId: string | null;
  storeTxnId: string | null;   // 원장·감사 앵커(관리자가 payment-events?txn=…로 원구매 유저 추적)
  priceKrw: number | null;
  rcAppUserId: string | null;  // RC 익명 id($RCAnonymousID…) — 우리 유저 PII 아님(RC 생성값)
  eventType: string | null;    // CANCELLATION | REFUND
}

/** 익명(비-UUID) 환불 웹훅 유실 통지 — 유저 귀속 불가로 원장 미반영(§13.18 B1). 관리자 수동 환불(§13.17) 판단용
 *  관측 채널(머니패스 밖·throw-none). storeTxnId로 원구매(confirm 지급)를 역추적해 클로백 여부 결정. no-op·throw-none. */
export async function notifyRefundDropped(n: RefundDroppedNotice): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL ?? '';
  await postDiscord(url, '배구명가 결제', {
    title: '⚠️ 익명 환불 유실 — 수동 확인 필요',
    color: 0xf1c40f,
    description: '익명(비-UUID) app_user_id 환불 웹훅 — 유저 귀속 불가로 자동 클로백 안 됨. storeTxnId로 원구매 유저를 찾아 관리자 수동 환불(§13.17) 여부 확인.',
    fields: [
      { name: '유형', value: n.eventType ?? '—', inline: true },
      { name: '상품', value: n.productId || '-', inline: true },
      { name: '금액', value: n.priceKrw != null ? `₩${n.priceKrw.toLocaleString()}` : '—', inline: true },
      { name: '거래(txn)', value: n.storeTxnId ? '…' + n.storeTxnId.slice(-12) : '—', inline: false },
      { name: 'RC id', value: n.rcAppUserId ? n.rcAppUserId.slice(0, 32) : '—', inline: false },
    ],
    timestamp: new Date().toISOString(),
  });
}

const TICKET_CAT_KO: Record<string, string> = { bug: '🐞 버그', suggestion: '💡 건의', question: '❓ 질문', refund: '↩️ 환불', etc: '🗂 기타' };

export interface TicketNotice {
  ticketId: string;
  category: string;            // bug | suggestion | question | refund | etc
  content: string;             // 사용자 작성 본문(표시하되 길이 컷)
  userId?: string | null;
  platform?: string | null;
  appVersion?: string | null;
  // ── 멀티프로젝트(익명 문의 /api/ticket/anon) 옵션. 미지정이면 기존 배구명가 동작 그대로 ──
  projLabel?: string;          // 임베드 username — 어느 앱 문의인지 구분(기본 '배구명가 문의')
  webhookUrl?: string;         // 프로젝트 전용 채널. 없으면 기존 폴백 체인(TICKET → 결제)
}

/** 신규 문의 1건 디스코드 통지. 문의 전용 채널(DISCORD_TICKET_WEBHOOK_URL) 없으면 결제 채널로 폴백. no-op·throw-none. */
export async function notifyTicket(n: TicketNotice): Promise<void> {
  // 프로젝트 전용 채널이 주어지면 그쪽, 아니면 기존 폴백 체인(문의 전용 → 결제 채널).
  const url = n.webhookUrl || process.env.DISCORD_TICKET_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL || '';
  const body = (n.content ?? '').slice(0, 1000); // Discord 필드 상한(1024) 안에서 컷
  await postDiscord(url, n.projLabel || '배구명가 문의', {
    title: '📨 새 문의',
    color: 0x3498db,
    fields: [
      { name: '분류', value: TICKET_CAT_KO[n.category] ?? n.category, inline: true },
      { name: '유저', value: maskUser(n.userId), inline: true },
      { name: '기기', value: `${n.platform ?? '—'}${n.appVersion ? ` · v${n.appVersion}` : ''}`, inline: true },
      { name: '내용', value: body || '—', inline: false },
    ],
    footer: { text: `ticket ${n.ticketId}` },
    timestamp: new Date().toISOString(),
  });
}

const PROVIDER_KO: Record<string, string> = { google: '🟢 Google', apple: '🍎 Apple', dev: '🧪 dev' };

export interface SignupNotice {
  userId: string;              // 표시는 maskUser(뒤 6자) — 원문 절대 미전송
  provider: string;            // google | apple | dev
  platform?: string | null;    // android | ios
  appVersion?: string | null;
  totalSignups?: number | null; // 누적 실가입 수(countSignups). 조회 실패면 null → '—'
  projCode?: string | null;    // 멀티프로젝트 채널 오독 방지(§13.2) — footer 표기용
}

/** 신규 가입(진짜 첫 가입) 1건 디스코드 통지 — §13.28. 로그인 라우트의 **createUser 성공 직후**에서만 호출한다
 *  (ensureUser=저수준 upsert는 매 로그인 경로라 "가입"이 아님). 재로그인은 findUserRow 히트로 이 분기에 도달조차 안 함.
 *  채널: DISCORD_SIGNUP_WEBHOOK_URL → DISCORD_WEBHOOK_URL 폴백 → 둘 다 없으면 no-op.
 *  PII 금지: displayName·이메일·providerId(구글 sub)·userId 원문 미전송(§13.9).
 *  no-op·throw-none — 라우트에서 afterSafe()로 감싸 **응답 후** 전송(가입 응답 지연 0·실패해도 가입 성공). */
export async function notifySignup(n: SignupNotice): Promise<void> {
  const url = process.env.DISCORD_SIGNUP_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL || ''; // 호출 시점 읽기
  await postDiscord(url, '배구명가 가입', {
    title: '🎉 신규 가입',
    color: 0x9b59b6,
    fields: [
      { name: '가입 경로', value: PROVIDER_KO[n.provider] ?? n.provider ?? '—', inline: true },
      { name: '기기', value: `${n.platform ?? '—'}${n.appVersion ? ` · v${n.appVersion}` : ''}`, inline: true },
      // 방금 만든 행이 카운트에 포함되므로 "N번째". 실패(null)면 '—' — 알림 자체는 그대로 나간다.
      { name: '누적 가입', value: n.totalSignups != null ? `${n.totalSignups.toLocaleString()}번째` : '—', inline: true },
      { name: '유저', value: maskUser(n.userId), inline: true },
    ],
    footer: { text: `proj ${n.projCode ?? '-'}` },
    timestamp: new Date().toISOString(), // 가입 시각(서버 런타임 — 엔진/시드 무관)
  });
}
