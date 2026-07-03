// 쿠폰 사용 (BACKEND_SYSTEM §13.14) — **단일 트랜잭션(P0-A)**: 검증 + redemption INSERT + applyWalletTx 원자화.
// 두 트랜잭션을 이으면 "기록만 남고 미지급" 크래시 창이 생김 → 하나의 db.transaction으로 묶는다.
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { coupons, couponRedemptions, users } from '../db/schema';
import { applyWalletTx } from './wallet';
import { PROJ_CODE } from './proj';

export type RedeemResult =
  | { ok: true; reward: number; balance: number }
  | { ok: false; reason: 'invalid' | 'expired' | 'used' | 'not-eligible' | 'error' };

/** 쿠폰 코드 정규화 — 대문자+trim(대소문자·공백 혼동 방지). UNIQUE(proj, code)도 이 정규형 기준. */
export const normalizeCode = (code: string): string => (code ?? '').trim().toUpperCase();

/**
 * 쿠폰 사용. 검증 순서(§13.14): 존재 → disabled → 기간 → target → 계정유효 → redemption INSERT(충돌=이미사용) → 지급.
 * target 불일치는 'invalid'로 뭉뚱그림(남의 개인쿠폰 존재 은폐). 낙관적 반영은 앱이 안 함(성공 후 syncWallet).
 */
export async function redeemCoupon(userId: string, rawCode: string): Promise<RedeemResult> {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, reason: 'invalid' };
  try {
    return await db.transaction(async (tx) => {
      // ① 코드 조회(proj 스코프)
      const rows = await tx.select().from(coupons).where(and(eq(coupons.projCode, PROJ_CODE), eq(coupons.code, code))).limit(1);
      if (!rows.length) return { ok: false as const, reason: 'invalid' as const };
      const c = rows[0];
      // ② disabled
      if (c.disabled) return { ok: false as const, reason: 'invalid' as const };
      // ③ 기간 — 서버 시각 기준(now ∈ [starts, ends(null=무기한)]). 시작 전/종료 후 모두 'expired'로 안내
      const nowMs = Date.now();
      if (c.startsAt.getTime() > nowMs) return { ok: false as const, reason: 'expired' as const };
      if (c.endsAt && c.endsAt.getTime() < nowMs) return { ok: false as const, reason: 'expired' as const };
      // ④ target — 개인 쿠폰이면 소유자만(불일치는 존재 은폐 위해 'invalid')
      if (c.targetUserId && c.targetUserId !== userId) return { ok: false as const, reason: 'invalid' as const };
      // ⑤ 계정 유효 — 소프트삭제 계정 거부
      const u = await tx.select({ deletedAt: users.deletedAt }).from(users).where(eq(users.id, userId)).limit(1);
      if (!u.length || u[0].deletedAt) return { ok: false as const, reason: 'not-eligible' as const };
      // ⑥ 사용기록 INSERT — UNIQUE(proj,coupon,user) 충돌 = 이미 사용(동시 2건도 여기서 직렬화·차단)
      const ins = await tx
        .insert(couponRedemptions)
        .values({ projCode: PROJ_CODE, couponId: c.id, userId })
        .onConflictDoNothing({ target: [couponRedemptions.projCode, couponRedemptions.couponId, couponRedemptions.userId] })
        .returning({ id: couponRedemptions.id });
      if (!ins.length) return { ok: false as const, reason: 'used' as const };
      // ⑦ 지급 — 같은 트랜잭션 안에서(원자적). 실패 시 throw로 전체 롤백(redemption도 취소)
      const w = await applyWalletTx(tx, userId, c.rewardDiamonds, 'coupon', `coupon:${userId}:${c.id}`, code);
      if (!w.ok) throw new Error('wallet-fail:' + w.reason);
      return { ok: true as const, reward: c.rewardDiamonds, balance: w.balance };
    });
  } catch {
    return { ok: false as const, reason: 'error' as const };
  }
}
