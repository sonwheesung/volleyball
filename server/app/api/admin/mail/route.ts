// /api/admin/mail — 우편 발송(개별/브로드캐스트, POST)·이력(GET)·회수(DELETE). requireAdmin(fail-closed §13.15 P0-B).
// idem_key dedup(R1)·MAIL_MAX_GRANT 캡·패스 첨부는 개별만(Q4)·purchase_event 관측(R2, admin.mail.sent|recalled).
import { NextResponse } from 'next/server';
import { reportError } from '../../../../lib/observability';
import { db } from '../../../../db';
import { users } from '../../../../db/schema';
import { and, eq } from 'drizzle-orm';
import { isAdmin } from '../../../../lib/admin';
import { ensureProj } from '../../../../lib/wallet';
import { PROJ_CODE } from '../../../../lib/proj';
import { sendMail, sendBroadcast, recallMail, listAdminMail, validateAttach } from '../../../../lib/mail';
import { logPaymentEventAfter } from '../../../../lib/paymentLog';

export const dynamic = 'force-dynamic';

// 발송(개별/브로드캐스트). target='broadcast'=전체(다이아만, Q4) · 그 외=개별.
export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const b = (await req.json()) as {
      target?: string; userId?: string; title?: string; body?: string;
      attachType?: string; attachAmount?: number | null; expiresInDays?: number | null; idemKey?: string;
    };
    const title = (b.title ?? '').trim();
    const body = (b.body ?? '').trim();
    const attachType = b.attachType ?? 'diamonds';
    const idemKey = (b.idemKey ?? '').trim();
    if (!title || !body || !idemKey) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    const v = validateAttach(attachType, b.attachAmount);
    if (!v.ok) return NextResponse.json({ ok: false, reason: v.reason }, { status: 400 }); // bad-amount | over-cap | bad-type
    await ensureProj();

    if (b.target === 'broadcast') {
      if (attachType !== 'diamonds') return NextResponse.json({ ok: false, reason: 'broadcast-diamonds-only' }, { status: 400 }); // Q4
      const r = await sendBroadcast({ title, body, attachAmount: v.amount as number, expiresInDays: b.expiresInDays, idemKey });
      if (!r.ok) return NextResponse.json({ ok: false, reason: r.reason }, { status: 500 });
      logPaymentEventAfter({ source: 'admin', stage: 'admin.mail.sent', ok: true, outcome: r.deduped ? 'deduped' : 'applied', idempotencyKey: `mail_bc:${r.broadcastId}`, diamondsDelta: v.amount ?? null, detail: { target: 'broadcast', attachType } });
      return NextResponse.json({ ok: true, broadcastId: r.broadcastId, deduped: r.deduped });
    }

    // 개별 — 대상 유저 존재·비탈퇴 검증(쿠폰 C3 패턴) + **projCode 스코프**(§13.2 멀티게임 격리, R3 2026-07-24 —
    //   타 게임 유저 앞으로 우편이 발송돼 죽은 외래 참조 행이 생기던 결함). 없으면 기존 실패 경로 그대로 400 no-such-user.
    if (!b.userId) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    let target: { deletedAt: Date | null } | null = null;
    try {
      const u = await db.select({ deletedAt: users.deletedAt }).from(users)
        .where(and(eq(users.projCode, PROJ_CODE), eq(users.id, b.userId))).limit(1);
      target = u.length ? u[0] : null;
    } catch { target = null; } // 잘못된 uuid 형식도 no-such-user로
    if (!target || target.deletedAt) return NextResponse.json({ ok: false, reason: 'no-such-user' }, { status: 400 });

    const r = await sendMail({ userId: b.userId, title, body, attachType, attachAmount: v.amount, expiresInDays: b.expiresInDays, idemKey });
    if (!r.ok) return NextResponse.json({ ok: false, reason: r.reason }, { status: 500 });
    logPaymentEventAfter({ source: 'admin', stage: 'admin.mail.sent', ok: true, outcome: r.deduped ? 'deduped' : 'applied', userId: b.userId, idempotencyKey: `mail:${r.mailId}`, diamondsDelta: attachType === 'diamonds' ? (v.amount ?? null) : null, detail: { target: 'user', attachType } });
    return NextResponse.json({ ok: true, mailId: r.mailId, deduped: r.deduped });
  } catch (e) { reportError(e, 'admin/mail');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}

// 발송 이력(개별) — userId 필터 옵션.
export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const userId = new URL(req.url).searchParams.get('userId') ?? undefined;
    const rows = await listAdminMail(userId);
    return NextResponse.json({ ok: true, mails: rows });
  } catch (e) { reportError(e, 'admin/mail');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}

// 회수(개별) = recalled_at 소프트마킹(R2). 수령분은 회수 불가(already-claimed).
export async function DELETE(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    let id = new URL(req.url).searchParams.get('id') ?? '';
    if (!id) { try { const b = (await req.json()) as { id?: string }; id = b.id ?? ''; } catch { /* no body */ } }
    if (!id) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    const r = await recallMail(id);
    if (!r.ok) return NextResponse.json({ ok: false, reason: r.reason }, { status: 409 });
    logPaymentEventAfter({ source: 'admin', stage: 'admin.mail.recalled', ok: true, outcome: 'cancelled', idempotencyKey: `mail:${id}`, detail: { mailId: id } });
    return NextResponse.json({ ok: true });
  } catch (e) { reportError(e, 'admin/mail');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
