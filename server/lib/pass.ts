// 출석 패스 + 월 1+1 (ATTENDANCE_PASS_SYSTEM §A·§B·§C) — 서버 재화 레이어. 시드/리플레이/세이브 무접근(§6).
// 패스 소유·창 진실 = attendance_passes. 다이아 이동(일일 수령·1+1 보너스·환불 회수) = wallet_ledger(append-only, applyWalletTx 멱등).
//
// 핵심 불변식·블로커:
//  · B4(§2.1): grantPass가 패스 행 생성과 **같은 트랜잭션**에서 slot 0(첫 100💎)을 직접 지급(claim 경유 아님) → 웹훅/confirm 선후 무관 28회 보장.
//  · B1(§4.3.1): 환불이 구매보다 먼저 도착 → refunded tombstone 선삽입(UNIQUE(proj,txn)) → 뒤늦은 grantPass는 활성화 금지(유령 활성 0).
//  · B2(§4.3.2): 클로백 = 단일 트랜잭션(패스 행 FOR UPDATE 잠금 → status=refunded → Σ(pass_daily where ref=txn) → −Σ 삽입). claim과 잠금으로 상호배제(Σ 정합).
//  · B3(§2.3.1): claim 창 = start ≤ 오늘(리셋보정) ≤ end+GRACE. 지급 dayIndex = [max(0, off−G+1) … min(27, off)](만료 후 27 클램프).
//  · Q1(§2.2): 중첩 구매 = 큐잉(활성 1 + 예약 1, 깊이 상한 1). 예약 start는 활성화 때 max(오늘, 앵커 end+1) 파생(공백 방지). 초과 = ops 알림·수동.
//  · R1a(§2.2a): 앞 패스 조기 종료(환불) 시 뒤 큐 패스 start 재계산(공백 방지).
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { users, walletLedger, attendancePasses } from '../db/schema';
import { PROJ_CODE } from './proj';
import { applyWalletTx, applyWallet, ensureProj, type WalletResult, type WalletTx } from './wallet';
import { productDiamonds, isPassProduct, DIAMOND_PRODUCTS } from './products';
import { purchaseKey } from './revenuecat';
import {
  PASS_DAILY_REWARD, PASS_DURATION_DAYS, PASS_GRACE_DAYS, PASS_RESET_HOUR_KST,
} from './econ';
import { todayKstResetAdjusted, kstYearMonth, addDays, diffDays, maxDateStr } from './dates';

// ── 멱등키·ref 빌더(§2.5·§3.4) ──
export const passDailyKey = (userId: string, passId: string, dayIndex: number) => `pass_daily:${userId}:${passId}:${dayIndex}`;
export const passRefundKey = (userId: string, storeTxnId: string) => `refund_pass:${userId}:${storeTxnId}`;
/** 1+1 월-멱등키 = 월×팩(그 달 첫 구매 grant만 성공). R3: 샌드박스는 별도 스코프(:sandbox 접미)로 prod 월키 미소진. */
export const bonus1p1Key = (userId: string, productId: string, yearMonth: string, sandbox: boolean) =>
  `iap_bonus_1p1:${userId}:${productId}:${yearMonth}${sandbox ? ':sandbox' : ''}`;
export const bonusRefundKey = (userId: string, storeTxnId: string) => `refund_bonus:${userId}:${storeTxnId}`;

/** 1+1 프로모 서버 게이트(§7 출시 게이팅) — env PROMO_1P1_ENABLED==='1'|'true'일 때만 보너스 지급. **요청 시점 read**(모듈 캐시 금지).
 *  기본 off(fail-closed·미출시): 서버 배포가 앱 뱃지(PROMO_1P1_ENABLED 클라 플래그)와 동기화될 때 켠다. 판단 보고 항목(§7 서버 대응 신설). */
export function promo1p1Enabled(): boolean {
  const v = process.env.PROMO_1P1_ENABLED;
  return v === '1' || v === 'true' || v === 'all';
}

// ── 순수 창 산술(§2.1·§2.3.1 · 가드 _dv_pass가 직접 테스트, DB 무의존) ──

/** 패스 창: start(구매일 리셋보정) → end = start + (DURATION-1) = start+27(포함, 28슬롯 = 최대 2,800💎). */
export function passWindow(startDate: string): { startDate: string; endDate: string } {
  return { startDate, endDate: addDays(startDate, PASS_DURATION_DAYS - 1) };
}

