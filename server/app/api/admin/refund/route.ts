// POST /api/admin/refund — 다이아 회수(환불 반영). body: { userId, amount>0, note, ticketId?, key }. requireAdmin.
// 단일 트랜잭션(§13.17 P0-3): applyWalletTx(−amount, 'refund', key) + 티켓 status='refunded'. 음수 balance 허용(reason='refund').
// 멱등키는 **관리자 UI가 생성**(P0-2 — 서버 생성 시 더블클릭 이중환불). ref=note가 곧 감사기록(원장 5년 보존).
// ※실 결제 환불(카드)은 스토어 정책 경유(#43 웹훅) — 이 라우트는 재화(다이아) 조정만.
// ⚠ **RC 자동환불과 이중차감 주의(§13.18)**: RC 웹훅 CANCELLATION/REFUND가 이미 `refund:<userId>:<storeTxnId>`로 다이아를
//    회수한다. **스토어 결제분은 여기서 수동 환불 금지**(RC가 처리) — 관리자 수동 환불은 RC가 못 잡는 건(광고/업적/굿윌)만.
//    두 경로 키가 달라(ticket키 vs storeTxn키) 자동 dedup 안 됨 → 운영 규칙으로 분리(§13.18 명문화).
import { NextResponse } from 'next/server';
import { reportError } from '../../../../lib/observability';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../../../db';
import { tickets } from '../../../../db/schema';
import { applyWalletTx } from '../../../../lib/wallet';
import { isAdmin } from '../../../../lib/admin';
import { PROJ_CODE } from '../../../../lib/proj';
import { logPaymentEventAfter } from '../../../../lib/paymentLog';

export const dynamic = 'force-dynamic';

const REFUND_CAP = 100000; // 1회 회수 상한(오타 방지)
// 티켓 매칭 0건 신호 — 트랜잭션 밖으로 던져 **전액 롤백**시키고 404로 번역(500 'error'와 구분).
const TICKET_NOT_FOUND = 'ticket-not-found';

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
      // projCode 스코프 필수(§13.2 멀티게임 격리, R1 2026-07-24) — 타 게임 티켓에 우리 note가 'refunded'로 박히던 결함.
      // .returning() rowcount 0(타 proj·미존재)이면 **트랜잭션 전체 롤백** → 404. "환불 금액만 나가고 티켓은 남 게임에
      // 찍히는" 부분 성공이 최악이라, 지갑 차감까지 되돌린다(admin write = proj 스코프 + rowcount 0이면 404 원칙).
      if (ticketId) {
        const t = await tx.update(tickets).set({ status: 'refunded', reply: note.slice(0, 4000), repliedAt: sql`now()` })
          .where(and(eq(tickets.projCode, PROJ_CODE), eq(tickets.id, ticketId)))
          .returning({ id: tickets.id });
        if (!t.length) throw new Error(TICKET_NOT_FOUND);
      }
      return w;
    });
    // 감사행(§13.22 · P2-d 퍼널) — 커밋 뒤 fire-and-forget. 티켓 환불·수동 회수 모두 source='admin'으로 관측.
    logPaymentEventAfter({ source: 'admin', stage: 'admin.refund.applied', ok: true, outcome: r.applied ? 'applied' : 'deduped', userId, idempotencyKey: key, diamondsDelta: -amount, balanceAfter: r.balance, detail: { note: note.slice(0, 200), ticketId: ticketId ?? null } });
    return NextResponse.json({ ok: true, balance: r.balance, applied: r.applied });
  } catch (e) {
    // 티켓 0건 롤백은 클라 오류(4xx)라 Sentry 보고 대상 아님 — 티켓 답변(reply)의 404와 대칭.
    if (e instanceof Error && e.message === TICKET_NOT_FOUND) return NextResponse.json({ ok: false, reason: 'not-found' }, { status: 404 });
    reportError(e, 'admin/refund');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
