// POST /api/wallet/spend — 다이아 차감(전지훈련). body: { amount>0, reason, idempotencyKey }
// online-first: 클라는 이 응답(서버 확정) 후에만 차감을 반영한다(§2).
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
    const r = await applyWallet(userId, -amount, body.reason ?? 'camp', body.idempotencyKey);
    return NextResponse.json(r, { status: r.ok ? 200 : r.reason === 'error' ? 500 : 409 });
  } catch {
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
