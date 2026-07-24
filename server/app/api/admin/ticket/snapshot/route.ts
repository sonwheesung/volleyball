// GET /api/admin/ticket/snapshot?ticketId= — 티켓의 진단 스냅샷 lazy load(§13.17 P0-4, 상세 열 때만). requireAdmin.
import { NextResponse } from 'next/server';
import { reportError } from '../../../../../lib/observability';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../../../../db';
import { diagnosticSnapshots, tickets } from '../../../../../db/schema';
import { isAdmin } from '../../../../../lib/admin';
import { PROJ_CODE } from '../../../../../lib/proj';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const ticketId = new URL(req.url).searchParams.get('ticketId');
    if (!ticketId) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    // proj 스코프 필수 — 진단 스냅샷은 유저 세이브 통째(최고 민감). 티켓과 조인해 **이 게임의 티켓**일 때만 반환,
    // 아니면 404(타 게임 유저 스냅샷 유출 차단 — 공지 F1과 동일 클래스). 정상 경로 응답 모양은 불변.
    const own = await db.select({ id: tickets.id }).from(tickets)
      .where(and(eq(tickets.projCode, PROJ_CODE), eq(tickets.id, ticketId))).limit(1);
    if (!own.length) return NextResponse.json({ ok: false, reason: 'not-found' }, { status: 404 });
    const rows = await db
      .select({ snapshot: diagnosticSnapshots.snapshot, createdAt: diagnosticSnapshots.createdAt })
      .from(diagnosticSnapshots)
      .where(and(eq(diagnosticSnapshots.projCode, PROJ_CODE), eq(diagnosticSnapshots.ticketId, ticketId)))
      .orderBy(desc(diagnosticSnapshots.createdAt))
      .limit(1);
    return NextResponse.json({ ok: true, snapshot: rows[0]?.snapshot ?? null, createdAt: rows[0]?.createdAt ?? null });
  } catch (e) { reportError(e, 'admin/ticket/snapshot');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
