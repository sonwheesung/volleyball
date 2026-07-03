// /api/admin/setting — 운영 설정(server_setting §13.11) 조회(GET)·갱신(POST upsert). requireAdmin.
// 버전 게이트(minVersion/latestVersion·스토어URL) + 서버 점검(maintenance/title/body). 앱은 /api/bootstrap로 읽음.
import { NextResponse } from 'next/server';
import { reportError } from '../../../../lib/observability';
import { eq } from 'drizzle-orm';
import { db } from '../../../../db';
import { serverSetting } from '../../../../db/schema';
import { isAdmin } from '../../../../lib/admin';
import { ensureProj } from '../../../../lib/wallet';
import { PROJ_CODE } from '../../../../lib/proj';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const rows = await db.select().from(serverSetting).where(eq(serverSetting.projCode, PROJ_CODE)).limit(1);
    return NextResponse.json({ ok: true, setting: rows[0] ?? null });
  } catch (e) { reportError(e, 'admin/setting');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const b = (await req.json()) as Partial<{
      minVersion: string | null; latestVersion: string | null; androidStoreUrl: string | null; iosStoreUrl: string | null;
      maintenance: boolean; maintenanceTitle: string | null; maintenanceBody: string | null;
    }>;
    // 넘어온 필드만 갱신(부분 업데이트) — undefined는 건드리지 않음
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of ['minVersion', 'latestVersion', 'androidStoreUrl', 'iosStoreUrl', 'maintenanceTitle', 'maintenanceBody'] as const) {
      if (b[k] !== undefined) patch[k] = b[k];
    }
    if (b.maintenance !== undefined) patch.maintenance = !!b.maintenance;
    await ensureProj();
    await db
      .insert(serverSetting)
      .values({ projCode: PROJ_CODE, ...patch })
      .onConflictDoUpdate({ target: serverSetting.projCode, set: patch });
    const rows = await db.select().from(serverSetting).where(eq(serverSetting.projCode, PROJ_CODE)).limit(1);
    return NextResponse.json({ ok: true, setting: rows[0] ?? null });
  } catch (e) { reportError(e, 'admin/setting');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
