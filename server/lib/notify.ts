// 결제 디스코드 알림 (BACKEND_SYSTEM §13.22) — 실제 지급된 결제/환불을 디스코드 채널로 통지.
//
// 원칙: **DISCORD_WEBHOOK_URL 미설정이면 완전 no-op**(dev·미연결 무해). **절대 throw 없음**(알림 실패가 결제 흐름과 무관).
//   호출은 라우트에서 `after(() => notifyPurchase(...))`로 **응답 후** 실행(웹훅 200 지연 0 — RC는 빠른 200 선호).
//   **정확히 1건**: 웹훅·confirm 두 경로 중 원장에 실제 반영된(applied=true) 쪽만 호출 → 멱등 dedup으로 중복 알림 없음.
//   PII 금지(§E): 이메일·이름 없음. userId는 뒤 6자만 마스킹 표시.

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
  if (!url) return;
  try {
    const isRefund = n.kind === 'refund';
    const uid = n.userId ? '…' + n.userId.slice(-6) : '-'; // PII 마스킹(부분만)
    const embed = {
      title: isRefund ? '↩️ 환불' : '💎 결제 완료',
      color: isRefund ? 0xe03e3e : 0x2ecc71,
      fields: [
        { name: '상품', value: n.productId || '-', inline: true },
        { name: '다이아', value: `${isRefund ? '−' : '+'}${n.diamonds.toLocaleString()}`, inline: true },
        { name: '금액', value: n.priceKrw != null ? `₩${n.priceKrw.toLocaleString()}` : '—', inline: true },
        { name: '환경', value: n.environment ?? '—', inline: true },
        { name: '경로', value: n.source, inline: true },
        { name: '유저', value: uid, inline: true },
      ],
      timestamp: new Date().toISOString(), // 서버 런타임 시각(엔진/시드 무관)
    };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000); // 디스코드 지연에도 함수 안 물리게
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '배구명가 결제', embeds: [embed] }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
  } catch {
    /* 알림 실패는 무시 — 결제/응답 흐름과 완전 분리 */
  }
}
