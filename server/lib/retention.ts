// 데이터 수명주기 (BACKEND_SYSTEM §13.10) — 필요없는 로그는 파기, 수입 집계는 영구.
// 크론(/api/cron/purge)이 매일: ① 롤업(결제→stats_daily) → ② 티어별 파기. throw 없이 count 반환.
import { and, eq, inArray, isNotNull, lt, notInArray, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { walletLedger, statsDaily, diagnosticSnapshots, tickets, mails, mailBroadcasts, mailBroadcastReceipts } from '../db/schema';
import { PROJ_CODE } from './proj';
import { MAIL_PURGE_GRACE_DAYS } from './econ';

// 보관 티어(일). 결제/환불=법정 5년(수입), 게임경제=2년(재무 아님). 로그/텔레메트리는 미래 테이블(각 90일).
export const RETENTION_DAYS = {
  financialLedger: 1825, // 5년 — reason=purchase/refund (법정 + 수입 대시보드)
  economyLedger: 730, // 2년 — ad/achievement/camp/coupon/adjust (재무 아님·벌크)
  tickets: 1095, // 3년 (미래 tickets 테이블)
  serverLogs: 90, // (미래 logs 테이블)
  telemetryRaw: 90, // (미래 heartbeat — 일 집계는 stats_daily로 영구)
} as const;

/** 최근 2일 결제·신규가입을 stats_daily로 재집계 upsert(멱등). 수입 원본이 파기돼도 여기 집계는 영구 생존. */
export async function rollupRecent(): Promise<number> {
  // TODO(#43): 실 결제환불 웹훅 붙으면 reason='refund'를 순매출에서 차감해야 함(현재는 다이아 회수라 매출 무관 — 과대계상 주의).
  // 결제 원장 일별 집계(현재: 다이아 지급 카운트/합. KRW 매출은 Purchase 테이블 #43 연결 시 채움)
  // §13.18 D1 — 샌드박스 집계 제외(웹훅·크론·관리자 3경로 대칭): statsDaily의 두 라이터(이벤트 시 증분 recordPurchaseRevenue +
  //   여기 크론 재집계)가 같은 행을 쓰므로, 웹훅이 제외한 샌드박스 지급(ref='<productId>:sandbox')을 이 재집계도 대칭 제외해야
  //   덮어쓰기로 필터가 무효화되지 않는다. reason='purchase' 행의 ref는 실제로 non-null이나 NULL-안전하게 처리.
  const pRows = (await db.execute(sql`
    SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day,
           count(*)::int AS purchase_count,
           coalesce(sum(delta), 0)::int AS diamonds_purchased
    FROM wallet_ledger
    WHERE proj_code = ${PROJ_CODE} AND reason = 'purchase'
      AND (ref IS NULL OR ref NOT LIKE '%:sandbox')
      AND created_at >= now() - make_interval(days => 2)
    GROUP BY 1`)) as unknown as Array<{ day: string; purchase_count: number; diamonds_purchased: number }>;
  const uRows = (await db.execute(sql`
    SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day, count(*)::int AS new_users
    FROM users
    WHERE proj_code = ${PROJ_CODE} AND created_at >= now() - make_interval(days => 2)
    GROUP BY 1`)) as unknown as Array<{ day: string; new_users: number }>;

  const byDay = new Map<string, { purchaseCount: number; diamondsPurchased: number; newUsers: number }>();
  const get = (d: string) => byDay.get(d) ?? { purchaseCount: 0, diamondsPurchased: 0, newUsers: 0 };
  for (const r of pRows) byDay.set(r.day, { ...get(r.day), purchaseCount: r.purchase_count, diamondsPurchased: r.diamonds_purchased });
  for (const r of uRows) byDay.set(r.day, { ...get(r.day), newUsers: r.new_users });

  let n = 0;
  for (const [day, a] of byDay) {
    await db
      .insert(statsDaily)
      .values({ projCode: PROJ_CODE, day, purchaseCount: a.purchaseCount, diamondsPurchased: a.diamondsPurchased, newUsers: a.newUsers })
      .onConflictDoUpdate({
        target: [statsDaily.projCode, statsDaily.day],
        set: { purchaseCount: a.purchaseCount, diamondsPurchased: a.diamondsPurchased, newUsers: a.newUsers, updatedAt: sql`now()` },
      });
    n++;
  }
  return n;
}

/** 티어별 파기 — 경과분 delete만. 결제/환불(5년)·쿠폰사용기록(§13.14 P0-C)은 파기 제외. */
export async function purgeExpired(): Promise<{ economyLedger: number; snapshots: number; tickets: number }> {
  const eco = await db
    .delete(walletLedger)
    .where(
      and(
        eq(walletLedger.projCode, PROJ_CODE),
        notInArray(walletLedger.reason, ['purchase', 'refund']), // 재무 원장 보존
        lt(walletLedger.createdAt, sql`now() - make_interval(days => ${RETENTION_DAYS.economyLedger})`),
      ),
    )
    .returning({ id: walletLedger.id });
  // 진단 스냅샷 90일(§13.17 P0-4 — 큰 재생 blob, 오래되면 진단 가치 0). 먼저 파기해야 티켓 파기 시 FK 안전.
  const snaps = await db
    .delete(diagnosticSnapshots)
    .where(and(eq(diagnosticSnapshots.projCode, PROJ_CODE), lt(diagnosticSnapshots.createdAt, sql`now() - make_interval(days => ${RETENTION_DAYS.serverLogs})`)))
    .returning({ id: diagnosticSnapshots.id });
  // 문의 3년(스냅샷은 이미 90일에 파기돼 FK 종속 없음)
  const tix = await db
    .delete(tickets)
    .where(and(eq(tickets.projCode, PROJ_CODE), lt(tickets.createdAt, sql`now() - make_interval(days => ${RETENTION_DAYS.tickets})`)))
    .returning({ id: tickets.id });
  const mail = await purgeExpiredMail();
  return { economyLedger: eco.length, snapshots: snaps.length, tickets: tix.length, ...mail };
}

/** 우편함 만료·회수 + 유예(MAIL_PURGE_GRACE_DAYS) 물리삭제(MAILBOX §13.3 E11 Q2) — **원장(reason='mail')은 보존, 우편 메타만**.
 *  개별 mails: 만료+grace 경과 OR 회수+grace 경과분. 브로드캐스트: 만료+grace 경과분 — **receipts 선삭 → broadcasts 후삭**(FK 자식 먼저, R6). */
export async function purgeExpiredMail(): Promise<{ mails: number; mailBroadcastReceipts: number; mailBroadcasts: number }> {
  const cut = sql`now() - make_interval(days => ${MAIL_PURGE_GRACE_DAYS})`;
  const m = await db
    .delete(mails)
    .where(and(eq(mails.projCode, PROJ_CODE), or(lt(mails.expiresAt, cut), and(isNotNull(mails.recalledAt), lt(mails.recalledAt, cut)))))
    .returning({ id: mails.id });
  // 만료+유예 지난 브로드캐스트 id → receipts 먼저 파기(FK), 그 다음 broadcasts.
  const expiredBc = await db
    .select({ id: mailBroadcasts.id })
    .from(mailBroadcasts)
    .where(and(eq(mailBroadcasts.projCode, PROJ_CODE), lt(mailBroadcasts.expiresAt, cut)));
  const bcIds = expiredBc.map((b) => b.id);
  let receiptsPurged = 0, bcPurged = 0;
  if (bcIds.length) {
    const r = await db.delete(mailBroadcastReceipts).where(and(eq(mailBroadcastReceipts.projCode, PROJ_CODE), inArray(mailBroadcastReceipts.broadcastId, bcIds))).returning({ id: mailBroadcastReceipts.id });
    const bc = await db.delete(mailBroadcasts).where(and(eq(mailBroadcasts.projCode, PROJ_CODE), inArray(mailBroadcasts.id, bcIds))).returning({ id: mailBroadcasts.id });
    receiptsPurged = r.length; bcPurged = bc.length;
  }
  return { mails: m.length, mailBroadcastReceipts: receiptsPurged, mailBroadcasts: bcPurged };
}
