// 다이아 지갑 — 원자적 적립/차감 (BACKEND_SYSTEM §4·§13.4 H2).
// 불변식: balance == sum(ledger.delta) 항상. 절대 음수 안 됨(spend는 balance 게이트).
// 동시성(H2): 서로 다른 동시 spend 2건이 각자 잔액 읽고 통과하는 초과지출을 막으려면 멱등키만으론 부족 —
//   트랜잭션 안에서 users 행을 FOR UPDATE로 잠가 직렬화한다. 멱등키는 "같은 키 재시도"를 dedupe.
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { users, walletLedger, projInfo } from '../db/schema';
import { PROJ_CODE } from './proj';
import { allowsNegativeBalance } from './econ';

export type WalletReason = 'purchase' | 'ad' | 'achievement' | 'camp' | 'refund' | 'adjust' | 'coupon' | 'welcome';

export type WalletResult =
  | { ok: true; balance: number; applied: boolean } // applied=false → 멱등 재시도(이미 처리됨, 재적용 안 함)
  | { ok: false; reason: 'insufficient' | 'no-user'; balance: number }
  | { ok: false; reason: 'error' };

/** drizzle 트랜잭션 핸들 타입(내부 타입 import 없이 유도) — applyWalletTx 주입용. */
export type WalletTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 지갑 delta 적용 — **주어진 트랜잭션 안에서**(쿠폰 redeem 등과 원자 합성용, §13.14 P0-A).
 * 멱등(중복키=재적용 안 함) + 잔액게이트(음수 거부). 호출부가 tx 소유·커밋/롤백. throw 없이 typed 반환.
 * @param idempotencyKey 스토어 transaction_id / SSV id / 업적id / camp키 / coupon:<userId>:<couponId> 등 자연키
 */
export async function applyWalletTx(
  tx: WalletTx,
  userId: string,
  delta: number,
  reason: WalletReason,
  idempotencyKey: string,
  ref?: string,
): Promise<WalletResult> {
  // 1) 멱등 — 같은 (proj, 키)가 이미 있으면 재적용 안 함. 단 잔액은 원장의 그때 balanceAfter(스냅샷)가
  //    아니라 **현재 지갑 잔액**을 반환한다. balanceAfter는 그 거래 시점 값이라 이후 다른 거래(지출·적립)가
  //    있으면 stale → 클라가 옛 잔액으로 되돌아가 split-brain 표시(에뮬 재현 2026-07-06: 환영 +1000 후
  //    캠프 −300(구 −900)으로 잔액이 줄었는데, 화면 재진입 시 환영 멱등재시도가 옛 1000을 반환해 100을 덮어씀). 현재값으로 수렴.
  const dup = await tx
    .select({ id: walletLedger.id })
    .from(walletLedger)
    .where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.idempotencyKey, idempotencyKey)))
    .limit(1);
  if (dup.length) {
    const u = await tx.select({ balance: users.balance }).from(users).where(eq(users.id, userId)).limit(1);
    return { ok: true as const, balance: u.length ? u[0].balance : 0, applied: false };
  }

  // 2) 행 잠금 — 동시 spend 직렬화(FOR UPDATE)
  const locked = await tx.select({ balance: users.balance }).from(users).where(eq(users.id, userId)).for('update').limit(1);
  if (!locked.length) return { ok: false as const, reason: 'no-user' as const, balance: 0 };

  const cur = locked[0].balance;
  const next = cur + delta;
  // 잔액게이트 = **차감 전용**(§13.17 P0-1 정정 2026-07-16 — delta 부호 미구분 트랩). delta<0(차감)이 음수로 떨어질 때만 거부.
  //   · 차감(delta<0, camp): next<0이면 'insufficient' — spend 게이트는 절대 약화 안 됨(다 써버린 고래는 더 못 씀 §13.4 H1).
  //   · 환불(delta<0, refund): allowsNegativeBalance로 게이트 우회 — 음수 허용(클로백).
  //   · 적립(delta>0, ad/achievement/coupon/welcome/adjust): **잔액이 음수여도 항상 통과**(부채 상환 경로). 환불로 음수가 된
  //     유저가 광고/업적/쿠폰으로 빚을 갚아 0으로 복귀 가능 — 이걸 막던 게 음수 탈출 불가 트랩(적립까지 거부)이었음.
  // balance==Σledger 불변식은 방향 무관 유지(적립은 잔액을 0쪽으로 올릴 뿐 불변식 안 깸).
  if (delta < 0 && next < 0 && !allowsNegativeBalance(reason)) return { ok: false as const, reason: 'insufficient' as const, balance: cur };

  // 3) 잔액 갱신 + 원장 기록(같은 트랜잭션 = 원자적)
  await tx.update(users).set({ balance: next }).where(eq(users.id, userId));
  await tx.insert(walletLedger).values({ projCode: PROJ_CODE, userId, delta, reason, ref, idempotencyKey, balanceAfter: next });
  return { ok: true as const, balance: next, applied: true };
}

