// /api/ticket — 문의 등록(POST)·내 문의 목록(GET). requireUserId(익명 폴백 금지 §13.17 P0-5).
// 제출 시점 기기(진단)를 티켓에 박는다("어떤 폰서 문제났나"). 진단 스냅샷은 별도 /api/snapshot.
import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../../db';
import { tickets } from '../../../db/schema';
import { requireUserId } from '../../../lib/auth';
import { ensureProj } from '../../../lib/wallet';
import { PROJ_CODE } from '../../../lib/proj';

export const dynamic = 'force-dynamic';

const CATS = new Set(['bug', 'suggestion', 'question', 'etc', 'refund']);
const clip = (v: unknown, max: number): string | null => (typeof v === 'string' && v ? v.slice(0, max) : null);

export async function POST(req: Request) {
  const userId = await requireUserId(req);
  if (!userId) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const b = (await req.json()) as { category?: string; content?: string; device?: { platform?: string; osVersion?: string; appVersion?: string } };
    const category = CATS.has(b.category ?? '') ? (b.category as string) : 'etc';
    const content = (b.content ?? '').trim();
    if (content.length < 5) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    await ensureProj();
    const ins = await db
      .insert(tickets)
      .values({
        projCode: PROJ_CODE, userId, category, content: content.slice(0, 4000),
        platform: clip(b.device?.platform, 32), osVersion: clip(b.device?.osVersion, 32), appVersion: clip(b.device?.appVersion, 32),
      })
      .returning({ id: tickets.id });
    return NextResponse.json({ ok: true, ticketId: ins[0].id });
  } catch {
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const userId = await requireUserId(req);
  if (!userId) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const rows = await db
      .select({ id: tickets.id, category: tickets.category, content: tickets.content, status: tickets.status, reply: tickets.reply, createdAt: tickets.createdAt })
      .from(tickets)
      .where(and(eq(tickets.projCode, PROJ_CODE), eq(tickets.userId, userId)))
      .orderBy(desc(tickets.createdAt))
      .limit(50);
    return NextResponse.json({ ok: true, tickets: rows });
  } catch {
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