/** claim 대상 dayIndex 후보(B3) — start≤today≤end+GRACE 밖이면 []. 지급 범위 [max(0, off−G+1) … min(27, off)].
 *  · 정상: off=k → k만(당일). · 유예: 만료+1일(off=28,G=3) → [26,27]. · 만료+G+1일(off>27+G) → [](미지급).
 *  실제 지급은 멱등키(user×pass×dayIndex)가 이미 받은 슬롯을 dedupe → 후보 전부 시도해도 이중지급 0. */
export function claimableDayIndexes(startDate: string, today: string): number[] {
  const off = diffDays(startDate, today);
  const last = PASS_DURATION_DAYS - 1; // 27
  if (off < 0) return [];                    // 아직 시작 전
  if (off > last + PASS_GRACE_DAYS) return []; // 유예 초과(gate)
  const lo = Math.max(0, off - PASS_GRACE_DAYS + 1);
  const hi = Math.min(last, off);
  const out: number[] = [];
  for (let i = lo; i <= hi; i++) out.push(i);
  return out;
}

/** 활성 패스가 오늘(리셋보정) 기준 claim 창(start≤today≤end+GRACE) 안인가 — 만료 후 유예 포함(B3). */
export function isWithinClaimWindow(startDate: string, today: string): boolean {
  const off = diffDays(startDate, today);
  return off >= 0 && off <= (PASS_DURATION_DAYS - 1) + PASS_GRACE_DAYS;
}

type PassRow = typeof attendancePasses.$inferSelect;

// ── grant(구매 지급) ──

export type GrantPassResult =
  | { ok: true; outcome: 'activated' | 'queued' | 'queued-overflow' | 'dup' | 'tombstoned-skip'; passId?: string }
  | { ok: false; reason: string };

/**
 * 패스 grant(단일 트랜잭션) — 웹훅/confirm 공유. storeTxnId UNIQUE로 두 경로 dedupe.
 * · 기존 행 refunded(B1) → 활성화 금지(tombstoned-skip). · 기존 행 존재 → dup(멱등).
 * · 활성 패스 있음(Q1) → 큐잉(예약, 깊이 1). 초과 → queued-overflow(ops 수동). · 없음 → 즉시 활성 + slot 0 지급(B4).
 */
