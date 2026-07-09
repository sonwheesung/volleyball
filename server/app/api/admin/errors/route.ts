// /api/admin/errors — ⑨ 오류 모니터링. requireAdmin(fail-closed §13.15).
//   [자체-롤업] 실데이터: 서버 머니패스 오류 로그 = purchaseEvent(ok=false) — 결제 실패/거부/에러(§13.22). 건수 + 사유별 + 최근 목록.
//   [외부-sync] 골격: Sentry(API 실패·서버 오류) / Crashlytics(앱 크래시)는 EAS·API키 후. SENTRY_API_TOKEN 없으면 "미설정" 배지(throw-none).
//   ※ 로딩/네트워크/로그인 실패 [자체-롤업]은 track() 수신 파이프라인(EAS) 후 — placeholder. 결정론 격리(§8): 순수 관측 메타.
import { NextResponse } from 'next/server';
import { and, eq, desc, gte, count } from 'drizzle-orm';
import { db } from '../../../../db';
import { purchaseEvent } from '../../../../db/schema';
import { isAdmin } from '../../../../lib/admin';
import { PROJ_CODE } from '../../../../lib/proj';
import { reportError } from '../../../../lib/observability';

export const dynamic = 'force-dynamic';

const mask = (u: string | null): string => (u ? '…' + u.slice(-6) : '—'); // PII 마스킹(§13.22-E)

export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const url = new URL(req.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const win = new Date(Date.now() - 14 * 86400000);
    const fail = and(eq(purchaseEvent.projCode, PROJ_CODE), eq(purchaseEvent.ok, false));

    const [tot] = await db.select({ n: count() }).from(purchaseEvent).where(fail);
    const [tdy] = await db.select({ n: count() }).from(purchaseEvent).where(and(fail, gte(purchaseEvent.createdAt, dayStart)));

    // 최근 14일 실패를 당겨 사유별 집계 + 최근 목록(대규모 시 SQL group by TODO — 관리자 저빈도라 허용)
    const rows = await db.select({
      id: purchaseEvent.id, createdAt: purchaseEvent.createdAt, source: purchaseEvent.source, stage: purchaseEvent.stage,
      outcome: purchaseEvent.outcome, reasonCode: purchaseEvent.reasonCode, errorMessage: purchaseEvent.errorMessage,
      productId: purchaseEvent.productId, userId: purchaseEvent.userId,
    }).from(purchaseEvent).where(and(fail, gte(purchaseEvent.createdAt, win))).orderBy(desc(purchaseEvent.createdAt)).limit(limit);

    const byReasonMap = new Map<string, number>();
    for (const r of rows) { const k = r.reasonCode || r.outcome || '(미분류)'; byReasonMap.set(k, (byReasonMap.get(k) ?? 0) + 1); }
    const byReason = Array.from(byReasonMap.entries()).map(([reasonCode, n]) => ({ reasonCode, n })).sort((a, b) => b.n - a.n);
    const recent = rows.map((r) => ({ ...r, userId: mask(r.userId) }));

    // [외부-sync] Sentry — 키 있을 때만 pull 골격, 없으면 미설정(화면 안 막음). 실제 pull은 org/project slug 연결(§13.25-B) 후.
    const sentryToken = process.env.SENTRY_API_TOKEN ?? '';
    const sentry = { configured: sentryToken.length > 0, note: sentryToken ? '연결됨 — 이슈 pull은 org/project 연동 후(§13.25)' : 'SENTRY_API_TOKEN 미설정 — EAS/서버 관측 연동 후' };

    return NextResponse.json({ ok: true, total: tot?.n ?? 0, today: tdy?.n ?? 0, byReason, recent, sentry });
  } catch (e) {
    reportError(e, 'admin/errors');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
