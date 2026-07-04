// POST /api/purchase/confirm — 클라 구매 resolve 후 폴백(BACKEND_SYSTEM §13.18). 웹훅 지연·유실 시 "돈 내고 0개" 방지.
// body: { storeTxnId, productId }. requireUserId(Bearer). RC REST 재검증 → applyWallet(같은 키) → 웹훅과 dedup 수렴.
import { NextResponse } from 'next/server';
import { requireUserId } from '../../../../lib/auth';
import { applyWallet } from '../../../../lib/wallet';
import { rcVerifyPurchase, purchaseKey, recordPurchaseRevenue } from '../../../../lib/revenuecat';
import { reportError } from '../../../../lib/observability';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const userId = await requireUserId(req); // 익명 폴백 금지(진짜 Bearer sub만) — §13.17 패턴
  if (!userId) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const b = (await req.json()) as { storeTxnId?: string; productId?: string };
    const storeTxnId = String(b.storeTxnId ?? '').trim();
    const productId = String(b.productId ?? '').trim();
    if (!storeTxnId || !productId) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });

    const v = await rcVerifyPurchase(userId, storeTxnId, productId); // 서버 권위 재검증
    if (!v.ok) return NextResponse.json({ ok: false, reason: v.reason }, { status: v.reason === 'rc-unconfigured' ? 503 : 402 });

    const r = await applyWallet(userId, v.diamonds, 'purchase', purchaseKey(userId, storeTxnId), productId);
    if (!r.ok) return NextResponse.json({ ok: false, reason: r.reason }, { status: 500 });
    if (r.applied) await recordPurchaseRevenue(null, v.diamonds); // 매출(KRW)는 웹훅이 채움 — confirm은 다이아만(이중집계 방지 위해 KRW null)
    return NextResponse.json({ ok: true, applied: r.applied, balance: r.balance });
  } catch (e) {
    reportError(e, 'purchase/confirm');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