export async function grantPass(
  userId: string,
  storeTxnId: string,
  purchasedAt: Date,
  productId: string,
  sandbox: boolean,
  source: 'purchase' | 'admin' = 'purchase',
): Promise<GrantPassResult> {
  await ensureProj();
  const today = todayKstResetAdjusted(PASS_RESET_HOUR_KST, purchasedAt);
  try {
    return await db.transaction(async (tx) => {
      // 0) 기존 행(멱등 + B1 tombstone)
      const existing = await tx.select().from(attendancePasses)
        .where(and(eq(attendancePasses.projCode, PROJ_CODE), eq(attendancePasses.storeTxnId, storeTxnId))).for('update').limit(1);
      if (existing.length) {
        if (existing[0].status === 'refunded') return { ok: true as const, outcome: 'tombstoned-skip' as const }; // B1: 환불 선착 → 활성화 금지
        return { ok: true as const, outcome: 'dup' as const, passId: existing[0].id }; // 이미 grant(웹훅/confirm 재시도)
      }
      // user 행 잠금 — 중첩 판정 직렬화(동시 두 구매가 각자 "활성 없음"으로 둘 다 활성화되는 레이스 차단)
      const locked = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update').limit(1);
      if (!locked.length) return { ok: false as const, reason: 'no-user' };

      // 1) 유저의 active/queued 패스
      const rows = await tx.select().from(attendancePasses)
        .where(and(eq(attendancePasses.projCode, PROJ_CODE), eq(attendancePasses.userId, userId), inArray(attendancePasses.status, ['active', 'queued']))).for('update');
      const liveActive = rows.filter((p) => p.status === 'active' && isWithinClaimWindow(p.startDate, today));
      const queued = rows.filter((p) => p.status === 'queued');

      if (liveActive.length) {
        // 중첩(Q1) → 큐잉. 앵커 = 활성/예약 중 가장 늦게 끝나는 것(체인 끝)
        const chainEnd = [...liveActive, ...queued].reduce((m, p) => (diffDays(m.endDate, p.endDate) > 0 ? p : m));
        const provStart = addDays(chainEnd.endDate, 1);
        const { endDate } = passWindow(provStart);
        const overflow = queued.length >= 1; // 큐 상한 1(활성1+예약1). 초과=지급 보류(ops 수동)
        const [ins] = await tx.insert(attendancePasses).values({
          projCode: PROJ_CODE, userId, storeTxnId, startDate: provStart, endDate, source,
          status: 'queued', queuedAfter: chainEnd.id, purchasedAt,
        }).onConflictDoNothing().returning({ id: attendancePasses.id });
        if (!ins) return { ok: true as const, outcome: 'dup' as const }; // 동시 삽입 레이스
        return { ok: true as const, outcome: overflow ? 'queued-overflow' as const : 'queued' as const, passId: ins.id };
      }

      // 2) 활성 없음 → 즉시 활성 + slot 0 지급(B4, 같은 트랜잭션)
      const { startDate, endDate } = passWindow(today);
      const [ins] = await tx.insert(attendancePasses).values({
        projCode: PROJ_CODE, userId, storeTxnId, startDate, endDate, source, status: 'active', purchasedAt,
      }).onConflictDoNothing().returning({ id: attendancePasses.id });
      if (!ins) return { ok: true as const, outcome: 'dup' as const }; // 동시 삽입 레이스(다른 tx가 같은 txn 삽입)
      const r = await applyWalletTx(tx, userId, PASS_DAILY_REWARD, 'pass_daily', passDailyKey(userId, ins.id, 0), storeTxnId);
      if (!r.ok) throw new Error(`day0-grant-failed:${r.reason}`); // 롤백(패스 행+지급 원자)
      return { ok: true as const, outcome: 'activated' as const, passId: ins.id };
    });
  } catch (e) {
    // 동시 same-txn UNIQUE 충돌 등 → 재조회로 dup 판정(applyWallet 패턴). 행이 생겼으면 멱등 dup.
    try {
      const row = await db.select({ id: attendancePasses.id, status: attendancePasses.status }).from(attendancePasses)
        .where(and(eq(attendancePasses.projCode, PROJ_CODE), eq(attendancePasses.storeTxnId, storeTxnId))).limit(1);
      if (row.length) return { ok: true, outcome: row[0].status === 'refunded' ? 'tombstoned-skip' : 'dup', passId: row[0].id };
    } catch { /* 재조회 실패 → 아래 error */ }
    return { ok: false, reason: e instanceof Error ? e.message : 'error' };
  }
}

/** 큐 패스 지연 활성화(claim·grant·refund 진입 시) — 프로비저널 start ≤ 오늘이면 flip. **주어진 tx 안**(호출부 잠금 소유).
 *  start = max(오늘, 앵커 end+1)(공백 방지·R1a). 활성화 시 slot 0 지급(B4와 동일 — 활성화가 곧 day-0). */
export async function activateDueQueued(tx: WalletTx, userId: string, today: string): Promise<void> {
  const queued = await tx.select().from(attendancePasses)
    .where(and(eq(attendancePasses.projCode, PROJ_CODE), eq(attendancePasses.userId, userId), eq(attendancePasses.status, 'queued'))).for('update');
  for (const q of queued) {
    if (diffDays(q.startDate, today) < 0) continue; // 아직 프로비저널 start 전(활성화 시점 미도래)
    const anchor = q.queuedAfter
      ? (await tx.select().from(attendancePasses).where(and(eq(attendancePasses.projCode, PROJ_CODE), eq(attendancePasses.id, q.queuedAfter))).limit(1))[0]
      : undefined;
    const anchorEnd = anchor ? anchor.endDate : addDays(today, -1);
    const start = maxDateStr(today, addDays(anchorEnd, 1)); // §2.2a·R1a
    const { endDate } = passWindow(start);
    await tx.update(attendancePasses).set({ status: 'active', startDate: start, endDate }).where(eq(attendancePasses.id, q.id));
    const r = await applyWalletTx(tx, userId, PASS_DAILY_REWARD, 'pass_daily', passDailyKey(userId, q.id, 0), q.storeTxnId ?? q.id);
    if (!r.ok) throw new Error(`queued-day0-failed:${r.reason}`);
  }
}

