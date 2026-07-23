// 우편함(MAILBOX_SYSTEM §4·§5) — 서버 재화·전달 레이어. 시드/리플레이/세이브 무접근(§2 원칙3).
// 개별 우편(mails) + 브로드캐스트(mail_broadcasts + lazy receipts). 수령 다이아 = wallet_ledger(reason='mail', 멱등키 mail:<id> / mail_bc:<bc>:<user>).
// 패스 첨부 수령 = grantPassTx(tx, storeTxnId='mail:<id>', rejectOnQueueFull:true)로 위임(B1·B2·B3, 패스 시스템 진실).
//
// 핵심 불변식·블로커:
//  · E1(§10): 만료 판정 = DB now()(claim 트랜잭션 안, 클라·서버 JS 클럭 불신).
//  · E2(§10): 이중수령 = UPDATE ... claimed_at IS NULL rowcount 가드(rowcount 0=dedup) + 원장 멱등키 mail:<id> + 패스 store_txn_id UNIQUE 3중.
//  · E2b(§10): 패스 지급 원자성 = grantPassTx가 우편 claim과 한 tx(B1). 만석+rejectOnQueueFull → throw → claim 롤백(claimed_at 미설정 재수령).
//  · E10(§10): 적립(delta>0)이라 음수 잔액에서도 수령 통과(부채 상쇄).
import { and, desc, eq, gte, isNull, isNotNull, ne, sql } from 'drizzle-orm';
import { db } from '../db';
import { mails, mailBroadcasts, mailBroadcastReceipts, users } from '../db/schema';
import { PROJ_CODE } from './proj';
import { applyWalletTx } from './wallet';
import { grantPassTx, PASS_QUEUE_FULL, passDailyKey, parsePassMailKey } from './pass';
import { MAIL_RETENTION_DAYS, MAIL_PASS_EXPIRE_DAYS, MAIL_MAX_GRANT } from './econ';

export type MailStatus = 'all' | 'claimed' | 'unclaimed';
export type MailKind = 'mail' | 'bc';

// ── 순수 헬퍼(가드 _dv_mail가 직접 테스트, DB 무의존) ──

/** 개별 우편 다이아/패스 수령 멱등키 = ref(S2, title 폐기 — mailId는 유저 귀속 PK라 전역 유일). 패스 store_txn_id도 이 값(B3). */
export const mailLedgerKey = (mailId: string): string => `mail:${mailId}`;
/** 브로드캐스트 수령 멱등키 — broadcastId가 전유저 공유라 userId를 박아 유일화(§4). */
export const mailBroadcastKey = (broadcastId: string, userId: string): string => `mail_bc:${broadcastId}:${userId}`;

