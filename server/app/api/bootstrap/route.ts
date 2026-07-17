// GET /api/bootstrap — 앱 부팅 시 단일 조회(AUTH_SYSTEM §4·BACKEND §13.11): 점검·버전·공지.
// 전부 DB(server_setting·announcements)에서. 앱 로컬 신뢰 금지 — 진입 게이트는 이 응답으로 결정.
import { NextResponse } from 'next/server';
import { reportError } from '../../../lib/observability';
import { and, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../../../db';
import { serverSetting, announcements } from '../../../db/schema';
import { PROJ_CODE } from '../../../lib/proj';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await db.select().from(serverSetting).where(eq(serverSetting.projCode, PROJ_CODE)).limit(1);
    const s = rows[0];
    const anns = await db
      .select()
      .from(announcements)
      .where(
        and(
          eq(announcements.projCode, PROJ_CODE),
          lte(announcements.startsAt, sql`now()`),
          or(isNull(announcements.endsAt), gte(announcements.endsAt, sql`now()`)),
        ),
      )
      .orderBy(desc(announcements.pinned), desc(announcements.createdAt))
      .limit(50); // 부팅 페이로드 방어 — admin 목록 200과 별개

    return NextResponse.json({
      ok: true,
      maintenance: s?.maintenance
        ? { active: true, title: s.maintenanceTitle ?? '서버 점검 중', body: s.maintenanceBody ?? '' }
        : { active: false },
      version: {
        min: s?.minVersion ?? null, // 이 미만 = 강제 업데이트
        latest: s?.latestVersion ?? null, // 이 미만 = 소프트 안내
        androidUrl: s?.androidStoreUrl ?? null,
        iosUrl: s?.iosStoreUrl ?? null,
      },
      // startsAt = 노출 시작일(=유저에게 게시된 시점) → 재열람 목록의 "등록일" 표시(app/announcements). additive, 기존 클라 무해.
      announcements: anns.map((a) => ({ id: a.id, title: a.title, body: a.body, pinned: a.pinned, startsAt: a.startsAt })),
    });
  } catch (e) { reportError(e, 'bootstrap');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
