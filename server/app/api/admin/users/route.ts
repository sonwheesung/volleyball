// /api/admin/users — 운영 사용자 목록(가입일·최근접속·상태·잔액). requireAdmin(fail-closed §13.15).
//   상태 파생: withdrawn(deletedAt 있음) · inactive(14일+ 미접속 or 미접속) · active. 페이지네이션(limit/offset).
//   PATCH: 내부(운영자·QA) 계정 표시 토글(§13.30) — 관리자 통계에서 기본 제외되는 축. **재화·게임플레이엔 무관**.
import { NextResponse } from 'next/server';
import { and, desc, eq, gte, isNull, isNotNull, lt, or, count } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db } from '../../../../db';
import { users } from '../../../../db/schema';
import { isAdmin } from '../../../../lib/admin';
import { PROJ_CODE } from '../../../../lib/proj';
import { reportError } from '../../../../lib/observability';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get('status') || 'all'; // all | active | inactive | withdrawn
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const inact = new Date(Date.now() - 14 * 86400000);

    const base = eq(users.projCode, PROJ_CODE);
    let where: SQL | undefined;
    if (status === 'withdrawn') where = and(base, isNotNull(users.deletedAt));
    else if (status === 'inactive') where = and(base, isNull(users.deletedAt), or(isNull(users.lastSeenAt), lt(users.lastSeenAt, inact)));
    else if (status === 'active') where = and(base, isNull(users.deletedAt), gte(users.lastSeenAt, inact));
    else where = base;

    const [tot] = await db.select({ n: count() }).from(users).where(where);
    const rows = await db
      .select({ id: users.id, name: users.displayName, provider: users.provider, balance: users.balance, platform: users.platform, appVersion: users.appVersion, createdAt: users.createdAt, lastSeenAt: users.lastSeenAt, deletedAt: users.deletedAt, internal: users.internal, email: users.email })
      .from(users).where(where).orderBy(desc(users.createdAt)).limit(limit).offset(offset);

    return NextResponse.json({ ok: true, total: tot?.n ?? 0, limit, offset, users: rows });
  } catch (e) {
    reportError(e, 'admin/users');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/users — 내부 계정 표시 토글 (§13.30 A).
 * body: { userId: string, internal: boolean }
 * 왜 이 형태인가: id 하드코딩 필터를 코드에 심지 않기 위해(재설치·탈퇴로 id가 바뀐다) **사람이 표시하고 DB가 기억**한다.
 * 안전: proj 스코프 강제(다른 게임 계정 못 건드림) · 이 컬럼은 집계 필터 전용이라 재화·결제·게임플레이에 무영향.
 */
export async function PATCH(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const body = await req.json().catch(() => null) as { userId?: unknown; internal?: unknown } | null;
    const userId = typeof body?.userId === 'string' ? body.userId.trim() : '';
    if (!userId) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    if (typeof body?.internal !== 'boolean') return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });

    const updated = await db.update(users).set({ internal: body.internal })
      .where(and(eq(users.projCode, PROJ_CODE), eq(users.id, userId)))
      .returning({ id: users.id, internal: users.internal });
    if (updated.length === 0) return NextResponse.json({ ok: false, reason: 'not-found' }, { status: 404 });

    return NextResponse.json({ ok: true, user: updated[0] });
  } catch (e) {
    reportError(e, 'admin/users:patch');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
