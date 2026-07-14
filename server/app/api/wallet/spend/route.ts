// POST /api/wallet/spend — 다이아 차감(전지훈련). body: { reason, idempotencyKey, ref? }
// online-first: 클라는 이 응답(서버 확정) 후에만 차감을 반영한다(§2). **금액은 서버 권위**(§13.12 P0-2):
// camp=−300 서버상수(클라 amount 무시 — amount=1 보내도 300 강제, 2026-07-06 인하 900→300). reason 화이트리스트로 camp만 허용.
import { NextResponse } from 'next/server';
import { reportError } from '../../../../lib/observability';
import { applyWallet } from '../../../../lib/wallet';
import { spendAmount, isSpendReason } from '../../../../lib/econ';
import { requireUserId } from '../../../../lib/auth';
import { walletIdemKey } from '../../../../lib/walletKey';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { reason?: string; idempotencyKey?: string; ref?: string };
    const reason = String(body.reason ?? '');
    if (!isSpendReason(reason) || !body.idempotencyKey) {
      return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    }
    const amount = spendAmount(reason); // 서버 권위(−300 강제)
    if (amount === null || amount <= 0) {
      return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    }
    // 익명 폴백 금지(#6·§13.17 P0-5) — 유효 Bearer 없으면 401(엉뚱한 지갑 차감·split-brain 차단).
    const userId = await requireUserId(req);
    if (!userId) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
    // 저장키는 서버 userId로 네임스페이스(#5 교차유저 선점 차단).
    const idemKey = walletIdemKey(userId, body.idempotencyKey);
    const r = await applyWallet(userId, -amount, reason, idemKey, body.ref);
    return NextResponse.json(r, { status: r.ok ? 200 : r.reason === 'error' ? 500 : 409 });
  } catch (e) { reportError(e, 'wallet/spend');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
