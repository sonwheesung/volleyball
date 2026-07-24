// POST /api/admin/ticket/reply — 문의 답변/상태변경. body: { ticketId, reply, status? }. requireAdmin.
import { NextResponse } from 'next/server';
import { reportError } from '../../../../../lib/observability';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../../../../db';
import { tickets } from '../../../../../db/schema';
import { isAdmin } from '../../../../../lib/admin';
import { PROJ_CODE } from '../../../../../lib/proj';

export const dynamic = 'force-dynamic';

// 상태 워크플로: open(대기) → reviewing(확인 중) → answered(답변완료) + refunded(환불완료). 관리자가 답변 시 직접 지정.
const STATUSES = new Set(['open', 'reviewing', 'answered', 'refunded', 'replied', 'resolved']); // replied/resolved=레거시 허용

export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const b = (await req.json()) as { ticketId?: string; reply?: string; status?: string };
    if (!b.ticketId) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    const reply = typeof b.reply === 'string' ? b.reply.slice(0, 4000) : undefined;
    const status = b.status && STATUSES.has(b.status) ? b.status : reply ? 'answered' : undefined;
    const patch: Record<string, unknown> = { repliedAt: sql`now()` };
    if (reply !== undefined) patch.reply = reply;
    if (status) patch.status = status;
    // projCode 스코프 필수(§13.2 멀티게임 격리) — 타 게임 티켓에 답변이 박히는 것 차단(공지 F1과 동일 클래스).
    // .returning()으로 rowcount 확인 → 0건이면 404(허위 ok 금지 — 운영자가 "답변 완료"로 오인하던 결함).
    const r = await db.update(tickets).set(patch)
      .where(and(eq(tickets.projCode, PROJ_CODE), eq(tickets.id, b.ticketId)))
      .returning({ id: tickets.id });
    if (!r.length) return NextResponse.json({ ok: false, reason: 'not-found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) { reportError(e, 'admin/ticket/reply');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
