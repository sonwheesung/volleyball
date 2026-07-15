// 개발자 노트/패치노트 CRUD 가드 (DEVNOTES_SYSTEM §4·§7 Phase1) — 라우트 핸들러 직접 import·호출, 라이브 dev DB.
// 검증: 공개 GET은 published만(초안 유출 0)·게시 토글로 등장/회수·requireAdmin 4메서드 401·proj 스코프·
//       DELETE 404 대칭·patch면 appVersion 필수·publishedAt 최초값 유지(재게시 bump 없음). A/B 자가검증 1개(published 필터 무력화 대조엔 초안 잡힘) 포함.
// Usage: cd server && npx tsx tools/_dv_devnote_live.ts (dev는 .env.development.local 우선, 없으면 .env.local)
import './_env'; // db 모듈 import 전에 env 주입(호이스팅 순서 — 첫 import)
process.env.ADMIN_TOKEN = 'test-admin-token-abcdef0123456789'; // ≥16자(fail-closed 통과용) — import 전 주입

(async () => {
  const TOKEN = process.env.ADMIN_TOKEN!;
  const adminRoute = await import('../app/api/admin/devnote/route');
  const pubRoute = await import('../app/api/devnotes/route');
  const { db } = await import('../db');
  const { devnotes } = await import('../db/schema');
  const { eq, and, like } = await import('drizzle-orm');
  const { PROJ_CODE } = await import('../lib/proj');
  const { ensureProj } = await import('../lib/wallet');

  let fail = 0;
  const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

  const PFX = '_DV_NOTE_';
  const MISSING = '00000000-0000-0000-0000-000000000000'; // 유효 UUID 형식·미존재(404 유도)
  const hdr = (auth: string | null): Record<string, string> => { const h: Record<string, string> = { 'content-type': 'application/json' }; if (auth) h.authorization = `Bearer ${auth}`; return h; };
  const post = (body: unknown, auth: string | null = TOKEN) => adminRoute.POST(new Request('http://x/api/admin/devnote', { method: 'POST', headers: hdr(auth), body: JSON.stringify(body) }));
  const patch = (body: unknown, auth: string | null = TOKEN) => adminRoute.PATCH(new Request('http://x/api/admin/devnote', { method: 'PATCH', headers: hdr(auth), body: JSON.stringify(body) }));
  const del = (id: string, auth: string | null = TOKEN) => adminRoute.DELETE(new Request(`http://x/api/admin/devnote?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: hdr(auth) }));
  const adminGet = (auth: string | null = TOKEN) => adminRoute.GET(new Request('http://x/api/admin/devnote', { method: 'GET', headers: hdr(auth) }));
  const pubIds = async () => { const r = await (await pubRoute.GET()).json(); return new Set<string>((r.devnotes ?? []).map((d: { id: string }) => d.id)); };
  const create = async (body: Record<string, unknown>) => (await post(body)).json();

  try {
    await ensureProj();

    console.log('── ① 초안 작성 → 공개 GET 미노출(초안 유출 0) ──');
    const r1 = await create({ kind: 'note', title: PFX + 'draft', body: '초안 본문' });
    ok(r1.ok === true && typeof r1.id === 'string', '① 초안 작성(POST) → ok+id(기본 draft)');
    ok(!(await pubIds()).has(r1.id), '① 초안(draft)은 공개 GET에 절대 안 나옴');
    // A/B 자가검증: published 필터를 무력화한 대조 쿼리엔 초안이 반드시 잡혀야 한다(오라클 민감도 — 허위 통과 방지).
    const ctrl = await db.select({ id: devnotes.id }).from(devnotes).where(eq(devnotes.projCode, PROJ_CODE));
    ok(new Set(ctrl.map((x) => x.id)).has(r1.id) && !(await pubIds()).has(r1.id), '①-AB published필터 무력화 대조엔 잡힘(민감)·실제 공개 GET엔 없음(허위오라클 아님)');

    console.log('── ② 게시 토글: draft→published → 공개 GET 등장 + publishedAt 세팅 ──');
    const rp = await (await patch({ id: r1.id, status: 'published' })).json();
    ok(rp.ok === true, '② 게시 토글(PATCH status=published) → ok');
    ok((await pubIds()).has(r1.id), '② 게시 후 공개 GET에 등장');
    const prow = (await db.select({ publishedAt: devnotes.publishedAt }).from(devnotes).where(eq(devnotes.id, r1.id)))[0];
    ok(!!prow?.publishedAt, '② publishedAt가 게시 순간 세팅됨');
    const firstPub = prow!.publishedAt!.getTime();

    console.log('── ③ 회수: published→draft → 공개 GET서 사라짐 + 재게시 시 publishedAt 최초값 유지(OPEN Q-5) ──');
    ok((await (await patch({ id: r1.id, status: 'draft' })).json()).ok === true, '③ 회수(status=draft) → ok');
    ok(!(await pubIds()).has(r1.id), '③ 회수 후 공개 GET서 사라짐');
    await new Promise((res) => setTimeout(res, 10));
    ok((await (await patch({ id: r1.id, status: 'published' })).json()).ok === true, '③ 재게시 → ok');
    const rePub = (await db.select({ publishedAt: devnotes.publishedAt }).from(devnotes).where(eq(devnotes.id, r1.id)))[0];
    ok(rePub?.publishedAt?.getTime() === firstPub, '③ 재게시해도 publishedAt 최초값 유지(bump 없음 — 연대기 안정)');

    console.log('── ④ 패치노트 appVersion 필수(OPEN Q-6) ──');
    ok((await create({ kind: 'patch', title: PFX + 'nover', body: '본문' })).ok === false, '④ patch인데 appVersion 없음 → 거부');
    const rPatch = await create({ kind: 'patch', title: PFX + 'withver', body: '본문', appVersion: '0.4.0', status: 'published' });
    ok(rPatch.ok === true, '④ patch + appVersion → ok');
    const vrow = (await db.select({ appVersion: devnotes.appVersion, kind: devnotes.kind }).from(devnotes).where(eq(devnotes.id, rPatch.id)))[0];
    ok(vrow?.kind === 'patch' && vrow?.appVersion === '0.4.0', '④ appVersion DB 반영');
    // PATCH로 note→patch 전환 시 appVersion 없으면 거부(교차 검증)
    const rNote = await create({ kind: 'note', title: PFX + 'n2p', body: '본문' });
    ok((await patch({ id: rNote.id, kind: 'patch' })).status === 400, '④ note→patch 전환인데 appVersion 없음 → 400 거부(교차)');
    // PATCH 대칭(Q-6, backend-verify D1 2026-07-15): note에 appVersion을 실어 PATCH해도 null 저장,
    // patch→note 전환 시 옛 버전 소거 — POST만 강제하고 PATCH가 빠졌던 사각 봉인.
    ok((await patch({ id: rNote.id, appVersion: '9.9.9' })).status === 200, '④b note에 appVersion PATCH → 200(무시)');
    const nrow1 = (await db.select({ appVersion: devnotes.appVersion }).from(devnotes).where(eq(devnotes.id, rNote.id)))[0];
    ok(nrow1?.appVersion === null, '④b note appVersion = null 저장(무시 확인)');
    ok((await patch({ id: rPatch.id, kind: 'note' })).status === 200, '④b patch→note 전환 → 200');
    const nrow2 = (await db.select({ appVersion: devnotes.appVersion }).from(devnotes).where(eq(devnotes.id, rPatch.id)))[0];
    ok(nrow2?.appVersion === null, '④b patch→note 전환 시 옛 appVersion 소거');

    console.log('── ⑤ 검증 실패(빈 title/body·잘못된 kind) → 400 ──');
    ok((await create({ kind: 'note', title: '   ', body: '본문' })).ok === false, '⑤ 빈 title → 거부');
    ok((await create({ kind: 'note', title: PFX + 'x', body: '  ' })).ok === false, '⑤ 빈 body → 거부');
    ok((await create({ kind: 'bogus', title: PFX + 'x', body: '본문' })).ok === false, '⑤ 잘못된 kind → 거부');

    console.log('── ⑥ DELETE 정상(사라짐) + 미존재 id 404(공지 F1 대칭·proj 스코프) ──');
    const rDel = await create({ kind: 'note', title: PFX + 'to-delete', body: '본문', status: 'published' });
    ok((await pubIds()).has(rDel.id), '⑥ 삭제 전 공개 GET 노출');
    ok((await (await del(rDel.id)).json()).ok === true, '⑥ DELETE 정상 → ok');
    ok(!(await pubIds()).has(rDel.id), '⑥ 삭제 후 공개 GET서 사라짐');
    ok((await del(MISSING)).status === 404, '⑥ 존재하지 않는 id DELETE → 404(proj 스코프+404 대칭)');
    ok((await patch({ id: MISSING, title: 'x' })).status === 404, '⑥ 존재하지 않는 id PATCH → 404');

    console.log('── ⑦ fail-closed 인증(무토큰·틀린토큰 → 401, 4메서드) ──');
    ok((await post({ kind: 'note', title: PFX + 'noauth', body: 'x' }, null)).status === 401, '⑦ 무토큰 POST → 401');
    ok((await post({ kind: 'note', title: PFX + 'wrong', body: 'x' }, 'wrong-token-0123456789ab')).status === 401, '⑦ 틀린 토큰 POST → 401');
    ok((await adminGet(null)).status === 401, '⑦ 무토큰 GET(admin) → 401');
    ok((await patch({ id: MISSING, title: 'x' }, null)).status === 401, '⑦ 무토큰 PATCH → 401');
    ok((await del(MISSING, null)).status === 401, '⑦ 무토큰 DELETE → 401');
    // 공개 GET은 무토큰이어도 200(공지 bootstrap 동급 공개 콘텐츠)
    ok((await pubRoute.GET()).status === 200, '⑦ 공개 GET은 무토큰 200(공개 콘텐츠)');
  } finally {
    // 정리 — 프리픽스 테스트 노트 전부 삭제(공유 dev DB 오염 방지)
    await db.delete(devnotes).where(and(eq(devnotes.projCode, PROJ_CODE), like(devnotes.title, `${PFX}%`)));
    console.log('  ✓ 정리 완료(_DV_NOTE_ 테스트 노트 삭제)');
  }

  console.log(fail === 0 ? '\n✅ 노트 CRUD 가드 — published-only·게시토글·재게시 유지·appVersion 필수·proj 스코프·404 대칭·인증 전부 통과' : `\n❌ ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
