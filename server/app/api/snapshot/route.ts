// POST /api/snapshot — 문의에 진단 스냅샷 첨부(§13.17). body: { ticketId, snapshot }. requireUserId + 티켓 소유권 확인.
// 별도 테이블(diagnostic_snapshots) 저장 — 90일 보관(retention). 전지훈련 내역·로그·선수가 재생돼 담김.
import { NextResponse } from 'next/server';
import { reportError } from '../../../lib/observability';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../db';
import { tickets, diagnosticSnapshots } from '../../../db/schema';
import { requireUserId } from '../../../lib/auth';
import { PROJ_CODE } from '../../../lib/proj';

export const dynamic = 'force-dynamic';

// #4(2026-07-07): 스냅샷 blob 크기 상한 256KB — 무제한 JSON blob 저장(스토리지/컴퓨트 고갈) 차단.
//   정상 스냅샷은 수백KB 이하(_dv_savesize 100시즌 744KB는 raw 세이브 기준, 진단 스냅샷은 최근 10시즌 범위라 더 작음).
export const SNAPSHOT_MAX_BYTES = 262144;

export async function POST(req: Request) {
  const userId = await requireUserId(req);
  if (!userId) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const b = (await req.json()) as { ticketId?: string; snapshot?: unknown };
    if (!b.ticketId || b.snapshot === undefined) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    // 크기 상한(#4) — 직렬화 길이가 256KB 초과면 413(스토리지 고갈 방어). 소유권 체크 전에 값싸게 컷.
    const size = JSON.stringify(b.snapshot).length;
    if (size > SNAPSHOT_MAX_BYTES) return NextResponse.json({ ok: false, reason: 'too-large' }, { status: 413 });
    // 소유권 — 내 티켓에만 첨부
    const own = await db.select({ id: tickets.id }).from(tickets).where(and(eq(tickets.id, b.ticketId), eq(tickets.userId, userId))).limit(1);
    if (!own.length) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
    await db.insert(diagnosticSnapshots).values({ projCode: PROJ_CODE, ticketId: b.ticketId, snapshot: b.snapshot });
    return NextResponse.json({ ok: true });
  } catch (e) { reportError(e, 'snapshot');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