/** 만료일 파생(R3, §3.3) — diamonds=30일 · pass=60일(큐 점유 최대 56일 > 30 모순 창 해소). explicit이 있으면 우선. */
export function mailExpiresInDays(attachType: string, explicit?: number | null): number {
  if (explicit != null && Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  return attachType === 'pass' ? MAIL_PASS_EXPIRE_DAYS : MAIL_RETENTION_DAYS;
}
export function mailExpiresAt(base: Date, attachType: string, explicit?: number | null): Date {
  return new Date(base.getTime() + mailExpiresInDays(attachType, explicit) * 86_400_000);
}

/** 만료 판정(E1) — now > expiresAt이면 만료(수령 불가). 경계(now == expiresAt)는 미만료(수령 가능). */
export function isMailExpired(now: Date, expiresAt: Date): boolean {
  return now.getTime() > expiresAt.getTime();
}

export type GrantValidation = { ok: true; amount: number | null } | { ok: false; reason: 'bad-amount' | 'over-cap' | 'bad-type' };
/** 첨부 검증·캡 클램프 — diamonds: 0<amount≤MAIL_MAX_GRANT(초과=over-cap). pass: amount 무시(null). 그 외 타입=bad-type. */
export function validateAttach(attachType: string, attachAmount?: number | null): GrantValidation {
  if (attachType === 'pass') return { ok: true, amount: null };
  if (attachType !== 'diamonds') return { ok: false, reason: 'bad-type' };
  const a = Math.floor(Number(attachAmount));
  if (!Number.isFinite(a) || a <= 0) return { ok: false, reason: 'bad-amount' };
  if (a > MAIL_MAX_GRANT) return { ok: false, reason: 'over-cap' };
  return { ok: true, amount: a };
}

/** 상태 필터 분류(§5.1) — SQL WHERE의 단일 출처 미러. recalled=목록 제외. now는 만료 판정용.
 *  unclaimed=미수령·미만료 · claimed=수령됨 · expired=미수령·만료 · recalled=회수(목록 제외). */
export function classifyMail(row: { claimedAt: Date | null; recalledAt: Date | null; expiresAt: Date }, now: Date): 'unclaimed' | 'claimed' | 'expired' | 'recalled' {
  if (row.recalledAt) return 'recalled';
  if (row.claimedAt) return 'claimed';
  return isMailExpired(now, row.expiresAt) ? 'expired' : 'unclaimed';
}
/** status 탭이 이 우편을 포함하나(회수분은 항상 제외). all=회수 외 전부(만료·수령 포함, Q2 만료 투명성). */
export function includeInStatus(status: MailStatus, cls: ReturnType<typeof classifyMail>): boolean {
  if (cls === 'recalled') return false;
  if (status === 'all') return true;
  if (status === 'claimed') return cls === 'claimed';
  return cls === 'unclaimed'; // unclaimed 탭 = 미수령·미만료만(만료분은 all 탭에서)
}

// ── 미확인·미수령 카운트(getWallet 편입, §5.2 R4·S1 단일 집계 SQL) ──

export async function mailCounts(userId: string): Promise<{ unreadMailCount: number; unclaimedMailCount: number }> {
  // 개별(mails) + 브로드캐스트(cutoff·미만료·receipt 없음/미read·미claim) 합산. now()=DB 클럭. 서브쿼리 1문(별 라운드트립 억제).
  const rows = (await db.execute(sql`
    SELECT
      ( SELECT count(*) FROM mails m
          WHERE m.proj_code = ${PROJ_CODE} AND m.user_id = ${userId}
            AND m.recalled_at IS NULL AND m.read_at IS NULL AND now() <= m.expires_at )
      + ( SELECT count(*) FROM mail_broadcasts b
          WHERE b.proj_code = ${PROJ_CODE} AND now() <= b.expires_at
            AND b.created_at >= (SELECT created_at FROM users WHERE id = ${userId})
            AND NOT EXISTS (SELECT 1 FROM mail_broadcast_receipts r
                            WHERE r.proj_code = ${PROJ_CODE} AND r.broadcast_id = b.id AND r.user_id = ${userId}
                              AND r.read_at IS NOT NULL) ) AS unread,
      ( SELECT count(*) FROM mails m
          WHERE m.proj_code = ${PROJ_CODE} AND m.user_id = ${userId}
            AND m.recalled_at IS NULL AND m.claimed_at IS NULL AND now() <= m.expires_at )
      + ( SELECT count(*) FROM mail_broadcasts b
          WHERE b.proj_code = ${PROJ_CODE} AND now() <= b.expires_at
            AND b.created_at >= (SELECT created_at FROM users WHERE id = ${userId})
            AND NOT EXISTS (SELECT 1 FROM mail_broadcast_receipts r
                            WHERE r.proj_code = ${PROJ_CODE} AND r.broadcast_id = b.id AND r.user_id = ${userId}
                              AND r.claimed_at IS NOT NULL) ) AS unclaimed
  `)) as unknown as Array<{ unread: number | string; unclaimed: number | string }>;
  const r = rows[0] ?? { unread: 0, unclaimed: 0 };
  return { unreadMailCount: Number(r.unread) || 0, unclaimedMailCount: Number(r.unclaimed) || 0 };
}

// ── 목록(§5.1) — 개별 + 대상 브로드캐스트 합성, 최신순 ──

export interface MailItem {
  id: string; kind: MailKind;
  title: string; body: string;
  attachType: string; attachAmount: number | null;
  claimedAt: string | null; readAt: string | null;
  expiresAt: string; createdAt: string;
}

export async function listMail(userId: string, status: MailStatus, limit = 30, offset = 0): Promise<{ items: MailItem[] }> {
  // 개별 우편(회수 제외 + status)
  const mConds = [eq(mails.projCode, PROJ_CODE), eq(mails.userId, userId), isNull(mails.recalledAt)];
  if (status === 'claimed') mConds.push(isNotNull(mails.claimedAt));
  else if (status === 'unclaimed') { mConds.push(isNull(mails.claimedAt)); mConds.push(gte(mails.expiresAt, sql`now()`)); }
  const mRows = await db.select().from(mails).where(and(...mConds)).orderBy(desc(mails.createdAt)).limit(500);

  // 대상 브로드캐스트(cutoff: user.created_at ≤ b.created_at) + receipt LEFT JOIN
  const claimedCond = status === 'claimed' ? sql`AND r.claimed_at IS NOT NULL`
    : status === 'unclaimed' ? sql`AND r.claimed_at IS NULL AND now() <= b.expires_at` : sql``;
  const bRows = (await db.execute(sql`
    SELECT b.id, b.title, b.body, b.attach_type, b.attach_amount, b.expires_at, b.created_at,
           r.read_at, r.claimed_at
      FROM mail_broadcasts b
      LEFT JOIN mail_broadcast_receipts r
        ON r.proj_code = ${PROJ_CODE} AND r.broadcast_id = b.id AND r.user_id = ${userId}
     WHERE b.proj_code = ${PROJ_CODE}
       AND b.created_at >= (SELECT created_at FROM users WHERE id = ${userId})
       ${claimedCond}
     ORDER BY b.created_at DESC
     LIMIT 500
  `)) as unknown as Array<{ id: string; title: string; body: string; attach_type: string; attach_amount: number | null; expires_at: string | Date; claimed_at: string | Date | null; read_at: string | Date | null; created_at: string | Date }>;

  const iso = (v: string | Date | null): string | null => (v == null ? null : new Date(v).toISOString());
  const items: MailItem[] = [
    ...mRows.map((m): MailItem => ({
      id: m.id, kind: 'mail', title: m.title, body: m.body,
      attachType: m.attachType, attachAmount: m.attachAmount,
      claimedAt: m.claimedAt ? new Date(m.claimedAt).toISOString() : null,
      readAt: m.readAt ? new Date(m.readAt).toISOString() : null,
      expiresAt: new Date(m.expiresAt).toISOString(), createdAt: new Date(m.createdAt).toISOString(),
    })),
    ...bRows.map((b): MailItem => ({
      id: b.id, kind: 'bc', title: b.title, body: b.body,
      attachType: b.attach_type, attachAmount: b.attach_amount,
      claimedAt: iso(b.claimed_at), readAt: iso(b.read_at),
      expiresAt: new Date(b.expires_at).toISOString(), createdAt: new Date(b.created_at).toISOString(),
    })),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return { items: items.slice(offset, offset + limit) };
}

// ── 수령(§5.1 claim) — 단일 트랜잭션 ──

export type ClaimMailResult =
  | { ok: true; applied: boolean; attachType: 'diamonds'; balance: number; amount: number | null }
  | { ok: true; applied: boolean; attachType: 'pass'; passOutcome?: string }
  | { ok: false; reason: 'not-found' | 'expired' | 'pass-queue-full' | 'error' };

/** 우편 수령. 개별/브로드캐스트 분기. 단일 tx: 소유·만료(DB now)·claimed_at 가드 → 다이아 earn 또는 grantPassTx(만석 롤백). */
export async function claimMail(userId: string, id: string, kind: MailKind): Promise<ClaimMailResult> {
  try {
    return await db.transaction(async (tx) => {
      const nowRows = (await tx.execute(sql`select now() as "n"`)) as unknown as Array<{ n: Date }>;
      const now = new Date(nowRows[0].n);

      if (kind === 'bc') {
        const [b] = await tx.select().from(mailBroadcasts).where(and(eq(mailBroadcasts.projCode, PROJ_CODE), eq(mailBroadcasts.id, id))).limit(1);
        if (!b) return { ok: false as const, reason: 'not-found' as const };
        // cutoff — 발송 이전 가입자만 대상(§9)
        const [u] = await tx.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, userId)).limit(1);
        if (!u || u.createdAt.getTime() > b.createdAt.getTime()) return { ok: false as const, reason: 'not-found' as const };
        if (isMailExpired(now, b.expiresAt)) return { ok: false as const, reason: 'expired' as const };
        // lazy receipt claim 가드 — 신규 삽입(claimed) 또는 기존 미claim 행 UPDATE. 둘 다 실패면 이미 수령.
        const ins = await tx.insert(mailBroadcastReceipts)
          .values({ projCode: PROJ_CODE, broadcastId: b.id, userId, claimedAt: sql`now()` })
          .onConflictDoNothing({ target: [mailBroadcastReceipts.projCode, mailBroadcastReceipts.broadcastId, mailBroadcastReceipts.userId] })
          .returning({ id: mailBroadcastReceipts.id });
        let applied = ins.length > 0;
        if (!applied) {
          const upd = await tx.update(mailBroadcastReceipts).set({ claimedAt: sql`now()` })
            .where(and(eq(mailBroadcastReceipts.projCode, PROJ_CODE), eq(mailBroadcastReceipts.broadcastId, b.id), eq(mailBroadcastReceipts.userId, userId), isNull(mailBroadcastReceipts.claimedAt)))
            .returning({ id: mailBroadcastReceipts.id });
          applied = upd.length > 0;
        }
        const amount = b.attachAmount ?? 0; // 브로드캐스트는 다이아만(Q4)
        if (applied) {
          const w = await applyWalletTx(tx, userId, amount, 'mail', mailBroadcastKey(b.id, userId), mailBroadcastKey(b.id, userId));
          if (!w.ok) throw new Error('wallet-fail:' + w.reason);
          return { ok: true as const, applied: true, attachType: 'diamonds' as const, balance: w.balance, amount };
        }
        const [cur] = await tx.select({ balance: users.balance }).from(users).where(eq(users.id, userId)).limit(1);
        return { ok: true as const, applied: false, attachType: 'diamonds' as const, balance: cur?.balance ?? 0, amount };
      }

      // 개별 우편
      const [m] = await tx.select().from(mails).where(and(eq(mails.projCode, PROJ_CODE), eq(mails.id, id), eq(mails.userId, userId))).limit(1);
      if (!m || m.recalledAt) return { ok: false as const, reason: 'not-found' as const }; // 회수분=미존재 취급
      if (isMailExpired(now, m.expiresAt)) return { ok: false as const, reason: 'expired' as const };
      // 수령 가드(멱등) — claimed_at IS NULL rowcount 0이면 이미 수령
      const upd = await tx.update(mails).set({ claimedAt: sql`now()` })
        .where(and(eq(mails.projCode, PROJ_CODE), eq(mails.id, id), isNull(mails.claimedAt)))
        .returning({ id: mails.id });
      const applied = upd.length > 0;
      if (m.attachType === 'pass') {
        if (!applied) return { ok: true as const, applied: false, attachType: 'pass' as const };
        // 패스 첨부 — 같은 tx(B1). 만석이면 grantPassTx가 PASS_QUEUE_FULL throw → 전체 롤백(claimed_at 미설정 재수령, B2).
        const g = await grantPassTx(tx, userId, mailLedgerKey(id), now, 'admin', { rejectOnQueueFull: true });
        if (!g.ok) throw new Error('pass-grant:' + g.reason);
        return { ok: true as const, applied: true, attachType: 'pass' as const, passOutcome: g.outcome };
      }
      // 다이아 첨부
      const amount = m.attachAmount ?? 0;
      if (!applied) {
        const [cur] = await tx.select({ balance: users.balance }).from(users).where(eq(users.id, userId)).limit(1);
        return { ok: true as const, applied: false, attachType: 'diamonds' as const, balance: cur?.balance ?? 0, amount };
      }
      // sender='system:pass'(다이아 패스 일일 슬롯 우편, DIAMOND_PASS §2.3·§2.5) → 원장 reason='pass_daily'(클로백 Σ 추적)·
      //   멱등키 pass_daily:<user>:<pass>:<idx>·ref=mail:<id>. idem_key(pass_daily:<pass>:<idx>)에서 pass/idx 파싱. 일반 우편은 reason='mail'.
      if (m.sender === 'system:pass') {
        const parsed = parsePassMailKey(m.idemKey);
        if (parsed) {
          const w = await applyWalletTx(tx, userId, amount, 'pass_daily', passDailyKey(userId, parsed.passId, parsed.dayIndex), mailLedgerKey(id));
          if (!w.ok) throw new Error('wallet-fail:' + w.reason);
          return { ok: true as const, applied: true, attachType: 'diamonds' as const, balance: w.balance, amount };
        }
        // 파싱 실패(형식 이탈) → 일반 mail로 폴백(지급 유실 방지, 감사에서 sender로 구분 가능)
      }
      const w = await applyWalletTx(tx, userId, amount, 'mail', mailLedgerKey(id), mailLedgerKey(id));
      if (!w.ok) throw new Error('wallet-fail:' + w.reason);
      return { ok: true as const, applied: true, attachType: 'diamonds' as const, balance: w.balance, amount };
    });
  } catch (e) {
    if (e instanceof Error && e.message === PASS_QUEUE_FULL) return { ok: false, reason: 'pass-queue-full' };
    return { ok: false, reason: 'error' };
  }
}

