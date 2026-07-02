// POST /api/wallet/earn — 다이아 적립(광고/업적). body: { amount?, reason, idempotencyKey, ref? }
// 멱등키(§4)로 이중지급 차단 + **금액은 서버 권위**(§13.12 P0-2): ad=+50 서버상수·achievement만 클라값(캡 5000).
// reason 화이트리스트(§13.12) — 'purchase'/'coupon' 사칭 차단. ad는 하루 8회 서버 백스톱.
import { NextResponse } from 'next/server';
import { applyWallet } from '../../../../lib/wallet';
import { countReasonToday } from '../../../../lib/wallet';
import { earnAmount, isEarnReason, AD_DAILY_CAP } from '../../../../lib/econ';
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
    const r = await applyWallet(userId, amount, reason, body.idempotencyKey, body.ref);
    return NextResponse.json(r, { status: r.ok ? 200 : r.reason === 'error' ? 500 : 409 });
  } catch {
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
