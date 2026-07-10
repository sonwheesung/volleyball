// 공지사항 CRUD 가드 (BACKEND_SYSTEM §13.11·§13.13·§13.15) — 라우트 핸들러 직접 import·호출, 라이브 dev DB.
// 검증: 발행→bootstrap 노출·기간 필터(만료/미래)·pinned 정렬·PATCH/DELETE 반영+404 대칭·proj 스코프·
//       date-only endsAt KST 정규화(F5)·fail-closed 인증. A/B 자가검증 1개(만료 필터 민감도) 포함.
// Usage: cd server && npx tsx tools/_dv_announce.ts (dev는 .env.development.local 우선, 없으면 .env.local — 운영 겨냥 시 DATABASE_URL 오버라이드)
import './_env'; // db 모듈 import 전에 env 주입(호이스팅 순서 — 첫 import)
process.env.ADMIN_TOKEN = 'test-admin-token-abcdef0123456789'; // ≥16자(fail-closed 통과용) — import 전 주입

(async () => {
  const TOKEN = process.env.ADMIN_TOKEN!;
  const annRoute = await import('../app/api/admin/announcement/route');
  const bootstrap = await import('../app/api/bootstrap/route');
  const { db } = await import('../db');
  const { announcements } = await import('../db/schema');
  const { eq, and, like, lte, sql } = await import('drizzle-orm');
  const { PROJ_CODE } = await import('../lib/proj');
  const { ensureProj } = await import('../lib/wallet');

  let fail = 0;
  const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

  const PFX = '_DV_ANN_';
  const MISSING = '00000000-0000-0000-0000-000000000000'; // 유효 UUID 형식·미존재(404 유도)
  const hdr = (auth: string | null): Record<string, string> => { const h: Record<string, string> = { 'content-type': 'application/json' }; if (auth) h.authorization = `Bearer ${auth}`; return h; };
  const post = (body: unknown, auth: string | null = TOKEN) => annRoute.POST(new Request('http://x/api/admin/announcement', { method: 'POST', headers: hdr(auth), body: JSON.stringify(body) }));
  const patch = (body: unknown, auth: string | null = TOKEN) => annRoute.PATCH(new Request('http://x/api/admin/announcement', { method: 'PATCH', headers: hdr(auth), body: JSON.stringify(body) }));
  const del = (id: string, auth: string | null = TOKEN) => annRoute.DELETE(new Request(`http://x/api/admin/announcement?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: hdr(auth) }));
  const bootIds = async () => { const r = await (await bootstrap.GET()).json(); return new Set<string>((r.announcements ?? []).map((a: { id: string }) => a.id)); };
  const bootOrder = async () => { const r = await (await bootstrap.GET()).json(); return ((r.announcements ?? []) as { id: string }[]).map((a) => a.id); };
  const create = async (body: Record<string, unknown>) => (await post(body)).json();

  try {
    await ensureProj();

    console.log('── ① 발행 → bootstrap 노출 ──');
    const r1 = await create({ title: PFX + 'active', body: '본문', pinned: false });
    ok(r1.ok === true && typeof r1.id === 'string', '① 발행(POST) → ok+id');
    ok((await bootIds()).has(r1.id), '① 활성 공지가 bootstrap에 노출');

    console.log('── ② endsAt 과거(만료) → 미노출 + A/B 자가검증 ──');
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const r2 = await create({ title: PFX + 'expired', body: '본문', endsAt: past });
    ok(r2.ok === true, '② 만료 공지 발행 ok');
    ok(!(await bootIds()).has(r2.id), '② endsAt 과거(만료) → bootstrap 미노출');
    // A/B 자가검증: 만료(endsAt) 필터를 무력화한 대조 쿼리엔 만료 공지가 반드시 잡혀야 한다(오라클 민감도 — 허위 통과 방지).
    const ctrl = await db.select({ id: announcements.id }).from(announcements)
      .where(and(eq(announcements.projCode, PROJ_CODE), lte(announcements.startsAt, sql`now()`)));
    const ctrlIds = new Set(ctrl.map((x) => x.id));
    ok(ctrlIds.has(r2.id) && !(await bootIds()).has(r2.id), '②-AB 만료필터 무력화 대조엔 잡힘(민감)·실제 bootstrap엔 없음(허위오라클 아님)');

    console.log('── ③ startsAt 미래(예약) → 미노출 ──');
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const r3 = await create({ title: PFX + 'future', body: '본문', startsAt: future });
    ok(r3.ok === true, '③ 예약(미래 startsAt) 발행 ok');
    ok(!(await bootIds()).has(r3.id), '③ startsAt 미래 → bootstrap 미노출');

    console.log('── ④ pinned 정렬(고정이 비고정 최신보다 앞) ──');
    const rPin = await create({ title: PFX + 'pinned', body: '본문', pinned: true });
    await new Promise((res) => setTimeout(res, 20)); // createdAt을 확실히 뒤로
    const rNew = await create({ title: PFX + 'newer-unpinned', body: '본문', pinned: false });
    ok(rPin.ok && rNew.ok, '④ 고정·비고정 공지 발행 ok');
    const order = await bootOrder();
    const iPin = order.indexOf(rPin.id), iNew = order.indexOf(rNew.id);
    ok(iPin >= 0 && iNew >= 0 && iPin < iNew, '④ pinned=true가 더 최신 비고정보다 앞(정렬)');

    console.log('── ⑤ PATCH 수정 반영 + 미존재 id 404 ──');
    const rp = await (await patch({ id: r1.id, title: PFX + 'edited', pinned: true })).json();
    ok(rp.ok === true, '⑤ PATCH 수정 → ok');
    const prow = await db.select({ title: announcements.title, pinned: announcements.pinned }).from(announcements).where(eq(announcements.id, r1.id));
    ok(prow[0]?.title === PFX + 'edited' && prow[0]?.pinned === true, '⑤ 수정 DB 반영(제목·pinned)');
    ok((await patch({ id: MISSING, title: 'x' })).status === 404, '⑤ 존재하지 않는 id PATCH → 404');

    console.log('── ⑥ DELETE 정상(사라짐) + 미존재 id 404(F1) ──');
    const rDel = await create({ title: PFX + 'to-delete', body: '본문' });
    ok(rDel.ok === true, '⑥ 삭제용 공지 발행 ok');
    ok((await bootIds()).has(rDel.id), '⑥ 삭제 전 bootstrap 노출');
    ok((await (await del(rDel.id)).json()).ok === true, '⑥ DELETE 정상 → ok');
    ok(!(await bootIds()).has(rDel.id), '⑥ 삭제 후 bootstrap서 사라짐');
    ok((await del(MISSING)).status === 404, '⑥ 존재하지 않는 id DELETE → 404(proj 스코프+404 대칭·F1)');

    console.log('── ⑦ date-only endsAt KST 정규화(F5) ──');
    const rDate = await create({ title: PFX + 'date-only', body: '본문', endsAt: '2099-12-31' });
    ok(rDate.ok === true, '⑦ date-only endsAt 발행 ok');
    const drow = await db.select({ endsAt: announcements.endsAt }).from(announcements).where(eq(announcements.id, rDate.id));
    const got = drow[0]?.endsAt?.toISOString();
    ok(got === '2099-12-31T14:59:59.999Z', `⑦ 'YYYY-MM-DD' endsAt → 해당일 14:59:59.999Z(KST 23:59:59) 정규화 [got=${got}]`);

    console.log('── ⑧ fail-closed 인증(무토큰·틀린토큰 → 401) ──');
    ok((await post({ title: PFX + 'noauth', body: 'x' }, null)).status === 401, '⑧ 무토큰 POST → 401(fail-closed)');
    ok((await post({ title: PFX + 'wrongauth', body: 'x' }, 'wrong-token-0123456789ab')).status === 401, '⑧ 틀린 토큰 POST → 401');
    ok((await annRoute.GET(new Request('http://x/api/admin/announcement', { method: 'GET', headers: { 'content-type': 'application/json' } }))).status === 401, '⑧ 무토큰 GET → 401');
    ok((await del(MISSING, null)).status === 401, '⑧ 무토큰 DELETE → 401');
  } finally {
    // 정리 — 프리픽스 테스트 공지 전부 삭제(공유 dev DB 오염 방지)
    await db.delete(announcements).where(and(eq(announcements.projCode, PROJ_CODE), like(announcements.title, `${PFX}%`)));
    console.log('  ✓ 정리 완료(_DV_ANN_ 테스트 공지 삭제)');
  }

  console.log(fail === 0 ? '\n✅ 공지 CRUD 가드 — 기간 필터·정렬·proj 스코프·404 대칭·타임존·인증 전부 통과' : `\n❌ ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
