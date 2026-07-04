// GET /api/admin/coupon/redemptions?couponId= — 쿠폰 사용 내역(누가·언제 썼나). requireAdmin(fail-closed §13.15).
import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../../../../db';
import { couponRedemptions, users } from '../../../../../db/schema';
import { isAdmin } from '../../../../../lib/admin';
import { PROJ_CODE } from '../../../../../lib/proj';
import { reportError } from '../../../../../lib/observability';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const couponId = new URL(req.url).searchParams.get('couponId');
    if (!couponId) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    const rows = await db
      .select({ userId: couponRedemptions.userId, name: users.displayName, provider: users.provider, redeemedAt: couponRedemptions.redeemedAt })
      .from(couponRedemptions)
      .leftJoin(users, eq(couponRedemptions.userId, users.id))
      .where(and(eq(couponRedemptions.projCode, PROJ_CODE), eq(couponRedemptions.couponId, couponId)))
      .orderBy(desc(couponRedemptions.redeemedAt))
      .limit(200);
    return NextResponse.json({ ok: true, redemptions: rows });
  } catch (e) {
    reportError(e, 'admin/coupon/redemptions');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
