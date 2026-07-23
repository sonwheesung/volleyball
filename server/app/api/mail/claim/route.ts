// POST /api/mail/claim {id, kind} — 우편 수령(MAILBOX_SYSTEM §5.1). 단일 tx(소유·만료·claimed_at 가드 → 다이아 earn 또는 grantPassTx).
// Bearer→userId(익명 폴백 금지). money-path 관측행(R2, mail.claim.applied — 로깅 실패가 지급 되돌리지 않음).
import { NextResponse } from 'next/server';
import { reportError } from '../../../../lib/observability';
import { requireUserId } from '../../../../lib/auth';
import { claimMail, type MailKind } from '../../../../lib/mail';
import { logPaymentEventAfter } from '../../../../lib/paymentLog';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    if (!userId) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
    const b = (await req.json()) as { id?: string; kind?: string };
    const id = b.id;
    const kind: MailKind = b.kind === 'bc' ? 'bc' : 'mail';
    if (!id) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });

    const r = await claimMail(userId, id, kind);
    if (!r.ok) {
      const status = r.reason === 'not-found' ? 404 : r.reason === 'error' ? 500 : 409;
      return NextResponse.json({ ok: false, reason: r.reason }, { status });
    }
    // 관측행(R2) — 실제 지급이 반영된 경우만(applied). 커밋 뒤 fire-and-forget.
    if (r.applied) {
      logPaymentEventAfter({
        source: 'mail', stage: 'mail.claim.applied', ok: true, outcome: 'applied', userId,
        idempotencyKey: `${kind === 'bc' ? 'mail_bc' : 'mail'}:${id}`,
        diamondsDelta: r.attachType === 'diamonds' ? r.amount : null,
        balanceAfter: r.attachType === 'diamonds' ? r.balance : null,
        detail: { kind, attachType: r.attachType },
      });
    }
    if (r.attachType === 'pass') return NextResponse.json({ ok: true, applied: r.applied, pass: r.passOutcome ?? null });
    return NextResponse.json({ ok: true, applied: r.applied, balance: r.balance });
  } catch (e) { reportError(e, 'mail/claim');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
