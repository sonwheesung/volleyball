// 다이아 패스 + 월 1+1 (DIAMOND_PASS_SYSTEM §A·§B·§C) — 서버 재화 레이어. 시드/리플레이/세이브 무접근(§6).
// 패스 소유·창 진실 = attendance_passes. 다이아 이동(일일 수령·1+1 보너스·환불 회수) = wallet_ledger(append-only, applyWalletTx 멱등).
//
// ★ 재개정(2026-07-23, 스케줄러 우편 전환): 일일 지급 = 유저 claim 아님 → **서버 스케줄러(일일 크론)가 활성 패스마다 그날 몫 100💎 첨부 우편 발송**(§2.3).
//   유저 수령은 우편함(MAILBOX claim → reason 'pass_daily'). 유예(claim 창) 폐기 — 우편 보존 30일이 대체(§2.3.1). 리셋 KST 00:00(Q6).
//
// 핵심 불변식·블로커:
//  · B4(§2.1): grantPassTx가 패스 행 생성과 **같은 트랜잭션**에서 slot 0 **우편을 발송**(직접 원장 지급 아님) → 구매 직후 1일차 우편이 우편함에 즉시. 스케줄러와 mail idem_key(pass_daily:<passId>:0)로 dedupe(이중발송 0).
//  · B1(§4.3.1): 환불이 구매보다 먼저 도착 → refunded tombstone 선삽입(UNIQUE(proj,txn)) → 뒤늦은 grantPass는 활성화 금지(유령 활성 0).
//  · B2(§4.3.2): 클로백 = 단일 트랜잭션(패스 행 FOR UPDATE 잠금 → status=refunded → 미수령 우편 recall → Σ(pass_daily where idem_key LIKE 'pass_daily:<user>:<pass>:%') → −Σ 삽입). claim과 잠금으로 상호배제(Σ 정합).
//  · Q1(§2.2): 중첩 구매 = 큐잉(활성 1 + 예약 1, 깊이 상한 1). 예약 start는 활성화 때 max(오늘, 앵커 end+1) 파생(공백 방지). 초과 = ops 알림·수동.
//  · R1a(§2.2a): 앞 패스 조기 종료(환불) 시 뒤 큐 패스 start 재계산(공백 방지).
import { and, eq, gte, inArray, lte, sql, isNull } from 'drizzle-orm';
import { db } from '../db';
import { users, walletLedger, attendancePasses, mails } from '../db/schema';
import { PROJ_CODE } from './proj';
import { applyWalletTx, applyWallet, ensureProj, type WalletResult, type WalletTx } from './wallet';
import { productDiamonds, isPassProduct, DIAMOND_PRODUCTS } from './products';
import { purchaseKey } from './revenuecat';
import { PASS_DAILY_REWARD, PASS_DURATION_DAYS, PASS_RESET_HOUR_KST, MAIL_RETENTION_DAYS } from './econ';
import { todayKstResetAdjusted, kstYearMonth, addDays, diffDays, maxDateStr } from './dates';

// ── 멱등키·ref 빌더(§2.5·§3.4) ──
/** 일일 수령 원장 멱등키(우편 claim 시 walletLedger) — user×pass×dayIndex 유일. 클로백 Σ 앵커 프리픽스 기준(§4.3.2). */
export const passDailyKey = (userId: string, passId: string, dayIndex: number) => `pass_daily:${userId}:${passId}:${dayIndex}`;
/** 일일 발송 우편 멱등키(mails.idem_key) — pass×dayIndex(userId 없음, 우편이 유저 귀속 행). 스케줄러·day-0·캐치업 dedupe(§2.3). */
export const passMailKey = (passId: string, dayIndex: number) => `pass_daily:${passId}:${dayIndex}`;
/** 클로백 Σ 앵커 프리픽스 — 그 패스의 수령된 pass_daily 원장 전부(idem_key LIKE `${prefix}%`). ref가 mail:<mailId>로 바뀌어 passId 멱등키로 묶음(§4.3.2). */
export const passDailyLedgerPrefix = (userId: string, passId: string) => `pass_daily:${userId}:${passId}:`;
/** 발송 우편 idem_key 프리픽스(recall 대상 — 그 패스의 미수령 슬롯 우편, §4.3.2). */
export const passMailPrefix = (passId: string) => `pass_daily:${passId}:`;
export const passRefundKey = (userId: string, storeTxnId: string) => `refund_pass:${userId}:${storeTxnId}`;
/** 1+1 월-멱등키 = 월×팩(그 달 첫 구매 grant만 성공). R3: 샌드박스는 별도 스코프(:sandbox 접미)로 prod 월키 미소진. */
export const bonus1p1Key = (userId: string, productId: string, yearMonth: string, sandbox: boolean) =>
  `iap_bonus_1p1:${userId}:${productId}:${yearMonth}${sandbox ? ':sandbox' : ''}`;
