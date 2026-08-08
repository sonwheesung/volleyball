// /api/admin/achievements — 업적별 달성 유저 수(달성율). requireAdmin(fail-closed §13.15).
//   원천: walletLedger(reason='achievement', ref=업적id) — 업적 보상 적립이 계정평생 1회(achKey 멱등)라 ref별 고유유저=달성자.
//   결정론 격리 유지(서버 원장은 다이아 진실 — 시드/리플레이 무관). 카탈로그(제목)는 ops 페이지가 매핑.
//   ※ **내부(운영자) 계정 제외(§13.30)** — 분자(달성 유저)·분모(총가입) 양쪽에서 뺀다. 한쪽만 빼면 비율이 더 틀어진다.
import { NextResponse } from 'next/server';
import { and, eq, isNull, countDistinct, count, notInArray } from 'drizzle-orm';
import { db } from '../../../../db';
import { users, walletLedger } from '../../../../db/schema';
import { isAdmin } from '../../../../lib/admin';
import { PROJ_CODE } from '../../../../lib/proj';
import { reportError } from '../../../../lib/observability';
import { internalScope, internalMeta } from '../../../../lib/internalScope';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const scope = await internalScope(req);

    // 분모 — 내부 계정 제외한 총가입(비삭제)
    const [tot] = await db.select({ n: count() }).from(users)
      .where(and(eq(users.projCode, PROJ_CODE), isNull(users.deletedAt),
        ...(scope.includeInternal ? [] : [eq(users.internal, false)])));
    const totalUsers = tot?.n ?? 0;

    // 분자 — 업적별 달성 유저. notInArray는 빈 배열이면 SQL이 깨지므로 ids가 있을 때만 건다.
    const ids = [...scope.ids];
    const grouped = await db.select({ ref: walletLedger.ref, n: countDistinct(walletLedger.userId) }).from(walletLedger)
      .where(and(eq(walletLedger.projCode, PROJ_CODE), eq(walletLedger.reason, 'achievement'),
        ...(ids.length ? [notInArray(walletLedger.userId, ids)] : [])))
      .groupBy(walletLedger.ref);
    const counts: Record<string, number> = {};
    for (const g of grouped) { if (g.ref) counts[g.ref] = g.n; }

    return NextResponse.json({ ok: true, totalUsers, counts, internal: internalMeta(scope) });
  } catch (e) {
    reportError(e, 'admin/achievements');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
