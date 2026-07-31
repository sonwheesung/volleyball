// GET /api/wallet — 현재 잔액 + 최근 원장. (인증은 마일스톤3 — 지금은 dev 유저)
import { NextResponse } from 'next/server';
import { reportError } from '../../../lib/observability';
import { getWallet, touchLastSeen } from '../../../lib/wallet';
import { requireUserId } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    // 익명 폴백 금지(#6·§13.17 P0-5) — 유효 Bearer 없으면 401(dev-user-1 공유 지갑 노출 차단).
    const userId = await requireUserId(req);
    if (!userId) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
    // 접속 하트비트(DAU 정확화 §13.15) — 앱이 로그인·포그라운드마다 부르는 syncWallet이 이 GET을 침 → lastSeenAt=now().
    //   getWallet과 병렬로 태워 응답 지연 0. touchLastSeen은 실패해도 조용히 통과(지표 부수효과).
    const [, w] = await Promise.all([touchLastSeen(userId), getWallet(userId)]);
    return NextResponse.json({ ok: true, ...w });
  } catch (e) { reportError(e, 'wallet');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
