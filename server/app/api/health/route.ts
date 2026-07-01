// 헬스 체크 — 서버가 살아있는지. DB 없이 응답(부팅 게이트 아님). 이후 DB 붙으면 db:ok 필드 추가.
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic'; // 항상 실시간(캐시 금지)

export function GET() {
  return NextResponse.json({
    ok: true,
    service: 'volleyball-server',
    phase: 'P1-scaffold',
    time: new Date().toISOString(),
  });
}