// ── 일일 수령(§2.3) ──

export type ClaimResult =
  | { ok: true; reason: 'claimed' | 'already' | 'no-pass'; granted: number; slots: number; balance: number; endDate?: string; dayIndex?: number }
  | { ok: false; reason: 'no-user' | 'error' };

/**
 * 일일 수령 — 활성 패스(claim 창 내)의 미수령 dayIndex 슬롯을 멱등 지급(§2.3). 앱 포그라운드 자동 호출.
 * 단일 트랜잭션 + user 행 잠금 → 환불 클로백(B2)·멀티기기(UI.4)와 상호배제. 슬롯 멱등키(user×pass×dayIndex)로 이중수령 0.
 */
export async function claimPassDaily(userId: string, now: Date = new Date()): Promise<ClaimResult> {
  const today = todayKstResetAdjusted(PASS_RESET_HOUR_KST, now);
  try {
    return await db.transaction(async (tx) => {
      const u = await tx.select({ balance: users.balance }).from(users).where(eq(users.id, userId)).for('update').limit(1);
      if (!u.length) return { ok: false as const, reason: 'no-user' as const };
      await activateDueQueued(tx, userId, today); // 큐 패스 지연 활성화
      const actives = await tx.select().from(attendancePasses)
        .where(and(eq(attendancePasses.projCode, PROJ_CODE), eq(attendancePasses.userId, userId), eq(attendancePasses.status, 'active'))).for('update');
      const live = actives.filter((p) => isWithinClaimWindow(p.startDate, today));
      if (!live.length) {
        const nb = await tx.select({ balance: users.balance }).from(users).where(eq(users.id, userId)).limit(1);
        return { ok: true as const, reason: 'no-pass' as const, granted: 0, slots: 0, balance: nb[0]?.balance ?? 0 };
      }
      let granted = 0, slots = 0, lastIdx = 0, lastEnd = '';
      for (const p of live) {
        for (const idx of claimableDayIndexes(p.startDate, today)) {
          const r = await applyWalletTx(tx, userId, PASS_DAILY_REWARD, 'pass_daily', passDailyKey(userId, p.id, idx), p.storeTxnId ?? p.id);
          if (r.ok && r.applied) { granted += PASS_DAILY_REWARD; slots++; }
          lastIdx = idx; lastEnd = p.endDate;
        }
      }
      const nb = await tx.select({ balance: users.balance }).from(users).where(eq(users.id, userId)).limit(1);
      return { ok: true as const, reason: (slots > 0 ? 'claimed' : 'already') as 'claimed' | 'already', granted, slots, balance: nb[0]?.balance ?? 0, endDate: lastEnd, dayIndex: lastIdx };
    });
  } catch (e) {
    return { ok: false, reason: 'error' };
  }
}

// ── 환불 클로백(§4.3 · B1·B2·R1a) ──

export type ClawbackResult =
  | { ok: true; outcome: 'clawed' | 'tombstoned' | 'already'; clawback: number; passId?: string }
  | { ok: false; reason: string };

/**
 * 패스 환불 클로백(B2 단일 트랜잭션) — 패스 행 잠금 → refunded(+end 어제) → Σ(pass_daily where ref=txn) → −Σ(refund_pass 키).
 * B1: 행 없으면(환불 선착) refunded tombstone 선삽입(뒤 grantPass 활성화 금지). R1a: 앵커 큐 패스 start 재계산 + 활성화.
 */
