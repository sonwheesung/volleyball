// POST /api/heartbeat — 접속 핑(BACKEND_SYSTEM §13.29).
//
// 왜 존재하나: 이 게임은 로컬 우선이라 경기·시즌 진행이 서버를 안 거친다 → 서버는 다이아가 움직일 때만 흔적을 본다.
//   그래서 "실시간 접속(최근 30분)"이 **앱을 켜놓고 40분 경기를 보는 유저를 놓쳤다**(가장 몰입한 유저가 가장 안 잡히는 편향).
//   주기 타이머는 기각했다 — RN setInterval은 JS 스레드에 묶여 관전 중 코어 포화·시즌 전환 정체에서 밀린다(같은 편향의 재생산).
//   대신 **유저가 경기 시작 버튼을 누르는 순간**(=앱이 확실히 반응 중인 순간)에 앱이 한 발 쏜다. 상세·기각 근거는 §13.29.
//
// ★ 계약: 이 라우트는 **UPDATE 1건짜리 경량 핑**이다. 잔액·원장·패스·우편을 조회하지 마라(getWallet은 쿼리 6개).
//   빈도가 높은 경로라 무거워지면 그대로 비용이 된다. 가드 `server/tools/_dv_heartbeat.ts`가 이 경량 계약을 소스 수준에서 봉인한다.
// ★ 레이트리밋 미적용(의도, §13.29): Bearer 인증이라 남용 표면이 자기 계정 한정이고,
//   Upstash 왕복이 보호 대상인 UPDATE 1건보다 비싼 역설이 된다. 1차 방어는 클라의 60초 최소 간격 가드.
// ★ 결정론 격리(§8): 순수 관측 사이드채널 — 재화·시드·리플레이에 일절 무관. 응답도 {ok:true} 뿐이라 클라로 흘러들 상태가 없다.
import { NextResponse } from 'next/server';
import { requireUserId } from '../../../lib/auth';
import { reportError } from '../../../lib/observability';
import { touchLastSeen } from '../../../lib/wallet';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    // 익명 폴백 금지(§13.17 P0-5) — 유효 Bearer 없으면 401(비로그인이 dev-user-1 한 버킷에 붕괴하는 것 차단).
    const userId = await requireUserId(req);
    if (!userId) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
    await touchLastSeen(userId); // UPDATE 1건. touchLastSeen 자체가 throw-none(지표 부수효과).
    return NextResponse.json({ ok: true });
  } catch (e) {
    reportError(e, 'heartbeat');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
