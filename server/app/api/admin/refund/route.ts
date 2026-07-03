// POST /api/admin/refund — 다이아 회수(환불 반영). body: { userId, amount>0, note, ticketId?, key }. requireAdmin.
// 단일 트랜잭션(§13.17 P0-3): applyWalletTx(−amount, 'refund', key) + 티켓 status='refunded'. 음수 balance 허용(reason='refund').
// 멱등키는 **관리자 UI가 생성**(P0-2 — 서버 생성 시 더블클릭 이중환불). ref=note가 곧 감사기록(원장 5년 보존).
// ※실 결제 환불(카드)은 스토어 정책 경유(#43 웹훅) — 이 라우트는 재화(다이아) 조정만.
import { NextResponse } from 'next/server';
import { reportError } from '../../../../lib/observability';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../../../db';
import { tickets } from '../../../../db/schema';
import { applyWalletTx } from '../../../../lib/wallet';
import { isAdmin } from '../../../../lib/admin';

export const dynamic = 'force-dynamic';

const REFUND_CAP = 100000; // 1회 회수 상한(오타 방지)

export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const b = (await req.json()) as { userId?: string; amount?: number; note?: string; ticketId?: string; key?: string };
    const amount = Math.floor(Number(b.amount));
    const note = (b.note ?? '').trim();
    if (!b.userId || !b.key || !note || !Number.isFinite(amount) || amount <= 0 || amount > REFUND_CAP) {
      return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    }
    const userId = b.userId, key = b.key, ticketId = b.ticketId;
    const r = await db.transaction(async (tx) => {
      const w = await applyWalletTx(tx, userId, -amount, 'refund', key, note.slice(0, 200));
      if (!w.ok) throw new Error('wallet:' + w.reason); // no-user 등 → 롤백
      // 멱등(applied:false=이미 환불)이어도 티켓 status는 refunded로 수렴(§13.17 P0-3)
      if (ticketId) {
        await tx.update(tickets).set({ status: 'refunded', reply: note.slice(0, 4000), repliedAt: sql`now()` }).where(eq(tickets.id, ticketId));
      }
      return w;
    });
    return NextResponse.json({ ok: true, balance: r.balance, applied: r.applied });
  } catch (e) { reportError(e, 'admin/refund');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
