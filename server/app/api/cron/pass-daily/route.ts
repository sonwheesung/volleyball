// GET /api/cron/pass-daily — Vercel Cron 매일 KST 00:00 직후 호출(DIAMOND_PASS_SYSTEM §2.3.2 · BACKEND §13.10).
// ⚠ 크론 표현식은 UTC 기준(리스크 3): vercel.json "0 15 * * *" = UTC 15:00 = KST 00:00(자정). 활성 패스마다 그날까지 미발송 dayIndex 전부 우편 발송(캐치업 멱등).
// 기존 크론 인프라(purge) 재사용 — auth 패턴 동일(CRON_SECRET Bearer fail-closed). 신 크론 잡 1개 추가(전용 서버 아님).
import { NextResponse } from 'next/server';
import { reportError } from '../../../../lib/observability';
import { dispatchDailyPassMails } from '../../../../lib/pass';

export const dynamic = 'force-dynamic';
// maxDuration 미지정 — 플랜 기본값(발송은 활성 패스 수 비례로 가벼움). Hobby 한도 회피.

export async function GET(req: Request) {
  // fail-closed(purge 크론과 동일) — CRON_SECRET 미설정이면 거부. Vercel이 크론콜에 Authorization: Bearer ${CRON_SECRET} 자동 첨부.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }
  try {
    const r = await dispatchDailyPassMails();
    return NextResponse.json({ ok: true, ...r });
  } catch (e) { reportError(e, 'cron/pass-daily');
    return NextResponse.json({ ok: false, reason: 'error', message: String(e) }, { status: 500 });
  }
}
