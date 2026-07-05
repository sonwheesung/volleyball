// 헬스 체크 — 서버가 살아있는지. DB 없이 응답(부팅 게이트 아님). 이후 DB 붙으면 db:ok 필드 추가.
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic'; // 항상 실시간(캐시 금지)

export function GET() {
  return NextResponse.json({
    ok: true,
    service: 'volleyball-server',
    phase: 'P1-scaffold',
    // 배포 진단(§13.22): Vercel이 빌드 시 주입하는 커밋 SHA — 어느 코드가 라이브인지 확인용.
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    time: new Date().toISOString(),
  });
}