/**
 * 지갑에 delta 를 원자적으로 적용(자체 트랜잭션). delta>0 적립, delta<0 차감.
 * applyWalletTx를 얇게 감싸 재사용(중복로직 0). earn/spend 라우트용.
 */
export async function applyWallet(
  userId: string,
  delta: number,
  reason: WalletReason,
  idempotencyKey: string,
  ref?: string,
): Promise<WalletResult> {
  try {
    return await db.transaction((tx) => applyWalletTx(tx, userId, delta, reason, idempotencyKey, ref));
  } catch {
    // 동시 same-key 경쟁 dedup 수렴(2026-07-17, prod 샌드박스 실결제 실측 — RC 웹훅↔confirm 폴백이 ~100ms 내 동시 도착해
    //   진 쪽 트랜잭션이 ledger_proj_idem_uniq 유니크 충돌로 throw → 매 결제 발생). 무조건 error로 끝내지 않고 **재조회로 dedup 판정**:
    //   진 쪽이 진 이유가 "경쟁자가 이미 같은 키를 커밋"이면 그건 오류가 아니라 멱등 재시도와 동형 → applyWalletTx의 dup 경로와
    //   같은 형태로 수렴시킨다(confirm이 지면 500 대신 200 성공 UX / 웹훅이 지면 RC 불필요 재시도 제거). 돈은 이미 정확(이중지급 0).
    try {
      const dup = await db
        .select({ id: walletLedger.id })
        .from(walletLedger)
        .where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.idempotencyKey, idempotencyKey)))
        .limit(1);
      if (dup.length) {
        // 경쟁자가 이미 지급 완료 → 현재 잔액 반환(balanceAfter 스냅샷 아님 — split-brain 방지, applyWalletTx dup 경로와 동일 규칙).
        const u = await db.select({ balance: users.balance }).from(users).where(eq(users.id, userId)).limit(1);
        return { ok: true as const, balance: u.length ? u[0].balance : 0, applied: false };
      }
    } catch {
      // 재조회 자체 실패(DB 다운 등) → 유니크 충돌이 아닌 오류를 성공으로 위장하지 않는다.
      return { ok: false as const, reason: 'error' as const };
    }
    // 유니크 충돌이 아닌 진짜 오류(DB 다운·FK 등 — 키 행이 없음) → 현행대로 error.
    return { ok: false as const, reason: 'error' as const };
  }
}

/** 오늘(UTC 캘린더 데이) 특정 reason 원장 건수 — 광고 하루 상한 서버 백스톱(§13.12). */
export async function countReasonToday(userId: string, reason: WalletReason): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(walletLedger)
    .where(
      and(
        eq(walletLedger.projCode, PROJ_CODE),
        eq(walletLedger.userId, userId),
        eq(walletLedger.reason, reason),
        sql`${walletLedger.createdAt} >= date_trunc('day', now())`,
      ),
    );
  return rows[0]?.n ?? 0;
}

/** 특정 reason **가장 최근** 원장 행의 시각(ms) — 광고 쿨다운 서버 백스톱의 진실(§13.12, 2026-07-17). 없으면 null.
 *  countReasonToday(하루 건수)와 짝: 그건 하루 상한, 이건 최근 1건 시각(**날짜 무관** — 자정 넘는 쿨다운도 정확). ledger_user_idx 활용. */
export async function lastReasonAt(userId: string, reason: WalletReason): Promise<number | null> {
  const rows = await db
    .select({ lastMs: sql<string | null>`(extract(epoch from max(${walletLedger.createdAt})) * 1000)::bigint` })
    .from(walletLedger)
    .where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.userId, userId), eq(walletLedger.reason, reason)));
  const r = rows[0];
  return r?.lastMs != null ? Number(r.lastMs) : null;
}

/** 특정 reason 원장 delta 합계(평생·프로젝트/유저 스코프) — 업적 평생합 백스톱의 **서버 진실**(§13.12 H3).
 *  countReasonToday(건수)와 짝: 그건 광고 하루 상한, 이건 업적 평생합. 원장이 진실이라 세이브 리셋으로 못 우회. */
export async function sumReason(userId: string, reason: WalletReason): Promise<number> {
  const rows = await db
    .select({ s: sql<number>`coalesce(sum(${walletLedger.delta}), 0)::int` })
    .from(walletLedger)
    .where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.userId, userId), eq(walletLedger.reason, reason)));
  return rows[0]?.s ?? 0;
}