// ── 읽음(§5.1 read) — 화면 진입 시 미확인 일괄 read_at ──

export async function readMail(userId: string): Promise<{ unreadMailCount: number; unclaimedMailCount: number }> {
  await db.transaction(async (tx) => {
    // 개별 — 미read 전부(만료·회수분 read 처리는 무해, 카운트엔 이미 제외)
    await tx.update(mails).set({ readAt: sql`now()` })
      .where(and(eq(mails.projCode, PROJ_CODE), eq(mails.userId, userId), isNull(mails.readAt)));
    // 브로드캐스트 — 대상(cutoff)·미만료 전부 receipt 확보 후 read_at set(lazy)
    await tx.execute(sql`
      INSERT INTO mail_broadcast_receipts (proj_code, broadcast_id, user_id, read_at)
        SELECT ${PROJ_CODE}, b.id, ${userId}, now() FROM mail_broadcasts b
         WHERE b.proj_code = ${PROJ_CODE} AND now() <= b.expires_at
           AND b.created_at >= (SELECT created_at FROM users WHERE id = ${userId})
        ON CONFLICT (proj_code, broadcast_id, user_id) DO NOTHING
    `);
    await tx.update(mailBroadcastReceipts).set({ readAt: sql`now()` })
      .where(and(eq(mailBroadcastReceipts.projCode, PROJ_CODE), eq(mailBroadcastReceipts.userId, userId), isNull(mailBroadcastReceipts.readAt)));
  });
  return mailCounts(userId);
}

