// 데이터 수명주기 (BACKEND_SYSTEM §13.10) — 필요없는 로그는 파기, 수입 집계는 영구.
// 크론(/api/cron/purge)이 매일: ① 롤업(결제→stats_daily) → ② 티어별 파기. throw 없이 count 반환.
import { and, eq, lt, notInArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { walletLedger, statsDaily } from '../db/schema';
import { PROJ_CODE } from './proj';

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
  // 결제 원장 일별 집계(현재: 다이아 지급 카운트/합. KRW 매출은 Purchase 테이블 #43 연결 시 채움)
  const pRows = (await db.execute(sql`
    SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day,
           count(*)::int AS purchase_count,
           coalesce(sum(delta), 0)::int AS diamonds_purchased
    FROM wallet_ledger
    WHERE proj_code = ${PROJ_CODE} AND reason = 'purchase'
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

/** 티어별 파기 — 경과분 delete만(현재 데이터 무영향). 결제/환불(5년)은 법정·수입이라 여기서 건드리지 않음(수년 뒤 별도·롤업 보장 후). */
export async function purgeExpired(): Promise<{ economyLedger: number }> {
  const deleted = await db
    .delete(walletLedger)
    .where(
      and(
        eq(walletLedger.projCode, PROJ_CODE),
        notInArray(walletLedger.reason, ['purchase', 'refund']), // 재무 원장 보존
        lt(walletLedger.createdAt, sql`now() - make_interval(days => ${RETENTION_DAYS.economyLedger})`),
      ),
    )
    .returning({ id: walletLedger.id });
  return { economyLedger: deleted.length };
}