export const bonusRefundKey = (userId: string, storeTxnId: string) => `refund_bonus:${userId}:${storeTxnId}`;

/** system:pass 우편 idem_key(pass_daily:<passId>:<dayIndex>)에서 passId·dayIndex 파싱(claim 시 원장 키·reason 분기용). 형식 불일치면 null. */
export function parsePassMailKey(idemKey: string): { passId: string; dayIndex: number } | null {
  const m = /^pass_daily:([0-9a-fA-F-]{36}):(\d+)$/.exec(idemKey);
  if (!m) return null;
  return { passId: m[1], dayIndex: Number(m[2]) };
}

/** 1+1 프로모 서버 게이트(§7 출시 게이팅) — env PROMO_1P1_ENABLED==='1'|'true'일 때만 보너스 지급. **요청 시점 read**(모듈 캐시 금지).
 *  기본 off(fail-closed·미출시): 서버 배포가 앱 뱃지(PROMO_1P1_ENABLED 클라 플래그)와 동기화될 때 켠다. 판단 보고 항목(§7 서버 대응 신설). */
export function promo1p1Enabled(): boolean {
  const v = process.env.PROMO_1P1_ENABLED;
  return v === '1' || v === 'true' || v === 'all';
}

// ── 순수 창 산술(§2.1 · 가드 _dv_pass가 직접 테스트, DB 무의존) ──

/** 패스 창: start(구매일 리셋보정) → end = start + (DURATION-1) = start+27(포함, 28슬롯 = 최대 2,800💎). */
export function passWindow(startDate: string): { startDate: string; endDate: string } {
  return { startDate, endDate: addDays(startDate, PASS_DURATION_DAYS - 1) };
}

/** 패스가 오늘(리셋보정) 기준 창 안(발송/활성 대상)인가 — start≤today≤end(유예 폐기, off ∈ [0..27]). 만료(off>27)·시작 전(off<0) 제외(§2.3.2 대상). */
export function isPassActiveOn(startDate: string, today: string): boolean {
  const off = diffDays(startDate, today);
  return off >= 0 && off <= PASS_DURATION_DAYS - 1;
}

/** 오늘(리셋보정) 기준 dayIndex(0~27 클램프). start 이후 경과일. 시작 전이면 음수 반환(호출부가 가드). */
export function passDayIndex(startDate: string, today: string): number {
  return diffDays(startDate, today);
}

/** 캐치업 발송 대상 dayIndex 목록(§2.3.2 순수 코어 — 가드 _dv_pass가 직접 테스트) — 창 안이면 [0..min(off,27)], 밖(시작 전·만료)이면 [].
 *  스케줄러가 이 목록 전부 발송 시도 → mail idem_key가 이미 발송분 dedupe → 크론 미실행일 몰아 발송(손실 0, 리스크 1). */
export function catchupDayIndexes(startDate: string, today: string): number[] {
  if (!isPassActiveOn(startDate, today)) return [];
  const hi = Math.min(PASS_DURATION_DAYS - 1, passDayIndex(startDate, today));
  const out: number[] = [];
  for (let i = 0; i <= hi; i++) out.push(i);
  return out;
}

