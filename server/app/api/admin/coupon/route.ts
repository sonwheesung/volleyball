// /api/admin/coupon — 쿠폰 발급(POST)·목록(GET)·수정(PATCH)·삭제(DELETE). requireAdmin(fail-closed §13.15).
import { NextResponse } from 'next/server';
import { reportError } from '../../../../lib/observability';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../../../db';
import { coupons, users } from '../../../../db/schema';
import { isAdmin } from '../../../../lib/admin';
import { normalizeCode } from '../../../../lib/coupon';
import { ensureProj } from '../../../../lib/wallet';
import { PROJ_CODE } from '../../../../lib/proj';
import { normalizeEndsAt } from '../../../../lib/dates'; // date-only endsAt KST 정규화(공지와 공용, C2/§13.15)

export const dynamic = 'force-dynamic';

const REWARD_CAP = 100000; // 발급 상한(오타 999999 방지, §13.15)

/** 개인 쿠폰 대상이 **이 게임(proj)의 유저**인가 — POST·PATCH 공용(R3). 잘못된 uuid 형식은 select가 throw할 수 있어
 *  try로 감싸 실패도 '없음'과 동일 처리(no-such-user 400). 없으면 FK 위반이 catch에서 'duplicate'로 위장되던 것도 차단(C3). */
async function targetInProj(targetUserId: string): Promise<boolean> {
  try {
    const u = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.projCode, PROJ_CODE), eq(users.id, targetUserId))).limit(1);
    return u.length > 0;
  } catch { return false; }
}

export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const b = (await req.json()) as { code?: string; rewardDiamonds?: number; targetUserId?: string | null; startsAt?: string; endsAt?: string | null };
    const code = normalizeCode(b.code ?? ''); // 대문자+trim (매칭은 대소문자 무관 — redeem도 normalizeCode)
    const reward = Math.floor(Number(b.rewardDiamonds));
    // 코드 = 자유 문자열 1~30자(welcome·volleyball·SEASON2627 등). 대소문자 무관(normalizeCode 대문자화)
    if (!code || code.length > 30 || !Number.isFinite(reward) || reward <= 0 || reward > REWARD_CAP) {
      return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    }
    const startsAt = b.startsAt ? new Date(b.startsAt) : undefined; // 미지정=DB defaultNow()(클럭 일관)
    const endsAt = b.endsAt ? normalizeEndsAt(b.endsAt) : null; // date-only는 KST 그날 23:59:59.999로(C2, 공지와 통일)
    if ((startsAt && Number.isNaN(startsAt.getTime())) || (endsAt && Number.isNaN(endsAt.getTime()))) {
      return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    }
    await ensureProj(); // FK 부모 보장
    // 개인 쿠폰 targetUserId는 insert 전에 존재 확인 — 없으면 FK 위반이 catch에서 'duplicate'로 위장되던 것 차단(C3).
    // 잘못된 uuid 형식은 select 자체가 throw할 수 있어 try로 감싸 실패도 '없음'과 동일 처리(no-such-user 400).
    // projCode 스코프 필수(§13.2 멀티게임 격리, R3 2026-07-24) — 타 게임 유저를 개인 쿠폰 대상으로 삼아 외래 참조 행이
    //   생기던 결함(수신 GET은 proj 스코프라 열람 불가 = 죽은 행). 없으면 기존 실패 경로 그대로 400 no-such-user.
    if (b.targetUserId && !(await targetInProj(b.targetUserId))) {
      return NextResponse.json({ ok: false, reason: 'no-such-user' }, { status: 400 });
    }
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

// 수정 — 보상/종료일/활성여부만(코드는 UNIQUE 키라 불변). 대상(target)도 변경 가능.
export async function PATCH(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const b = (await req.json()) as { id?: string; rewardDiamonds?: number; endsAt?: string | null; disabled?: boolean; targetUserId?: string | null };
    if (!b.id) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    const upd: Record<string, unknown> = {};
    if (b.rewardDiamonds !== undefined) { const r = Math.floor(Number(b.rewardDiamonds)); if (!Number.isFinite(r) || r <= 0 || r > REWARD_CAP) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 }); upd.rewardDiamonds = r; }
    if (b.endsAt !== undefined) { const d = b.endsAt ? normalizeEndsAt(b.endsAt) : null; if (d && Number.isNaN(d.getTime())) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 }); upd.endsAt = d; } // date-only KST 정규화(C2)
    if (typeof b.disabled === 'boolean') upd.disabled = b.disabled;
    // 대상 변경도 POST와 같은 게이트(R3 형제 — PATCH엔 존재 검증 자체가 없어 타 게임 유저로 바꿔치기가 통과했다).
    // null(전체 쿠폰으로 전환)은 검증 대상 아님.
    if (b.targetUserId !== undefined) {
      if (b.targetUserId && !(await targetInProj(b.targetUserId))) return NextResponse.json({ ok: false, reason: 'no-such-user' }, { status: 400 });
      upd.targetUserId = b.targetUserId || null;
    }
    if (Object.keys(upd).length === 0) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    const r = await db.update(coupons).set(upd).where(and(eq(coupons.projCode, PROJ_CODE), eq(coupons.id, b.id))).returning({ id: coupons.id });
    if (!r.length) return NextResponse.json({ ok: false, reason: 'not-found' }, { status: 404 });
    return NextResponse.json({ ok: true, id: r[0].id });
  } catch (e) { reportError(e, 'admin/coupon');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}

// 삭제 — 사용 기록(FK) 있으면 삭제 불가(감사 보존) → 'has-redemptions'로 안내(비활성화 권장).
export async function DELETE(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
  try {
    const r = await db.delete(coupons).where(and(eq(coupons.projCode, PROJ_CODE), eq(coupons.id, id))).returning({ id: coupons.id });
    if (!r.length) return NextResponse.json({ ok: false, reason: 'not-found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch { // FK 위반(coupon_redemptions 참조) 등 — 사용된 쿠폰은 하드삭제 대신 비활성화
    return NextResponse.json({ ok: false, reason: 'has-redemptions' }, { status: 409 });
  }
}