// ── 관리자 발송·회수·이력(§5.3) ──

export type SendMailResult = { ok: true; mailId: string; deduped: boolean } | { ok: false; reason: string };

/** 개별 우편 발송 — INSERT onConflictDoNothing(proj, idem_key). 충돌이면 기존 mailId(deduped, R1). 입력 검증은 라우트가 선수행. */
export async function sendMail(params: {
  userId: string; title: string; body: string; attachType: string; attachAmount: number | null;
  expiresInDays?: number | null; idemKey: string; sender?: string;
}): Promise<SendMailResult> {
  const { userId, title, body, attachType, attachAmount, expiresInDays, idemKey, sender = 'admin' } = params;
  const expiresAt = mailExpiresAt(new Date(), attachType, expiresInDays);
  const ins = await db.insert(mails)
    .values({ projCode: PROJ_CODE, userId, idemKey, title, body, attachType, attachAmount, sender, expiresAt })
    .onConflictDoNothing({ target: [mails.projCode, mails.idemKey] })
    .returning({ id: mails.id });
  if (ins.length) return { ok: true, mailId: ins[0].id, deduped: false };
  const [existing] = await db.select({ id: mails.id }).from(mails).where(and(eq(mails.projCode, PROJ_CODE), eq(mails.idemKey, idemKey))).limit(1);
  return existing ? { ok: true, mailId: existing.id, deduped: true } : { ok: false, reason: 'insert-failed' };
}

