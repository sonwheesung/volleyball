// /api/admin/coupon — 쿠폰 발급(POST)·목록(GET). requireAdmin(fail-closed §13.15).
import { NextResponse } from 'next/server';
import { reportError } from '../../../../lib/observability';
import { desc, eq } from 'drizzle-orm';
import { db } from '../../../../db';
import { coupons } from '../../../../db/schema';
import { isAdmin } from '../../../../lib/admin';
import { normalizeCode } from '../../../../lib/coupon';
import { ensureProj } from '../../../../lib/wallet';
import { PROJ_CODE } from '../../../../lib/proj';

export const dynamic = 'force-dynamic';

const REWARD_CAP = 100000; // 발급 상한(오타 999999 방지, §13.15)

export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const b = (await req.json()) as { code?: string; rewardDiamonds?: number; targetUserId?: string | null; startsAt?: string; endsAt?: string | null };
    const code = normalizeCode(b.code ?? '');
    const reward = Math.floor(Number(b.rewardDiamonds));
    if (!code || !Number.isFinite(reward) || reward <= 0 || reward > REWARD_CAP) {
      return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    }
    const startsAt = b.startsAt ? new Date(b.startsAt) : undefined; // 미지정=DB defaultNow()(클럭 일관)
    const endsAt = b.endsAt ? new Date(b.endsAt) : null;
    if ((startsAt && Number.isNaN(startsAt.getTime())) || (endsAt && Number.isNaN(endsAt.getTime()))) {
      return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    }
    await ensureProj(); // FK 부모 보장
    try {
      const ins = await db
        .insert(coupons)
        .values({ projCode: PROJ_CODE, code, rewardDiamonds: reward, targetUserId: b.targetUserId || null, startsAt, endsAt, disabled: false })
        .returning({ id: coupons.id });
      return NextResponse.json({ ok: true, id: ins[0].id, code });
    } catch (e) { reportError(e, 'admin/coupon');
      return NextResponse.json({ ok: false, reason: 'duplicate' }, { status: 409 }); // UNIQUE(code) 충돌 등 → 4xx(500 아님)
    }
  } catch (e) { reportError(e, 'admin/coupon');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const rows = await db.select().from(coupons).where(eq(coupons.projCode, PROJ_CODE)).orderBy(desc(coupons.createdAt)).limit(200);
    return NextResponse.json({ ok: true, coupons: rows });
  } catch (e) { reportError(e, 'admin/coupon');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