export async function clawbackPass(userId: string, storeTxnId: string, productId: string, now: Date = new Date()): Promise<ClawbackResult> {
  await ensureProj();
  const today = todayKstResetAdjusted(PASS_RESET_HOUR_KST, now);
  const yesterday = addDays(today, -1);
  try {
    return await db.transaction(async (tx) => {
      // user 잠금(claim과 상호배제 — B2)
      await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update').limit(1);
      const rows = await tx.select().from(attendancePasses)
        .where(and(eq(attendancePasses.projCode, PROJ_CODE), eq(attendancePasses.storeTxnId, storeTxnId))).for('update').limit(1);
      if (!rows.length) {
        // B1: 환불 선착 — refunded tombstone 선삽입(UNIQUE 활용). 이후 grantPass가 활성화 금지.
        await tx.insert(attendancePasses).values({
          projCode: PROJ_CODE, userId, storeTxnId, startDate: today, endDate: yesterday, source: 'purchase', status: 'refunded', purchasedAt: null,
        }).onConflictDoNothing();
        return { ok: true as const, outcome: 'tombstoned' as const, clawback: 0 };
      }
      const row = rows[0];
      const alreadyRefunded = row.status === 'refunded';
      if (!alreadyRefunded) {
        await tx.update(attendancePasses).set({ status: 'refunded', endDate: yesterday }).where(eq(attendancePasses.id, row.id));
      }
      // Σ(pass_daily where ref=storeTxnId) — 잠금 하 집계(claim 끼어들기 차단, B2)
      const sumRows = await tx.select({ s: sql<number>`coalesce(sum(${walletLedger.delta}), 0)::int` }).from(walletLedger)
        .where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.reason, 'pass_daily'), eq(walletLedger.ref, storeTxnId)));
      const total = sumRows[0]?.s ?? 0;
      let clawed = 0;
      if (total > 0) {
        const r = await applyWalletTx(tx, userId, -total, 'refund', passRefundKey(userId, storeTxnId), `${productId}:pass`);
        if (!r.ok) throw new Error(`clawback-failed:${r.reason}`);
        if (r.applied) clawed = total; // 멱등 재환불이면 clawed=0(이미 회수)
      }
      // R1a: 앵커가 이 패스인 큐 패스 start 재계산 → 오늘부터 활성(공백 방지)
      const queued = await tx.select().from(attendancePasses)
        .where(and(eq(attendancePasses.projCode, PROJ_CODE), eq(attendancePasses.queuedAfter, row.id), eq(attendancePasses.status, 'queued'))).for('update');
      for (const q of queued) {
        const { startDate, endDate } = passWindow(today);
        await tx.update(attendancePasses).set({ startDate, endDate }).where(eq(attendancePasses.id, q.id));
      }
      await activateDueQueued(tx, userId, today); // 재계산된 큐 패스 즉시 활성화
      return { ok: true as const, outcome: alreadyRefunded ? 'already' as const : 'clawed' as const, clawback: clawed, passId: row.id };
    });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'error' };
  }
}

// ── 지급 합성(웹훅/confirm 공유, §3.1·§9 Phase① 4) ──

export type PurchaseGrantResult =
  | { kind: 'pass'; pass: GrantPassResult }
  | { kind: 'pack'; base: WalletResult; bonus: WalletResult | null; diamonds: number }
  | { kind: 'unknown' };

/**
 * 구매 지급 합성 — pass면 grantPass, 팩이면 base 지급 + (withBonus & 프로모 on & 그 달 첫 구매면) 1+1 보너스.
 * withBonus: 웹훅=true(purchased_at 권위·R4), confirm=false(purchased_at 미상 → 월키 분기 오지급 방지, 보너스는 웹훅 전담 — 판단 보고).
 */
export async function applyPurchaseGrant(params: {
  userId: string; storeTxnId: string; productId: string; sandbox: boolean; purchasedAt: Date; withBonus: boolean;
}): Promise<PurchaseGrantResult> {
  const { userId, storeTxnId, productId, sandbox, purchasedAt, withBonus } = params;
  if (isPassProduct(productId)) {
    return { kind: 'pass', pass: await grantPass(userId, storeTxnId, purchasedAt, productId, sandbox) };
  }
  const diamonds = productDiamonds(productId);
  if (diamonds == null) return { kind: 'unknown' };
  const ref = sandbox ? `${productId}:sandbox` : productId;
  const base = await applyWallet(userId, diamonds, 'purchase', purchaseKey(userId, storeTxnId), ref);
  let bonus: WalletResult | null = null;
  // 1+1 — 웹훅 경로 + 프로모 게이트 on일 때만. 월-멱등키(월×팩[:sandbox])가 "그 달 첫 구매"를 강제(재구매·재전송 dedup).
  if (base.ok && withBonus && promo1p1Enabled()) {
    const ym = kstYearMonth(purchasedAt); // R4: purchased_at KST 연월(웹훅 처리시각 아님)
    const bref = sandbox ? `${storeTxnId}:sandbox` : storeTxnId;
    bonus = await applyWallet(userId, diamonds, 'iap_bonus_1p1', bonus1p1Key(userId, productId, ym, sandbox), bref);
  }
  return { kind: 'pack', base, bonus, diamonds };
}

