// POST /api/snapshot — 문의에 진단 스냅샷 첨부(§13.17). body: { ticketId, snapshot }. requireUserId + 티켓 소유권 확인.
// 별도 테이블(diagnostic_snapshots) 저장 — 90일 보관(retention). 전지훈련 내역·로그·선수가 재생돼 담김.
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../db';
import { tickets, diagnosticSnapshots } from '../../../db/schema';
import { requireUserId } from '../../../lib/auth';
import { PROJ_CODE } from '../../../lib/proj';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const userId = await requireUserId(req);
  if (!userId) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const b = (await req.json()) as { ticketId?: string; snapshot?: unknown };
    if (!b.ticketId || b.snapshot === undefined) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    // 소유권 — 내 티켓에만 첨부
    const own = await db.select({ id: tickets.id }).from(tickets).where(and(eq(tickets.id, b.ticketId), eq(tickets.userId, userId))).limit(1);
    if (!own.length) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
    await db.insert(diagnosticSnapshots).values({ projCode: PROJ_CODE, ticketId: b.ticketId, snapshot: b.snapshot });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
