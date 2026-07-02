// POST /api/wallet/earn — 다이아 적립(광고/업적/구매). body: { amount>0, reason, idempotencyKey }
// 멱등키(SSV id·업적id·transaction_id)로 이중지급 차단(§4).
import { NextResponse } from 'next/server';
import { applyWallet, type WalletReason } from '../../../../lib/wallet';
import { resolveUserId } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { amount?: number; reason?: WalletReason; idempotencyKey?: string };
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || !body.idempotencyKey) {
      return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    }
    const userId = await resolveUserId(req);
    const r = await applyWallet(userId, amount, body.reason ?? 'ad', body.idempotencyKey);
    return NextResponse.json(r, { status: r.ok ? 200 : 500 });
  } catch {
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
