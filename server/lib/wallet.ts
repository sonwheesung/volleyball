// 다이아 지갑 — 원자적 적립/차감 (BACKEND_SYSTEM §4·§13.4 H2).
// 불변식: balance == sum(ledger.delta) 항상. 절대 음수 안 됨(spend는 balance 게이트).
// 동시성(H2): 서로 다른 동시 spend 2건이 각자 잔액 읽고 통과하는 초과지출을 막으려면 멱등키만으론 부족 —
//   트랜잭션 안에서 users 행을 FOR UPDATE로 잠가 직렬화한다. 멱등키는 "같은 키 재시도"를 dedupe.
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users, walletLedger } from '../db/schema';

export type WalletReason = 'purchase' | 'ad' | 'achievement' | 'camp' | 'refund' | 'adjust';

export type WalletResult =
  | { ok: true; balance: number; applied: boolean } // applied=false → 멱등 재시도(이미 처리됨, 재적용 안 함)
  | { ok: false; reason: 'insufficient' | 'no-user'; balance: number }
  | { ok: false; reason: 'error' };

/**
 * 지갑에 delta 를 원자적으로 적용. delta>0 적립, delta<0 차감.
 * @param idempotencyKey 스토어 transaction_id / AdMob SSV id / 업적id / (saveId,season,playerId,stat) 등 자연키
 */
export async function applyWallet(
  userId: string,
  delta: number,
  reason: WalletReason,
  idempotencyKey: string,
): Promise<WalletResult> {
  try {
    return await db.transaction(async (tx) => {
      // 1) 멱등 — 같은 키가 이미 있으면 그때의 잔액을 그대로 반환(재적용 금지)
      const dup = await tx
        .select({ balanceAfter: walletLedger.balanceAfter })
        .from(walletLedger)
        .where(eq(walletLedger.idempotencyKey, idempotencyKey))
        .limit(1);
      if (dup.length) return { ok: true as const, balance: dup[0].balanceAfter, applied: false };

      // 2) 행 잠금 — 동시 spend 직렬화(FOR UPDATE)
      const locked = await tx
        .select({ balance: users.balance })
        .from(users)
        .where(eq(users.id, userId))
        .for('update')
        .limit(1);
      if (!locked.length) return { ok: false as const, reason: 'no-user' as const, balance: 0 };

      const cur = locked[0].balance;
      const next = cur + delta;
      if (next < 0) return { ok: false as const, reason: 'insufficient' as const, balance: cur };

      // 3) 잔액 갱신 + 원장 기록(같은 트랜잭션 = 원자적)
      await tx.update(users).set({ balance: next }).where(eq(users.id, userId));
      await tx.insert(walletLedger).values({ userId, delta, reason, idempotencyKey, balanceAfter: next });
      return { ok: true as const, balance: next, applied: true };
    });
  } catch {
    // idempotencyKey unique 충돌(동시에 같은 키 2건)도 여기로 — 재조회로 수렴시킬 수 있으나 P1은 error 반환.
    return { ok: false as const, reason: 'error' as const };
  }
}

/** 현재 잔액 + 최근 원장 N건. */
export async function getWallet(userId: string, recent = 20) {
  const u = await db.select({ balance: users.balance }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u.length) return null;
  const ledger = await db
    .select()
    .from(walletLedger)
    .where(eq(walletLedger.userId, userId))
    .orderBy(walletLedger.createdAt)
    .limit(recent);
  return { balance: u[0].balance, ledger };
}

/** 개발용 고정 유저 보장(인증은 마일스톤3). provider=dev. */
export async function ensureDevUser(providerId = 'dev-user-1'): Promise<string> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.providerId, providerId))
    .limit(1);
  if (existing.length) return existing[0].id;
  const inserted = await db.insert(users).values({ provider: 'dev', providerId }).returning({ id: users.id });
  return inserted[0].id;
}
