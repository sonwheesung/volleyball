// /api/admin/announcement — 공지 발행(POST)·목록(GET, 활성 무관 전체)·수정(PATCH)·삭제(DELETE ?id=). requireAdmin.
import { NextResponse } from 'next/server';
import { reportError } from '../../../../lib/observability';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../../../db';
import { announcements } from '../../../../db/schema';
import { isAdmin } from '../../../../lib/admin';
import { ensureProj } from '../../../../lib/wallet';
import { PROJ_CODE } from '../../../../lib/proj';

export const dynamic = 'force-dynamic';

// date-only endsAt('YYYY-MM-DD')는 운영자 기대(그날 밤까지)에 맞춰 KST 그날 23:59:59.999(= 해당일 UTC T14:59:59.999Z)로 정규화.
// new Date('YYYY-MM-DD')=UTC 자정=KST 오전 9시라 9시간 일찍 만료되는 함정 방지(§13.15). 시각 포함 ISO 전체 문자열은 그대로 파싱.
function normalizeEndsAt(raw: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T14:59:59.999Z`);
  return new Date(raw);
}

export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const b = (await req.json()) as { title?: string; body?: string; startsAt?: string; endsAt?: string | null; pinned?: boolean };
    const title = (b.title ?? '').trim();
    const body = (b.body ?? '').trim();
    if (!title || !body) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    // startsAt 미지정이면 DB defaultNow()에 맡긴다(undefined) — 서버 JS 클럭과 DB now()가 어긋나도(테스트/스큐)
    // bootstrap의 `startsAt ≤ now()` 필터와 같은 DB 클럭을 써서 발행 즉시 노출됨.
    const startsAt = b.startsAt ? new Date(b.startsAt) : undefined;
    const endsAt = b.endsAt ? normalizeEndsAt(b.endsAt) : null;
    if ((startsAt && Number.isNaN(startsAt.getTime())) || (endsAt && Number.isNaN(endsAt.getTime()))) {
      return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    }
    await ensureProj();
    const ins = await db
      .insert(announcements)
      .values({ projCode: PROJ_CODE, title, body, startsAt, endsAt, pinned: !!b.pinned })
      .returning({ id: announcements.id });
    return NextResponse.json({ ok: true, id: ins[0].id });
  } catch (e) { reportError(e, 'admin/announcement');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const rows = await db.select().from(announcements).where(eq(announcements.projCode, PROJ_CODE)).orderBy(desc(announcements.createdAt)).limit(200);
    return NextResponse.json({ ok: true, announcements: rows });
  } catch (e) { reportError(e, 'admin/announcement');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}

// 수정 — 제목/내용/종료일/고정. requireAdmin.
export async function PATCH(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const b = (await req.json()) as { id?: string; title?: string; body?: string; endsAt?: string | null; pinned?: boolean };
    if (!b.id) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    const upd: Record<string, unknown> = {};
    if (b.title !== undefined) { const t = b.title.trim(); if (!t) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 }); upd.title = t; }
    if (b.body !== undefined) { const bd = b.body.trim(); if (!bd) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 }); upd.body = bd; }
    if (b.endsAt !== undefined) { const d = b.endsAt ? normalizeEndsAt(b.endsAt) : null; if (d && Number.isNaN(d.getTime())) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 }); upd.endsAt = d; }
    if (typeof b.pinned === 'boolean') upd.pinned = b.pinned;
    if (Object.keys(upd).length === 0) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    const r = await db.update(announcements).set(upd).where(and(eq(announcements.projCode, PROJ_CODE), eq(announcements.id, b.id))).returning({ id: announcements.id });
    if (!r.length) return NextResponse.json({ ok: false, reason: 'not-found' }, { status: 404 });
    return NextResponse.json({ ok: true, id: r[0].id });
  } catch (e) { reportError(e, 'admin/announcement');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    // projCode 스코프 필수(§13.2 멀티게임 격리) — 타 게임 공지 삭제 차단. 0건이면 404(PATCH와 대칭).
    const r = await db.delete(announcements).where(and(eq(announcements.projCode, PROJ_CODE), eq(announcements.id, id))).returning({ id: announcements.id });
    if (!r.length) return NextResponse.json({ ok: false, reason: 'not-found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) { reportError(e, 'admin/announcement');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