/** 오늘(UTC) 광고 적립 상태 — 횟수 + 마지막 시각(ms). 광고 쿨다운/캡의 **서버 진실**(§13.19 — 로컬 리셋으로 못 우회). */
export async function adStatusToday(userId: string): Promise<{ count: number; lastAtMs: number | null }> {
  const rows = await db
    .select({
      n: sql<number>`count(*)::int`,
      lastMs: sql<string | null>`(extract(epoch from max(${walletLedger.createdAt})) * 1000)::bigint`,
    })
    .from(walletLedger)
    .where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.userId, userId), eq(walletLedger.reason, 'ad'), sql`${walletLedger.createdAt} >= date_trunc('day', now())`));
  const r = rows[0];
  return { count: r?.n ?? 0, lastAtMs: r?.lastMs != null ? Number(r.lastMs) : null };
}

/** 현재 잔액 + 최근 원장 N건 + 오늘 광고 상태(쿨다운/캡 서버 진실). */
export async function getWallet(userId: string, recent = 20) {
  const u = await db.select({ balance: users.balance }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u.length) return null;
  const ledger = await db
    .select()
    .from(walletLedger)
    .where(eq(walletLedger.userId, userId))
    .orderBy(walletLedger.createdAt)
    .limit(recent);
  const adToday = await adStatusToday(userId);
  return { balance: u[0].balance, ledger, adToday };
}

/** 이 게임(PROJ_CODE)의 proj_info 행 보장 — FK 대상. 최초 1회만 실제 insert. */
export async function ensureProj(): Promise<void> {
  await db
    .insert(projInfo)
    .values({ projCode: PROJ_CODE, name: PROJ_CODE })
    .onConflictDoNothing({ target: projInfo.projCode });
}

/** (proj_code, provider, providerId) 유저 upsert → id. 인증(auth/login·resolveUserId)·익명 폴백 공용. */
export async function ensureUser(providerId: string, provider = 'dev', displayName?: string): Promise<string> {
  await ensureProj(); // FK 부모 보장(최초 1회 실제 insert, 이후 no-op)
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.projCode, PROJ_CODE), eq(users.provider, provider), eq(users.providerId, providerId)))
    .limit(1);
  if (existing.length) return existing[0].id;
  const inserted = await db
    .insert(users)
    .values({ projCode: PROJ_CODE, provider, providerId, displayName })
    .returning({ id: users.id });
  return inserted[0].id;
}

/** 개발용 고정 유저 보장(익명 폴백 — Bearer 없을 때). provider=dev. */
export async function ensureDevUser(providerId = 'dev-user-1'): Promise<string> {
  return ensureUser(providerId, 'dev');
}

/** (proj, provider, providerId) 라이브 조회 — **생성 안 함**. 없으면 null. deletedAt은 호출부가 판정(AUTH §7.2·§8.1).
 *  requireUserId/resolveUserId(토큰→라이브 유저)·login(신규 여부 판정)·계정삭제(멱등)에서 공용. */
export async function findUserRow(providerId: string, provider = 'dev'): Promise<{ id: string; deletedAt: Date | null } | null> {
  const rows = await db
    .select({ id: users.id, deletedAt: users.deletedAt })
    .from(users)
    .where(and(eq(users.projCode, PROJ_CODE), eq(users.provider, provider), eq(users.providerId, providerId)))
    .limit(1);
  return rows.length ? rows[0] : null;
}

/** 신규 소셜 유저 생성 — 연령 확인(ageConfirmedAt) 기록(AUTH §8). login 라우트 전용(연령 게이트 통과 후).
 *  ensureUser(저수준 upsert)와 분리: 게이트가 걸린 "진짜 가입"만 이 경로로 ageConfirmedAt을 박는다. */
export async function createUser(providerId: string, provider: string, ageConfirmedAt: Date, displayName?: string): Promise<string> {
  await ensureProj(); // FK 부모 보장
  const inserted = await db
    .insert(users)
    .values({ projCode: PROJ_CODE, provider, providerId, displayName, ageConfirmedAt })
    .returning({ id: users.id });
  return inserted[0].id;
}

/** 탈퇴 — 가명처리 소프트삭제(AUTH §7.1). providerId 비복원 파기(재로그인 매칭 불가+UNIQUE 슬롯 해제)·비필수 PII null·
 *  deletedAt 마킹. **잔액·원장은 보존**(법정 5년). 멱등: 이미 삭제면 false, 이번에 삭제하면 true. */
export async function pseudonymizeUser(userId: string): Promise<boolean> {
  const res = await db
    .update(users)
    .set({
      deletedAt: sql`now()`,
      providerId: `deleted:${userId}`, // 토움스톤 — 원본 sub 비복원 파기(재로그인=새 계정)
      displayName: null,
      platform: null,
      osVersion: null,
      appVersion: null,
    })
    .where(and(eq(users.id, userId), isNull(users.deletedAt))) // 멱등 — 이미 삭제된 행은 재처리 안 함
    .returning({ id: users.id });
  return res.length > 0;
}