/** 팩 1+1 보너스 회수 금액 조회(환불) — 이 txn이 실제 지급한 보너스 합(ref=txn[:sandbox]). §4.2: 월-멱등키는 원장에 남겨 플래그 미복구(파밍 차단). */
export async function pack1p1BonusForTxn(storeTxnId: string): Promise<number> {
  const rows = await db.select({ s: sql<number>`coalesce(sum(${walletLedger.delta}), 0)::int` }).from(walletLedger)
    .where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.reason, 'iap_bonus_1p1'),
      inArray(walletLedger.ref, [storeTxnId, `${storeTxnId}:sandbox`])));
  return rows[0]?.s ?? 0;
}

/**
 * 팩 환불 보너스 회수 — 이 txn이 지급한 1+1 보너스가 있으면 −N(refund_bonus 키). 기본 팩 회수는 기존 webhook refund 경로(refund 키)가 담당.
 * 월-멱등키는 미복구(§4.2 환불→재구매 파밍 차단). 없으면 no-op(0).
 */
export async function reversePackBonus(userId: string, storeTxnId: string, productId: string): Promise<{ reversed: number }> {
  const bonus = await pack1p1BonusForTxn(storeTxnId);
  if (bonus <= 0) return { reversed: 0 };
  const r = await applyWallet(userId, -bonus, 'refund', bonusRefundKey(userId, storeTxnId), `${productId}:1p1bonus`);
  return { reversed: r.ok && r.applied ? bonus : 0 };
}

// ── 패스 상태(getWallet 확장, Q2 §2.4) ──

export interface PassStatus {
  active: boolean;
  endDate: string | null;      // 활성 패스 종료일(D-N 표시)
  claimedToday: boolean;       // 오늘 dayIndex 이미 수령?
  queued: boolean;             // 예약 패스 보유?
  bonus1p1Available: Record<string, boolean>; // 팩별 이번 달 1+1 가용(서버 파생)
}

/** 패스·1+1 상태 — getWallet 응답 편입(§2.4 Q2). 1+1 가용은 원장 월-키 존재 파생(낙관 표시 금지). */
export async function passStatus(userId: string, now: Date = new Date()): Promise<PassStatus> {
  const today = todayKstResetAdjusted(PASS_RESET_HOUR_KST, now);
  const rows = await db.select().from(attendancePasses)
    .where(and(eq(attendancePasses.projCode, PROJ_CODE), eq(attendancePasses.userId, userId), inArray(attendancePasses.status, ['active', 'queued'])));
  const actives = rows.filter((p: PassRow) => p.status === 'active' && isWithinClaimWindow(p.startDate, today));
  const queued = rows.some((p: PassRow) => p.status === 'queued');
  const active = actives[0];
  let claimedToday = false;
  if (active) {
    const off = diffDays(active.startDate, today);
    const idx = Math.min(PASS_DURATION_DAYS - 1, Math.max(0, off));
    const dup = await db.select({ id: walletLedger.id }).from(walletLedger)
      .where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.idempotencyKey, passDailyKey(userId, active.id, idx)))).limit(1);
    claimedToday = dup.length > 0;
  }
  // 1+1 가용 — 팩별 이번 달 보너스 키가 원장에 없으면 가용(프로모 on일 때만 의미). 저장키는 raw(applyPurchaseGrant가 applyWallet에 full key 직접 전달).
  const ym = kstYearMonth(now);
  const bonus1p1Available: Record<string, boolean> = {};
  if (promo1p1Enabled()) {
    for (const pid of Object.keys(DIAMOND_PRODUCTS)) {
      const dup = await db.select({ id: walletLedger.id }).from(walletLedger)
        .where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.idempotencyKey, bonus1p1Key(userId, pid, ym, false)))).limit(1);
      bonus1p1Available[pid] = dup.length === 0;
    }
  }
  return { active: !!active, endDate: active?.endDate ?? null, claimedToday, queued, bonus1p1Available };
}
