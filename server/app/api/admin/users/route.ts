// /api/admin/users — 운영 사용자 목록(가입일·최근접속·상태·잔액). requireAdmin(fail-closed §13.15).
//   상태 파생: withdrawn(deletedAt 있음) · inactive(14일+ 미접속 or 미접속) · active. 페이지네이션(limit/offset).
import { NextResponse } from 'next/server';
import { and, desc, eq, gte, isNull, isNotNull, lt, or, count } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db } from '../../../../db';
import { users } from '../../../../db/schema';
import { isAdmin } from '../../../../lib/admin';
import { PROJ_CODE } from '../../../../lib/proj';
import { reportError } from '../../../../lib/observability';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get('status') || 'all'; // all | active | inactive | withdrawn
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const inact = new Date(Date.now() - 14 * 86400000);

    const base = eq(users.projCode, PROJ_CODE);
    let where: SQL | undefined;
    if (status === 'withdrawn') where = and(base, isNotNull(users.deletedAt));
    else if (status === 'inactive') where = and(base, isNull(users.deletedAt), or(isNull(users.lastSeenAt), lt(users.lastSeenAt, inact)));
    else if (status === 'active') where = and(base, isNull(users.deletedAt), gte(users.lastSeenAt, inact));
    else where = base;

    const [tot] = await db.select({ n: count() }).from(users).where(where);
    const rows = await db
      .select({ id: users.id, name: users.displayName, provider: users.provider, balance: users.balance, platform: users.platform, appVersion: users.appVersion, createdAt: users.createdAt, lastSeenAt: users.lastSeenAt, deletedAt: users.deletedAt })
      .from(users).where(where).orderBy(desc(users.createdAt)).limit(limit).offset(offset);

    return NextResponse.json({ ok: true, total: tot?.n ?? 0, limit, offset, users: rows });
  } catch (e) {
    reportError(e, 'admin/users');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
