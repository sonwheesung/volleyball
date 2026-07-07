// GET /api/cron/purge — Vercel Cron 매일 호출(BACKEND_SYSTEM §13.10). 롤업 후 티어별 파기.
// Vercel이 크론콜에 Authorization: Bearer ${CRON_SECRET} 자동 첨부 → 외부 무단호출 차단.
import { NextResponse } from 'next/server';
import { reportError } from '../../../../lib/observability';
import { rollupRecent, purgeExpired } from '../../../../lib/retention';

export const dynamic = 'force-dynamic';
// maxDuration 미지정 — 플랜 기본값 사용(파기/롤업은 가벼워 충분). Hobby 플랜 한도 초과 배포실패 회피.

export async function GET(req: Request) {
  // #7(2026-07-07): fail-closed(admin.ts 패턴 미러) — CRON_SECRET 미설정이면 거부(구 `if(secret && ...)`는 미설정 시 가드 스킵).
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }
  try {
    const rolled = await rollupRecent(); // ① 파기 전 반드시 롤업(집계 유실 방지)
    const purged = await purgeExpired(); // ② 티어별 경과분 파기
    return NextResponse.json({ ok: true, rolled, purged });
  } catch (e) { reportError(e, 'cron/purge');
    return NextResponse.json({ ok: false, reason: 'error', message: String(e) }, { status: 500 });
  }
}