type PassRow = typeof attendancePasses.$inferSelect;

// ── 일일 슬롯 우편 발송(§2.3 · day-0/스케줄러/큐활성화 공용) ──

/** 그 패스의 dayIndex 슬롯 우편(💎100, sender=system:pass, 보존 30일) 1통을 **주어진 tx 안에서** 발송.
 *  mail idem_key(pass_daily:<passId>:<dayIndex>) UNIQUE → day-0·스케줄러·캐치업·크론 중복 실행이 전부 onConflictDoNothing dedupe(이중발송 0). 반환=새로 발송했나. */
export async function insertPassSlotMailTx(tx: WalletTx, userId: string, passId: string, dayIndex: number, now: Date): Promise<boolean> {
  const expiresAt = new Date(now.getTime() + MAIL_RETENTION_DAYS * 86_400_000);
  const ins = await tx.insert(mails).values({
    projCode: PROJ_CODE, userId, idemKey: passMailKey(passId, dayIndex),
    title: '다이아 패스', body: `다이아 패스 · ${dayIndex + 1}일차 보상 100💎`,
    attachType: 'diamonds', attachAmount: PASS_DAILY_REWARD, sender: 'system:pass', expiresAt,
  }).onConflictDoNothing({ target: [mails.projCode, mails.idemKey] }).returning({ id: mails.id });
  return ins.length > 0;
}

// ── grant(구매 지급) ──

export type GrantPassResult =
  | { ok: true; outcome: 'activated' | 'queued' | 'queued-overflow' | 'dup' | 'tombstoned-skip'; passId?: string }
  | { ok: false; reason: string };

/** grantPassTx 옵션(MAILBOX §5.1 B2). rejectOnQueueFull: 큐 만석(활성+예약 이미 참) 시 삽입 대신 throw(롤백) — 우편 경로 true(무상 지급이라 롤백·재수령이 옳음),
 *  구매 경로 false(돈 이미 받음 → queued-overflow 삽입 유지). 판정은 아래 user FOR UPDATE 잠금 이후(멀티기기 동시 수령 레이스 방지). */
export interface GrantPassOpts { rejectOnQueueFull?: boolean }

/** 큐 만석 거부 센티널(B2) — grantPassTx가 throw, 호출 tx 롤백. 우편 claim 라우트가 message로 잡아 `pass-queue-full` typed 반환. */
export const PASS_QUEUE_FULL = 'pass-queue-full';

/**
 * 패스 grant — **주어진 트랜잭션 안에서**(B1, 우편 claim 등과 원자 합성용). storeTxnId UNIQUE로 웹훅/confirm/우편 dedupe.
 * · 기존 행 refunded(B1) → 활성화 금지(tombstoned-skip). · 기존 행 존재 → dup(멱등).
 * · 활성 패스 있음(Q1) → 큐잉(예약, 깊이 1). 초과 → queued-overflow(구매) 또는 rejectOnQueueFull이면 throw(우편, B2). · 없음 → 즉시 활성 + slot 0 **우편 발송**(B4).
 * 호출부가 tx 소유·커밋/롤백. throw(PASS_QUEUE_FULL·day0-mail-failed)는 tx 롤백을 의도.
 * purchasedAt: 구매=RC 이벤트 시각 / 우편=서버 new Date()(월귀속·리셋보정·우편 만료 기준, B1). day-0 우편 만료도 purchasedAt 기준.
 */
