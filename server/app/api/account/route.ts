// DELETE /api/account — 계정 삭제(탈퇴) = 가명처리 소프트삭제(AUTH_SYSTEM §7).
// Bearer 필수(본인만). 멱등(이미 탈퇴면 200 동일 응답). 결제/재화 원장은 법정 5년 보존이라 행 삭제 대신 개인 식별성만 파기.
// 자기 자신을 지우는 라우트라 requireUserId(라이브만)를 그대로 쓰면 "이미 탈퇴" 재호출이 401이 되어 멱등이 깨진다 —
// 그래서 sub를 직접 검증해 "유효서명+라이브 행 없음=이미 탈퇴 → 200", "무토큰/위조=401"로 나눈다(§7.4).
import { NextResponse } from 'next/server';
import { reportError } from '../../../lib/observability';
import { subFromRequest, splitSub } from '../../../lib/auth';
import { findUserRow, pseudonymizeUser } from '../../../lib/wallet';

export const dynamic = 'force-dynamic';

export async function DELETE(req: Request) {
  try {
    // Bearer 필수·본인만 — 서명 검증(무토큰/위조/만료 → 401). 익명 폴백 없음.
    const sub = subFromRequest(req);
    if (!sub) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

    const { provider, providerId } = splitSub(sub);
    const row = await findUserRow(providerId, provider);
    if (!row || row.deletedAt) {
      // 유효 서명이지만 라이브 행 없음(providerId 토움스톤화) 또는 이미 소프트삭제 → 멱등 200(AUTH §7.4)
      return NextResponse.json({ ok: true, alreadyDeleted: true });
    }
    await pseudonymizeUser(row.id); // deletedAt + providerId 토움스톤 + 비필수 PII null(잔액·원장 보존)
    return NextResponse.json({ ok: true, alreadyDeleted: false });
  } catch (e) {
    reportError(e, 'account/delete');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
