// GET /api/admin/ticket/snapshot?ticketId= — 티켓의 진단 스냅샷 lazy load(§13.17 P0-4, 상세 열 때만). requireAdmin.
import { NextResponse } from 'next/server';
import { reportError } from '../../../../../lib/observability';
import { desc, eq } from 'drizzle-orm';
import { db } from '../../../../../db';
import { diagnosticSnapshots } from '../../../../../db/schema';
import { isAdmin } from '../../../../../lib/admin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const ticketId = new URL(req.url).searchParams.get('ticketId');
    if (!ticketId) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    const rows = await db
      .select({ snapshot: diagnosticSnapshots.snapshot, createdAt: diagnosticSnapshots.createdAt })
      .from(diagnosticSnapshots)
      .where(eq(diagnosticSnapshots.ticketId, ticketId))
      .orderBy(desc(diagnosticSnapshots.createdAt))
      .limit(1);
    return NextResponse.json({ ok: true, snapshot: rows[0]?.snapshot ?? null, createdAt: rows[0]?.createdAt ?? null });
  } catch (e) { reportError(e, 'admin/ticket/snapshot');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
