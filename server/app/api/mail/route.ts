// GET /api/mail?status=all|claimed|unclaimed&cursor= — 우편함 목록(MAILBOX_SYSTEM §5.1). Bearer→userId(익명 폴백 금지 §13.17 P0-5).
// 서버 재조회 필터(status). 개별 + 대상 브로드캐스트 합성. proj 스코프(R5).
import { NextResponse } from 'next/server';
import { reportError } from '../../../lib/observability';
import { requireUserId } from '../../../lib/auth';
import { listMail, type MailStatus } from '../../../lib/mail';

export const dynamic = 'force-dynamic';

const STATUSES: MailStatus[] = ['all', 'claimed', 'unclaimed'];

export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    if (!userId) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
    const url = new URL(req.url);
    const raw = url.searchParams.get('status') ?? 'all';
    const status: MailStatus = (STATUSES as string[]).includes(raw) ? (raw as MailStatus) : 'all';
    const offset = Math.max(0, Math.floor(Number(url.searchParams.get('cursor') ?? 0)) || 0);
    const { items } = await listMail(userId, status, 30, offset);
    return NextResponse.json({ ok: true, items, nextCursor: items.length === 30 ? offset + 30 : null });
  } catch (e) { reportError(e, 'mail');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
