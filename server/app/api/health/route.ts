// 헬스 체크 — 서버가 살아있는지 + **어느 환경/어느 DB에 붙었는지**.
//
// 왜 DB 지문이 필요한가(2026-08-07, stg 구축):
//   Vercel 환경변수가 "All Environments" 스코프로 걸려 있으면 **Preview(stg) 배포가 운영 DATABASE_URL을
//   물려받아 stg 서버가 운영 DB에 쓴다.** 화면상으로는 정상 동작해서 눈으로는 절대 못 잡는다.
//   그래서 "지금 이 배포가 보는 DB"를 밖에서 확인할 수 있어야 한다 — 격리 A/B의 오라클.
//
// 왜 해시인가: 이 라우트는 **인증 없는 공개 엔드포인트**다. Supabase 프로젝트 ref를 평문으로 실으면
//   운영 DB 호스트를 공개하는 꼴. 지문(sha256 앞 12자)이면 **"stg와 prod가 다른가"를 비교로만** 판정할 수
//   있고 원문은 복원되지 않는다. 비밀값(비밀번호·전체 URL)은 어떤 형태로도 넣지 않는다.
import { NextResponse } from 'next/server';
import { createHash } from 'crypto';

export const dynamic = 'force-dynamic'; // 항상 실시간(캐시 금지)

/** DATABASE_URL에서 **호스트 부분만** 뽑아 지문화. 실패해도 절대 원문을 흘리지 않는다. */
function dbFingerprint(): string {
  const raw = process.env.DATABASE_URL || '';
  if (!raw) return 'unset';
  try {
    // 호스트만 사용 — user/password/db명은 파싱조차 하지 않는다.
    const host = new URL(raw).hostname;
    return createHash('sha256').update(host).digest('hex').slice(0, 12);
  } catch {
    // URL 파싱 실패 시에도 raw를 로그/응답에 싣지 않는다(2026-08-07 교훈: 파서 에러 메시지에 시크릿 노출).
    return 'unparsable';
  }
}

export function GET() {
  return NextResponse.json({
    ok: true,
    service: 'volleyball-server',
    phase: 'P1-scaffold',
    // 배포 진단(§13.22): Vercel이 빌드 시 주입하는 커밋 SHA — 어느 코드가 라이브인지 확인용.
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    // 이 배포가 Production인지 Preview(stg)인지 — Vercel이 주입.
    env: process.env.VERCEL_ENV ?? 'local',
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? 'local',
    // DB 호스트 지문(원문 복원 불가). prod와 stg의 값이 **달라야** 격리 성립.
    dbRef: dbFingerprint(),
    time: new Date().toISOString(),
  });
}
