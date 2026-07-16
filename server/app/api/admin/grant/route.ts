// POST /api/admin/grant — 다이아 수동 지급(양수 조정). body: { userId, amount>0, note, key }. requireAdmin(fail-closed §13.15).
// admin/refund(회수·음수)의 **대칭 지급 경로**(§13.17 P2-b, 2026-07-16 결제표면 감사). 콘솔 "수동 지갑 조정" 폼이
//   금액 부호로 분기: 음수=회수(admin/refund), 양수=지급(여기). 티켓 없는 dropped(§13.18 B1 익명환불 등) 수동 대응이
//   curl 의존이던 것을 콘솔로.
// 멱등키는 **콘솔 폼이 1회 생성**(manual:<uuid> — 서버 생성 시 더블클릭=이중지급). ref=note가 감사기록(원장 5년).
// reason='adjust'(양수)라 잔액게이트 무관하게 통과(적립은 음수 잔액에서도 통과 — §13.17 P0-1). purchase_event 감사행 기록.
import { NextResponse } from 'next/server';
import { reportError } from '../../../../lib/observability';
import { db } from '../../../../db';
import { applyWalletTx } from '../../../../lib/wallet';
import { isAdmin } from '../../../../lib/admin';
import { logPaymentEventAfter } from '../../../../lib/paymentLog';

export const dynamic = 'force-dynamic';

const GRANT_CAP = 100000; // 1회 지급 상한(오타 방지 — refund와 대칭)

export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const b = (await req.json()) as { userId?: string; amount?: number; note?: string; key?: string };
    const amount = Math.floor(Number(b.amount));
    const note = (b.note ?? '').trim();
    if (!b.userId || !b.key || !note || !Number.isFinite(amount) || amount <= 0 || amount > GRANT_CAP) {
      return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    }
    const userId = b.userId, key = b.key;
    const r = await db.transaction(async (tx) => {
      const w = await applyWalletTx(tx, userId, amount, 'adjust', key, note.slice(0, 200));
      if (!w.ok) throw new Error('wallet:' + w.reason); // no-user 등 → 롤백
      return w;
    });
    // 감사행(§13.22) — 트랜잭션 커밋 뒤 fire-and-forget(로깅 실패가 지급 되돌리지 않음).
    logPaymentEventAfter({ source: 'admin', stage: 'admin.grant.applied', ok: true, outcome: r.applied ? 'applied' : 'deduped', userId, idempotencyKey: key, diamondsDelta: amount, balanceAfter: r.balance, detail: { note: note.slice(0, 200) } });
    return NextResponse.json({ ok: true, balance: r.balance, applied: r.applied });
  } catch (e) { reportError(e, 'admin/grant');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
