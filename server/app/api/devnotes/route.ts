// GET /api/devnotes — 앱 마이페이지 진입 시 조회(DEVNOTES_SYSTEM §4.2). 공개 콘텐츠 — Bearer 불필요(공지 bootstrap 동급).
// **published만** 반환(초안 유출 0), projCode 스코프, publishedAt(없으면 createdAt) 내림차순, limit 방어. rate limit은 기존 미들웨어 적용.
import { NextResponse } from 'next/server';
import { reportError } from '../../../lib/observability';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../../db';
import { devnotes } from '../../../db/schema';
import { PROJ_CODE } from '../../../lib/proj';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await db
      .select()
      .from(devnotes)
      .where(and(eq(devnotes.projCode, PROJ_CODE), eq(devnotes.status, 'published')))
      // publishedAt이 null이면(이론상 published는 항상 채워지지만 방어) createdAt으로 폴백 정렬.
      .orderBy(desc(sql`coalesce(${devnotes.publishedAt}, ${devnotes.createdAt})`))
      .limit(100); // 마이페이지 페이로드 방어(공지 bootstrap .limit(50) 교훈)
    return NextResponse.json({
      ok: true,
      devnotes: rows.map((d) => ({
        id: d.id,
        kind: d.kind,
        title: d.title,
        body: d.body,
        appVersion: d.appVersion,
        publishedAt: d.publishedAt,
      })),
    });
  } catch (e) { reportError(e, 'devnotes');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
