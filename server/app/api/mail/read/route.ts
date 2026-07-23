// POST /api/mail/read — 우편함 화면 진입 시 미확인 일괄 읽음(MAILBOX_SYSTEM §5.1·§6.3). Bearer→userId. 배지 소등(read_at).
// typed 응답 {ok, unreadMailCount:0, unclaimedMailCount:<n>}(R4).
import { NextResponse } from 'next/server';
import { reportError } from '../../../../lib/observability';
import { requireUserId } from '../../../../lib/auth';
import { readMail } from '../../../../lib/mail';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    if (!userId) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
    const { unreadMailCount, unclaimedMailCount } = await readMail(userId);
    return NextResponse.json({ ok: true, unreadMailCount, unclaimedMailCount });
  } catch (e) { reportError(e, 'mail/read');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