export async function grantPassTx(
  tx: WalletTx,
  userId: string,
  storeTxnId: string,
  purchasedAt: Date,
  source: 'purchase' | 'admin' = 'purchase',
  opts: GrantPassOpts = {},
): Promise<GrantPassResult> {
  const today = todayKstResetAdjusted(PASS_RESET_HOUR_KST, purchasedAt);
  // 0) 기존 행(멱등 + B1 tombstone)
  const existing = await tx.select().from(attendancePasses)
    .where(and(eq(attendancePasses.projCode, PROJ_CODE), eq(attendancePasses.storeTxnId, storeTxnId))).for('update').limit(1);
  if (existing.length) {
    if (existing[0].status === 'refunded') return { ok: true as const, outcome: 'tombstoned-skip' as const }; // B1: 환불 선착 → 활성화 금지
    return { ok: true as const, outcome: 'dup' as const, passId: existing[0].id }; // 이미 grant(웹훅/confirm/우편 재시도)
  }
  // user 행 잠금 — 중첩 판정 직렬화(동시 두 수령이 각자 "활성 없음"으로 둘 다 활성화되는 레이스 차단). B2 만석 판정도 이 잠금 안에서.
  const locked = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update').limit(1);
  if (!locked.length) return { ok: false as const, reason: 'no-user' };

  // 1) 유저의 active/queued 패스
  const rows = await tx.select().from(attendancePasses)
    .where(and(eq(attendancePasses.projCode, PROJ_CODE), eq(attendancePasses.userId, userId), inArray(attendancePasses.status, ['active', 'queued']))).for('update');
  const liveActive = rows.filter((p) => p.status === 'active' && isPassActiveOn(p.startDate, today));
  const queued = rows.filter((p) => p.status === 'queued');

  if (liveActive.length) {
    const overflow = queued.length >= 1; // 큐 상한 1(활성1+예약1). 초과 상황
    // B2 — 우편(rejectOnQueueFull)은 만석이면 삽입 않고 throw(롤백 → claim이 pass-queue-full·claimed_at 미설정 재수령). 구매는 queued-overflow 삽입(돈 이미 받음).
    if (overflow && opts.rejectOnQueueFull) throw new Error(PASS_QUEUE_FULL);
    // 중첩(Q1) → 큐잉. 앵커 = 활성/예약 중 가장 늦게 끝나는 것(체인 끝)
    const chainEnd = [...liveActive, ...queued].reduce((m, p) => (diffDays(m.endDate, p.endDate) > 0 ? p : m));
    const provStart = addDays(chainEnd.endDate, 1);
    const { endDate } = passWindow(provStart);
    const [ins] = await tx.insert(attendancePasses).values({
      projCode: PROJ_CODE, userId, storeTxnId, startDate: provStart, endDate, source,
      status: 'queued', queuedAfter: chainEnd.id, purchasedAt,
    }).onConflictDoNothing().returning({ id: attendancePasses.id });
    if (!ins) return { ok: true as const, outcome: 'dup' as const }; // 동시 삽입 레이스
    return { ok: true as const, outcome: overflow ? 'queued-overflow' as const : 'queued' as const, passId: ins.id };
  }

  // 2) 활성 없음 → 즉시 활성 + slot 0 **우편 발송**(B4, 같은 트랜잭션). 스케줄러가 다음 자정까지 안 돌아도 첫날 보상이 우편함에.
  const { startDate, endDate } = passWindow(today);
  const [ins] = await tx.insert(attendancePasses).values({
    projCode: PROJ_CODE, userId, storeTxnId, startDate, endDate, source, status: 'active', purchasedAt,
  }).onConflictDoNothing().returning({ id: attendancePasses.id });
  if (!ins) return { ok: true as const, outcome: 'dup' as const }; // 동시 삽입 레이스(다른 tx가 같은 txn 삽입)
  await insertPassSlotMailTx(tx, userId, ins.id, 0, purchasedAt); // idem pass_daily:<passId>:0 → 스케줄러 dedupe
  return { ok: true as const, outcome: 'activated' as const, passId: ins.id };
}

