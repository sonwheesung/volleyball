// POST /api/pass/claim — 출석 패스 일일 수령(ATTENDANCE_PASS_SYSTEM §2.3). Bearer→userId(익명 폴백 금지 — 특정 유저 귀속).
// 앱 포그라운드 진입(+온라인) 시 자동 호출(syncWallet 합류). 서버가 리셋보정 오늘 KST 날짜·dayIndex 계산 → 활성 패스 슬롯 멱등 지급.
// typed 결과: ok(claimed|already|no-pass) · unauthorized(401) · error(500). 오프라인/미보유는 조용히 no-op(클라 토스트 없음).
import { NextResponse } from 'next/server';
import { requireUserId } from '../../../../lib/auth';
import { claimPassDaily } from '../../../../lib/pass';
import { reportError } from '../../../../lib/observability';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req); // 익명 폴백 금지(§13.17 P0-5)
    if (!userId) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
    const r = await claimPassDaily(userId);
    if (!r.ok) return NextResponse.json({ ok: false, reason: r.reason }, { status: r.reason === 'no-user' ? 401 : 500 });
    // reason: claimed(신규 지급) · already(오늘분 이미 수령) · no-pass(활성 패스 없음). granted=지급 💎, slots=지급 슬롯 수.
    return NextResponse.json({ ok: true, reason: r.reason, granted: r.granted, slots: r.slots, balance: r.balance, endDate: r.endDate, dayIndex: r.dayIndex });
  } catch (e) {
    reportError(e, 'pass/claim');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
