// POST /api/coupon/redeem — 쿠폰 사용. body: { code }. Bearer→userId 귀속.
// 서버 진실: redeemCoupon이 단일 트랜잭션으로 검증+지급(§13.14). 앱은 성공 후 syncWallet로만 캐시 갱신.
import { NextResponse } from 'next/server';
import { reportError } from '../../../../lib/observability';
import { redeemCoupon } from '../../../../lib/coupon';
import { resolveUserId } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { code?: string };
    if (!body.code || typeof body.code !== 'string') {
      return NextResponse.json({ ok: false, reason: 'invalid' }, { status: 400 });
    }
    const userId = await resolveUserId(req);
    const r = await redeemCoupon(userId, body.code);
    return NextResponse.json(r, { status: r.ok ? 200 : r.reason === 'error' ? 500 : 409 });
  } catch (e) { reportError(e, 'coupon/redeem');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