export type SendBroadcastResult = { ok: true; broadcastId: string; deduped: boolean } | { ok: false; reason: string };

/** 브로드캐스트 발송(§9) — 다이아만(Q4). idem_key UNIQUE 멱등(R1). */
export async function sendBroadcast(params: {
  title: string; body: string; attachAmount: number; expiresInDays?: number | null; idemKey: string; sender?: string;
}): Promise<SendBroadcastResult> {
  const { title, body, attachAmount, expiresInDays, idemKey, sender = 'admin' } = params;
  const expiresAt = mailExpiresAt(new Date(), 'diamonds', expiresInDays);
  const ins = await db.insert(mailBroadcasts)
    .values({ projCode: PROJ_CODE, idemKey, title, body, attachType: 'diamonds', attachAmount, sender, expiresAt })
    .onConflictDoNothing({ target: [mailBroadcasts.projCode, mailBroadcasts.idemKey] })
    .returning({ id: mailBroadcasts.id });
  if (ins.length) return { ok: true, broadcastId: ins[0].id, deduped: false };
  const [existing] = await db.select({ id: mailBroadcasts.id }).from(mailBroadcasts).where(and(eq(mailBroadcasts.projCode, PROJ_CODE), eq(mailBroadcasts.idemKey, idemKey))).limit(1);
  return existing ? { ok: true, broadcastId: existing.id, deduped: true } : { ok: false, reason: 'insert-failed' };
}