/**
 * 패스 grant(자체 트랜잭션) — 웹훅/confirm 공유 래퍼. grantPassTx를 db.transaction으로 감싸 재사용(B1 추출 후 무변경).
 * 구매 경로라 rejectOnQueueFull=false(큐 만석=queued-overflow 삽입 유지, 돈 이미 받음). productId/sandbox는 호출부 API 대칭용(본문 미사용).
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
  try {
    return await db.transaction((tx) => grantPassTx(tx, userId, storeTxnId, purchasedAt, source, { rejectOnQueueFull: false }));
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

/** 큐 패스 지연 활성화(스케줄러·환불 진입 시) — 프로비저널 start ≤ 오늘이면 flip. **주어진 tx 안**(호출부 잠금 소유).
 *  start = max(오늘, 앵커 end+1)(공백 방지·R1a). 활성화 시 slot 0 **우편 발송**(B4와 동일 — 활성화가 곧 day-0). */
export async function activateDueQueued(tx: WalletTx, userId: string, today: string, now: Date): Promise<void> {
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
    await insertPassSlotMailTx(tx, userId, q.id, 0, now); // day-0 우편(활성화 시점)
  }
}

// ── 일일 발송 스케줄러 코어(§2.3.2 · 크론이 호출, 가드가 직접 호출) ──

export type DispatchResult = { activated: number; passes: number; mailsSent: number };

/**
 * 일일 패스 우편 발송(§2.3.2) — 매일 KST 00:00 직후 크론(§13.10)이 호출. now 주입(가드 제어)·DB 직접.
 * ① 프로비저널 start ≤ 오늘인 큐 패스 지연 활성화(활성화가 곧 day-0 우편). ② 활성 패스마다 **오늘까지 미발송 dayIndex 전부** 우편 발송(캐치업 멱등).
 * 캐치업: dayIndex 0…min(off,27) 전부 시도 → mail idem_key로 이미 발송분 dedupe → 크론 미실행일이 있어도 다음 실행이 빠진 슬롯 몰아 생성(손실 0, 문서 리스크 1).
 * 대상: status='active' AND start≤오늘≤end(만료 패스 제외 — off>27은 슬롯 없음). queued는 ①에서 활성 전환된 뒤부터.
 */
export async function dispatchDailyPassMails(now: Date = new Date()): Promise<DispatchResult> {
  await ensureProj();
  const today = todayKstResetAdjusted(PASS_RESET_HOUR_KST, now);
  // ① 큐 패스 지연 활성화(프로비저널 start ≤ 오늘) — 유저별 tx. claim 경로 폐기라 활성화 트리거는 이 스케줄러(+환불)뿐.
  const dueQueued = await db.select({ userId: attendancePasses.userId }).from(attendancePasses)
    .where(and(eq(attendancePasses.projCode, PROJ_CODE), eq(attendancePasses.status, 'queued'), lte(attendancePasses.startDate, today)));
  const dueUsers = [...new Set(dueQueued.map((r) => r.userId))];
  for (const uid of dueUsers) {
    await db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, uid)).for('update').limit(1); // claim/grant와 직렬화
      await activateDueQueued(tx, uid, today, now);
    });
  }
  // ② 활성 패스 일일 우편(캐치업)
  const actives = await db.select().from(attendancePasses)
    .where(and(eq(attendancePasses.projCode, PROJ_CODE), eq(attendancePasses.status, 'active'),
      lte(attendancePasses.startDate, today), gte(attendancePasses.endDate, today)));
  let mailsSent = 0;
  for (const p of actives) {
    const slots = catchupDayIndexes(p.startDate, today); // [0..min(off,27)] — 미발송분은 mail idem_key로 dedupe
    if (!slots.length) continue;
    await db.transaction(async (tx) => {
      for (const idx of slots) if (await insertPassSlotMailTx(tx, p.userId, p.id, idx, now)) mailsSent++;
    });
  }
  return { activated: dueUsers.length, passes: actives.length, mailsSent };
}

// ── 환불 클로백(§4.3 · B1·B2·R1a) ──

export type ClawbackResult =
  | { ok: true; outcome: 'clawed' | 'tombstoned' | 'already'; clawback: number; recalled: number; passId?: string }
  | { ok: false; reason: string };

