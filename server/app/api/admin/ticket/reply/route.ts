// POST /api/admin/ticket/reply — 문의 답변/상태변경. body: { ticketId, reply, status? }. requireAdmin.
import { NextResponse } from 'next/server';
import { reportError } from '../../../../../lib/observability';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../../../../db';
import { tickets } from '../../../../../db/schema';
import { isAdmin } from '../../../../../lib/admin';

export const dynamic = 'force-dynamic';

const STATUSES = new Set(['open', 'replied', 'resolved', 'refunded']);

export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const b = (await req.json()) as { ticketId?: string; reply?: string; status?: string };
    if (!b.ticketId) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    const reply = typeof b.reply === 'string' ? b.reply.slice(0, 4000) : undefined;
    const status = b.status && STATUSES.has(b.status) ? b.status : reply ? 'replied' : undefined;
    const patch: Record<string, unknown> = { repliedAt: sql`now()` };
    if (reply !== undefined) patch.reply = reply;
    if (status) patch.status = status;
    await db.update(tickets).set(patch).where(eq(tickets.id, b.ticketId));
    return NextResponse.json({ ok: true });
  } catch (e) { reportError(e, 'admin/ticket/reply');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
