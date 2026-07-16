// GET /api/save-backup/<id> — 백업 다운로드(§13.26). **본인 것만**(타 유저 id = 404, 존재 여부도 노출 안 함).
// requireUserId(fail-closed §13.17 P0-5) + proj·user 스코프로 조회 → 없으면 404.
import { NextResponse } from 'next/server';
import { reportError } from '../../../../lib/observability';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../../db';
import { saveBackups } from '../../../../db/schema';
import { requireUserId } from '../../../../lib/auth';
import { PROJ_CODE } from '../../../../lib/proj';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId(req);
  if (!userId) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const { id } = await ctx.params;
    // 비UUID id는 DB 캐스트 에러(500) 대신 404로(존재 노출 0·에러 누출 없음)
    if (!UUID_RE.test(id)) return NextResponse.json({ ok: false, reason: 'not-found' }, { status: 404 });
    const rows = await db
      .select({ payload: saveBackups.payload })
      .from(saveBackups)
      // proj + user 스코프를 조회에 박음 → 타 유저 id는 매칭 자체가 안 돼 404(존재/소유 노출 0)
      .where(and(eq(saveBackups.id, id), eq(saveBackups.projCode, PROJ_CODE), eq(saveBackups.userId, userId)))
      .limit(1);
    if (rows.length === 0) return NextResponse.json({ ok: false, reason: 'not-found' }, { status: 404 });
    return NextResponse.json({ ok: true, payload: rows[0].payload });
  } catch (e) {
    reportError(e, 'save-backup/[id]');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
