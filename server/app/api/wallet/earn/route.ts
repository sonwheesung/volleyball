// POST /api/wallet/earn — 다이아 적립(광고/업적). body: { amount?, reason, idempotencyKey, ref? }
// 멱등키(§4)로 이중지급 차단 + **금액은 서버 권위**(§13.12 P0-2): ad=+50 서버상수·achievement만 클라값(호출당 1000 캡 + 평생합 20,000 백스톱).
// reason 화이트리스트(§13.12) — 'purchase'/'coupon' 사칭 차단. ad는 하루 8회, achievement는 평생합 서버 백스톱(원장 sum·H3).
import { NextResponse } from 'next/server';
import { reportError } from '../../../../lib/observability';
import { applyWallet } from '../../../../lib/wallet';
import { countReasonToday, sumReason } from '../../../../lib/wallet';
import { earnAmount, isEarnReason, AD_DAILY_CAP, ACH_LIFETIME_CAP } from '../../../../lib/econ';
import { resolveUserId } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { amount?: number; reason?: string; idempotencyKey?: string; ref?: string };
    const reason = String(body.reason ?? '');
    if (!isEarnReason(reason) || !body.idempotencyKey) {
      return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    }
    const amount = earnAmount(reason, Number(body.amount)); // 서버 권위(클라 amount 무시/캡)
    if (amount === null || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    }
    const userId = await resolveUserId(req);
    // 광고 하루 상한 서버 백스톱(스텁 멱등키 무한증가 방지 — 멱등은 슬롯 재시도만 막지 rate는 안 막음)
    if (reason === 'ad' && (await countReasonToday(userId, 'ad')) >= AD_DAILY_CAP) {
      return NextResponse.json({ ok: false, reason: 'cap' }, { status: 409 });
    }
    // 업적 평생합 백스톱(H3) — 원장 sum(진실)으로 강제. 정당 유저는 카탈로그 총합 16,220 < 20,000이라 안 닿음(치터 전용).
    // remaining<=0 이면 409 cap(ad와 동일 채널), 아니면 남은 만큼 잘라 지급(경계에서 부분 지급).
    // 레이스(동시 2건이 같은 remaining 읽음)는 최대 per-claim(1000) 초과 가능 — ad 백스톱과 동일한 사전 체크 수준으로 수용.
    // 원장 멱등·잔액==Σledger 불변식은 불변이고, 정당 유저는 캡에 안 닿으므로 실무 무해.
    let amountToGrant = amount;
    if (reason === 'achievement') {
      const used = await sumReason(userId, 'achievement');
      const remaining = ACH_LIFETIME_CAP - used;
      if (remaining <= 0) {
        return NextResponse.json({ ok: false, reason: 'cap' }, { status: 409 });
      }
      amountToGrant = Math.min(amount, remaining);
    }
    const r = await applyWallet(userId, amountToGrant, reason, body.idempotencyKey, body.ref);
    return NextResponse.json(r, { status: r.ok ? 200 : r.reason === 'error' ? 500 : 409 });
  } catch (e) { reportError(e, 'wallet/earn');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
