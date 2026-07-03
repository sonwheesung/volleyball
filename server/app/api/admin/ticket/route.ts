// GET /api/admin/ticket — 전체 문의 목록(+유저 기기·잔액 조인, 필터 ?category=&status=). requireAdmin.
// 스냅샷 blob은 목록에 안 붙임(§13.17 P0-4) — 상세는 /api/admin/ticket/snapshot로 lazy load.
import { NextResponse } from 'next/server';
import { reportError } from '../../../../lib/observability';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { db } from '../../../../db';
import { tickets, users } from '../../../../db/schema';
import { isAdmin } from '../../../../lib/admin';
import { PROJ_CODE } from '../../../../lib/proj';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const url = new URL(req.url);
    const category = url.searchParams.get('category');
    const status = url.searchParams.get('status');
    const conds: SQL[] = [eq(tickets.projCode, PROJ_CODE)];
    if (category) conds.push(eq(tickets.category, category));
    if (status) conds.push(eq(tickets.status, status));
    const rows = await db
      .select({
        id: tickets.id, userId: tickets.userId, category: tickets.category, content: tickets.content,
        status: tickets.status, reply: tickets.reply,
        platform: tickets.platform, osVersion: tickets.osVersion, appVersion: tickets.appVersion,
        createdAt: tickets.createdAt, repliedAt: tickets.repliedAt,
        displayName: users.displayName, balance: users.balance, userPlatform: users.platform, userOsVersion: users.osVersion,
      })
      .from(tickets)
      .innerJoin(users, eq(tickets.userId, users.id))
      .where(and(...conds))
      .orderBy(desc(tickets.createdAt))
      .limit(200);
    return NextResponse.json({ ok: true, tickets: rows });
  } catch (e) { reportError(e, 'admin/ticket');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
