// /api/admin/devnote — 개발자 노트/패치노트 CRUD(DEVNOTES_SYSTEM §4.3). 공지 admin 라우트 1:1 복제.
//   POST(작성=draft 기본) · GET(초안 포함 전체) · PATCH(제목·본문·kind·appVersion·status — 게시 토글 포함) · DELETE ?id=(projCode 스코프 + 0건 404).
//   검증: title/body trim 필수 · kind∈{patch,note} · patch면 appVersion 필수(OPEN Q-6 필수 채택). 낙관 반영 금지(응답 후 reload).
import { NextResponse } from 'next/server';
import { reportError } from '../../../../lib/observability';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../../../db';
import { devnotes } from '../../../../db/schema';
import { isAdmin } from '../../../../lib/admin';
import { ensureProj } from '../../../../lib/wallet';
import { PROJ_CODE } from '../../../../lib/proj';

export const dynamic = 'force-dynamic';

const KINDS = new Set(['patch', 'note']);
const STATUSES = new Set(['draft', 'published']);
const bad = () => NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });

export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const b = (await req.json()) as { kind?: string; title?: string; body?: string; appVersion?: string | null; status?: string };
    const kind = (b.kind ?? '').trim();
    const title = (b.title ?? '').trim();
    const body = (b.body ?? '').trim();
    if (!KINDS.has(kind) || !title || !body) return bad();
    const status = b.status && STATUSES.has(b.status) ? b.status : 'draft';
    // patch면 appVersion 필수(패치노트의 정의가 버전 — OPEN Q-6). note면 appVersion 무시(null).
    let appVersion: string | null = null;
    if (kind === 'patch') { appVersion = (b.appVersion ?? '').trim(); if (!appVersion) return bad(); }
    // 게시 상태로 바로 작성하면 publishedAt을 그 순간으로 세팅(공개 GET 정렬·표시 기준).
    const publishedAt = status === 'published' ? new Date() : null;
    await ensureProj();
    const ins = await db
      .insert(devnotes)
      .values({ projCode: PROJ_CODE, kind, title, body, appVersion, status, publishedAt })
      .returning({ id: devnotes.id });
    return NextResponse.json({ ok: true, id: ins[0].id });
  } catch (e) { reportError(e, 'admin/devnote');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    // 초안 포함 전체(관리 목록). 정렬은 최신 작성순.
    const rows = await db.select().from(devnotes).where(eq(devnotes.projCode, PROJ_CODE)).orderBy(desc(devnotes.createdAt)).limit(200);
    return NextResponse.json({ ok: true, devnotes: rows });
  } catch (e) { reportError(e, 'admin/devnote');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}

// 수정 — 제목·본문·kind·appVersion·status(게시 토글). requireAdmin.
export async function PATCH(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const b = (await req.json()) as { id?: string; kind?: string; title?: string; body?: string; appVersion?: string | null; status?: string };
    if (!b.id) return bad();
    // 검증 후 최종 kind/status를 결정(교차 검증: patch면 appVersion 필수)을 위해 현재 행을 읽는다.
    const cur = (await db.select().from(devnotes).where(and(eq(devnotes.projCode, PROJ_CODE), eq(devnotes.id, b.id))).limit(1))[0];
    if (!cur) return NextResponse.json({ ok: false, reason: 'not-found' }, { status: 404 });

    const upd: Record<string, unknown> = { updatedAt: new Date() };
    if (b.title !== undefined) { const t = b.title.trim(); if (!t) return bad(); upd.title = t; }
    if (b.body !== undefined) { const bd = b.body.trim(); if (!bd) return bad(); upd.body = bd; }
    if (b.kind !== undefined) { if (!KINDS.has(b.kind)) return bad(); upd.kind = b.kind; }
    if (b.appVersion !== undefined) { const v = (b.appVersion ?? '').trim(); upd.appVersion = v || null; }
    if (b.status !== undefined) { if (!STATUSES.has(b.status)) return bad(); upd.status = b.status; }

    // 교차 검증: 적용 후 kind가 patch면 appVersion(적용 후 값)이 있어야 한다.
    const finalKind = (upd.kind as string) ?? cur.kind;
    const finalAppVer = upd.appVersion !== undefined ? (upd.appVersion as string | null) : cur.appVersion;
    if (finalKind === 'patch' && !finalAppVer) return bad();

    // 게시 토글: published로 전환되는데 publishedAt이 아직 비어 있으면 그 순간으로 세팅(재게시 bump 없음 — OPEN Q-5 최초값 유지).
    const finalStatus = (upd.status as string) ?? cur.status;
    if (finalStatus === 'published' && !cur.publishedAt) upd.publishedAt = new Date();

    if (Object.keys(upd).length <= 1) return bad(); // updatedAt만 있으면 실제 변경 없음
    const r = await db.update(devnotes).set(upd).where(and(eq(devnotes.projCode, PROJ_CODE), eq(devnotes.id, b.id))).returning({ id: devnotes.id });
    if (!r.length) return NextResponse.json({ ok: false, reason: 'not-found' }, { status: 404 });
    return NextResponse.json({ ok: true, id: r[0].id });
  } catch (e) { reportError(e, 'admin/devnote');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return bad();
    // projCode 스코프 필수(§13.2 멀티게임 격리) — 타 게임 노트 삭제 차단. 0건이면 404(PATCH와 대칭·공지 F1).
    const r = await db.delete(devnotes).where(and(eq(devnotes.projCode, PROJ_CODE), eq(devnotes.id, id))).returning({ id: devnotes.id });
    if (!r.length) return NextResponse.json({ ok: false, reason: 'not-found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) { reportError(e, 'admin/devnote');
    return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 });
  }
}