export type RecallMailResult = { ok: true } | { ok: false; reason: 'already-claimed' };

/** 회수(§5.3 R2) — recalled_at 소프트마킹(claimed_at IS NULL AND recalled_at IS NULL). 수령분은 회수 불가(재화 이동 완료). */
export async function recallMail(id: string): Promise<RecallMailResult> {
  const upd = await db.update(mails).set({ recalledAt: sql`now()` })
    .where(and(eq(mails.projCode, PROJ_CODE), eq(mails.id, id), isNull(mails.claimedAt), isNull(mails.recalledAt)))
    .returning({ id: mails.id });
  return upd.length ? { ok: true } : { ok: false, reason: 'already-claimed' };
}

/** 관리자 발송 이력(§5.3·MAILBOX §7) — 유저별 필터·상태 표시. **관리자 발송분만**(sender != 'system:pass') —
 *  다이아 패스 일일 스케줄러 우편(system:pass)은 관리자 발송 이력이 아니라 제외(패스 현황은 DIAMOND_PASS 스탬프에서). */
export async function listAdminMail(userId?: string, limit = 200) {
  const conds = [eq(mails.projCode, PROJ_CODE), ne(mails.sender, 'system:pass')];
  if (userId) conds.push(eq(mails.userId, userId));
  return db.select().from(mails).where(and(...conds)).orderBy(desc(mails.createdAt)).limit(limit);
}