/**
 * 패스 환불 클로백(B2 단일 트랜잭션) — 패스 행 잠금 → refunded(+end 어제) → **미수령 우편 recall** → Σ(pass_daily where idem_key LIKE prefix) → −Σ(refund_pass 키).
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
        return { ok: true as const, outcome: 'tombstoned' as const, clawback: 0, recalled: 0 };
      }
      const row = rows[0];
      const alreadyRefunded = row.status === 'refunded';
      if (!alreadyRefunded) {
        await tx.update(attendancePasses).set({ status: 'refunded', endDate: yesterday }).where(eq(attendancePasses.id, row.id));
      }
      // ★ 미수령 pass_daily 우편 recall(§4.3.2 재개정) — 안 하면 환불 후에도 우편함에서 계속 수령 가능(구멍). recalled_at 마킹 → 목록·카운트 즉시 제외.
      const recalledRows = await tx.update(mails).set({ recalledAt: sql`now()` })
        .where(and(eq(mails.projCode, PROJ_CODE), eq(mails.userId, userId),
          sql`${mails.idemKey} LIKE ${passMailPrefix(row.id) + '%'}`, isNull(mails.claimedAt), isNull(mails.recalledAt)))
        .returning({ id: mails.id });
      // Σ(pass_daily where idem_key LIKE 'pass_daily:<user>:<pass>:%') — 잠금 하 집계(claim 끼어들기 차단, B2). passId 앵커(ref=mail:<id>라 storeTxnId로 못 묶음).
      const sumRows = await tx.select({ s: sql<number>`coalesce(sum(${walletLedger.delta}), 0)::int` }).from(walletLedger)
        .where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.reason, 'pass_daily'),
          sql`${walletLedger.idempotencyKey} LIKE ${passDailyLedgerPrefix(userId, row.id) + '%'}`));
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
      await activateDueQueued(tx, userId, today, now); // 재계산된 큐 패스 즉시 활성화(day-0 우편)
      return { ok: true as const, outcome: alreadyRefunded ? 'already' as const : 'clawed' as const, clawback: clawed, recalled: recalledRows.length, passId: row.id };
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
  dayIndex: number | null;     // 오늘 dayIndex(0~27, 스탬프 표시)
  claimedToday: boolean;       // 오늘 dayIndex 슬롯 우편 이미 수령(원장 pass_daily 키 존재)?
  queued: boolean;             // 예약 패스 보유?
  bonus1p1Available: Record<string, boolean>; // 팩별 이번 달 1+1 가용(서버 파생)
}

/** 패스·1+1 상태 — getWallet 응답 편입(§2.4 Q2). 수령 현황은 **우편 수령 기준**(원장 pass_daily 키 존재)으로 재정의(§UI, 재개정 2026-07-23). 1+1 가용은 원장 월-키 존재 파생(낙관 표시 금지). */
export async function passStatus(userId: string, now: Date = new Date()): Promise<PassStatus> {
  const today = todayKstResetAdjusted(PASS_RESET_HOUR_KST, now);
  const rows = await db.select().from(attendancePasses)
    .where(and(eq(attendancePasses.projCode, PROJ_CODE), eq(attendancePasses.userId, userId), inArray(attendancePasses.status, ['active', 'queued'])));
  const actives = rows.filter((p: PassRow) => p.status === 'active' && isPassActiveOn(p.startDate, today));
  const queued = rows.some((p: PassRow) => p.status === 'queued');
  const active = actives[0];
  let claimedToday = false;
  let dayIndex: number | null = null;
  if (active) {
    const idx = Math.min(PASS_DURATION_DAYS - 1, Math.max(0, passDayIndex(active.startDate, today)));
    dayIndex = idx;
    // 오늘 슬롯 우편이 이미 수령됐나 = 그 슬롯 pass_daily 원장 키 존재(우편함 claim이 쓰는 키).
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
  return { active: !!active, endDate: active?.endDate ?? null, dayIndex, claimedToday, queued, bonus1p1Available };
}
