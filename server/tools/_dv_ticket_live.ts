// 문의(티켓) 라이브 가드 (BACKEND_SYSTEM §13.17·§13.2) — 라우트 핸들러 직접 import·호출, 라이브 dev DB.
// 검증: 등록→유저GET→관리자GET 왕복 일치(줄바꿈·이모지)·**타 proj 티켓 답변 404**(2026-07-24 P0, 공지 F1과 동일 클래스)·
//       **미존재 uuid 답변 404**(허위 ok 금지)·**타 proj 스냅샷 조회 404**(세이브 유출 차단)·
//       상태 어휘 왕복(answered/reviewing + repliedAt 노출)·fail-closed 인증(무토큰·유저토큰·오타 admin)·빈 상태 200 [].
// A/B 자가검증: 각 스코프 검사마다 대조군(우리 proj 동일 요청은 성공 / 대상 행은 DB에 실재)을 같이 확인 —
//              "항상 404라서 통과"인 허위 오라클을 배제한다.
// 정리: **자기가 만든 id만** 삭제(프리픽스 일괄 삭제 금지 — 병렬 세션 데이터 유실 사고 방지).
// Usage: cd server && npx tsx tools/_dv_ticket_live.ts (dev는 .env.development.local 우선, 없으면 .env.local)
import './_env'; // db 모듈 import 전에 env 주입(호이스팅 순서 — 첫 import)
process.env.ADMIN_TOKEN = 'test-admin-token-abcdef0123456789'; // ≥16자(fail-closed 통과용) — import 전 주입
process.env.SESSION_JWT_SECRET = 'test-session-secret-abcdef0123456789'; // signToken↔verifyToken 일관 — import 전 주입

(async () => {
  const ADMIN = process.env.ADMIN_TOKEN!;
  const ticketRoute = await import('../app/api/ticket/route');
  const adminList = await import('../app/api/admin/ticket/route');
  const replyRoute = await import('../app/api/admin/ticket/reply/route');
  const adminSnap = await import('../app/api/admin/ticket/snapshot/route');
  const userSnap = await import('../app/api/snapshot/route');
  const { signToken } = await import('../lib/auth');
  const { ensureUser, ensureProj } = await import('../lib/wallet');
  const { db } = await import('../db');
  const { tickets, diagnosticSnapshots, users, projInfo } = await import('../db/schema');
  const { and, eq, inArray, sql } = await import('drizzle-orm');
  const { PROJ_CODE } = await import('../lib/proj');

  let fail = 0;
  const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

  const PFX = '_DV_TKT_';
  const OTHER_PROJ = '_dv_tkt_otherproj'; // 타 게임(멀티게임 격리 대조군) — 가드가 만들고 가드가 지운다
  const MISSING = '00000000-0000-0000-0000-000000000000'; // 유효 UUID 형식·미존재(404 유도)
  // 왕복 무결성용 본문 — 줄바꿈·이모지·따옴표·꺾쇠 포함(인코딩/이스케이프 손상 검출)
  const CONTENT = `${PFX}첫 줄\n둘째 줄  들여쓰기\n\n이모지 🏐💎 "따옴표" <tag> & 앰퍼샌드`;
  const REPLY = `답변 첫 줄\n둘째 줄 ✅ "인용" <b>`;

  const hdr = (auth: string | null): Record<string, string> => { const h: Record<string, string> = { 'content-type': 'application/json' }; if (auth) h.authorization = `Bearer ${auth}`; return h; };
  const uPost = (body: unknown, token: string | null) => ticketRoute.POST(new Request('http://x/api/ticket', { method: 'POST', headers: hdr(token), body: JSON.stringify(body) }));
  const uGet = (token: string | null) => ticketRoute.GET(new Request('http://x/api/ticket', { method: 'GET', headers: hdr(token) }));
  const aGet = (qs = '', auth: string | null = ADMIN) => adminList.GET(new Request(`http://x/api/admin/ticket${qs}`, { method: 'GET', headers: hdr(auth) }));
  const aReply = (body: unknown, auth: string | null = ADMIN) => replyRoute.POST(new Request('http://x/api/admin/ticket/reply', { method: 'POST', headers: hdr(auth), body: JSON.stringify(body) }));
  const aSnap = (ticketId: string, auth: string | null = ADMIN) => adminSnap.GET(new Request(`http://x/api/admin/ticket/snapshot?ticketId=${encodeURIComponent(ticketId)}`, { method: 'GET', headers: hdr(auth) }));
  const uSnapPost = (body: unknown, token: string | null) => userSnap.POST(new Request('http://x/api/snapshot', { method: 'POST', headers: hdr(token), body: JSON.stringify(body) }));

  type UTicket = { id: string; content: string; status?: string; reply?: string; createdAt: string; repliedAt?: string | null };
  const myTickets = async (token: string): Promise<UTicket[]> => ((await (await uGet(token)).json()).tickets ?? []) as UTicket[];
  const mine = async (token: string, id: string): Promise<UTicket | undefined> => (await myTickets(token)).find((t) => t.id === id);
  const adminTickets = async (qs = ''): Promise<Array<{ id: string; content: string; status: string; reply: string | null }>> => ((await (await aGet(qs)).json()).tickets ?? []);
  const rowOf = async (id: string) => (await db.select({ status: tickets.status, reply: tickets.reply, repliedAt: tickets.repliedAt, projCode: tickets.projCode }).from(tickets).where(eq(tickets.id, id)).limit(1))[0];

  const madeTickets: string[] = []; // 이 실행이 만든 티켓 id만 추적(프리픽스 일괄 삭제 금지)
  const madeUsers: string[] = [];
  let madeProj = false;

  try {
    await ensureProj();
    const pidA = PFX + 'userA', pidB = PFX + 'userB';
    const uidA = await ensureUser(pidA, 'dev'); madeUsers.push(uidA);
    const uidB = await ensureUser(pidB, 'dev'); madeUsers.push(uidB); // 티켓 0건(빈 상태 대조)
    const tokenA = signToken(`dev:${pidA}`);
    const tokenB = signToken(`dev:${pidB}`);

    // 타 proj 대조군 — 별도 게임(projInfo) + 그 게임 유저 + 티켓 1건(+진단 스냅샷 1건)
    await db.insert(projInfo).values({ projCode: OTHER_PROJ, name: OTHER_PROJ }).onConflictDoNothing({ target: projInfo.projCode });
    madeProj = true;
    const otherUid = (await db.insert(users).values({ projCode: OTHER_PROJ, provider: 'dev', providerId: PFX + 'otherUser' })
      .returning({ id: users.id }))[0].id;
    madeUsers.push(otherUid);
    const otherTid = (await db.insert(tickets).values({ projCode: OTHER_PROJ, userId: otherUid, category: 'bug', content: PFX + '타 게임 문의' })
      .returning({ id: tickets.id }))[0].id;
    madeTickets.push(otherTid);
    await db.insert(diagnosticSnapshots).values({ projCode: OTHER_PROJ, ticketId: otherTid, snapshot: { secret: PFX + 'other-proj-save' } });

    console.log('── ① 등록 → 유저 GET → 관리자 GET 왕복 일치(줄바꿈·이모지) ──');
    const rNew = await (await uPost({ category: 'bug', content: CONTENT, device: { platform: 'android', osVersion: '14', appVersion: '0.4.0' } }, tokenA)).json();
    ok(rNew.ok === true && typeof rNew.ticketId === 'string', '① 등록(POST) → ok+ticketId');
    const tid = rNew.ticketId as string;
    madeTickets.push(tid);
    const m1 = await mine(tokenA, tid);
    ok(!!m1 && m1.content === CONTENT, `① 유저 GET 본문 왕복 일치(줄바꿈·이모지 무손상) [len=${m1?.content.length}/${CONTENT.length}]`);
    ok(m1?.status === 'open', `① 신규 티켓 status=open [got=${m1?.status}]`);
    ok((m1?.repliedAt ?? null) === null, '① 미답변 티켓 repliedAt=null');
    const a1 = (await adminTickets()).find((t) => t.id === tid);
    ok(!!a1 && a1.content === CONTENT, '① 관리자 GET 본문도 동일(왕복 일치)');

    console.log('── ② 상태 어휘 왕복: reviewing → answered + repliedAt 노출 ──');
    ok((await (await aReply({ ticketId: tid, status: 'reviewing' })).json()).ok === true, '② status=reviewing 지정 → ok');
    ok((await mine(tokenA, tid))?.status === 'reviewing', '② 유저 GET에 reviewing 노출(앱 라벨 "확인 중")');
    const rRep = await (await aReply({ ticketId: tid, reply: REPLY })).json();
    ok(rRep.ok === true, '② 답변 저장 → ok');
    const m2 = await mine(tokenA, tid);
    ok(m2?.status === 'answered', `② 답변 시 status=answered 저장·노출 [got=${m2?.status}]`);
    ok(m2?.reply === REPLY, '② 답변 본문 왕복 일치(줄바꿈·이모지 무손상)');
    ok(!!m2?.repliedAt && !isNaN(new Date(m2.repliedAt).getTime()), `② 유저 GET에 repliedAt(답변 시각) 노출·파싱 가능 [got=${m2?.repliedAt}]`);

    console.log('── ③ 타 proj 티켓 답변 → 404 + DB 무변화 (+A/B 민감도) ──');
    const before = await rowOf(otherTid);
    const rCross = await aReply({ ticketId: otherTid, reply: 'HACK', status: 'answered' });
    const rCrossBody = await rCross.json();
    ok(rCross.status === 404 && rCrossBody.ok === false, `③ 타 proj 티켓 답변 → 404 not-found [status=${rCross.status} ok=${rCrossBody.ok}]`);
    const after = await rowOf(otherTid);
    ok(after?.status === before?.status && after?.reply === before?.reply && (after?.repliedAt ?? null) === (before?.repliedAt ?? null),
      `③ 타 proj 티켓 DB 무변화(status/reply/repliedAt) [status=${after?.status} reply=${after?.reply}]`);
    // A/B 자가검증: 같은 호출이 **우리 proj** 티켓엔 실제로 먹힌다(→ "항상 404"인 무딘 검사가 아님)
    ok((await aReply({ ticketId: tid, reply: REPLY + '-ab' })).status === 200, '③-AB 동일 호출이 우리 proj 티켓엔 200(검사 민감도 — 항상 404 아님)');
    ok((await rowOf(tid))?.reply === REPLY + '-ab', '③-AB 우리 proj 티켓은 DB 반영됨(대조군)');
    await aReply({ ticketId: tid, reply: REPLY }); // 원래 답변으로 복구(⑤ 대조 유지)

    console.log('── ④ 존재하지 않는 uuid 답변 → 404(허위 ok 금지) ──');
    const rMiss = await aReply({ ticketId: MISSING, reply: 'x' });
    const rMissBody = await rMiss.json();
    ok(rMiss.status === 404 && rMissBody.ok !== true, `④ 미존재 uuid 답변 → 404·ok!==true [status=${rMiss.status} ok=${rMissBody.ok}]`);
    ok((await aReply({ ticketId: '' })).status === 400, '④ ticketId 누락 → 400 bad-request');

    console.log('── ⑤ 스냅샷 proj 스코프: 우리 proj 200 / 타 proj 404 (+A/B 실재 대조) ──');
    ok((await uSnapPost({ ticketId: tid, snapshot: { probe: PFX + 'mine' } }, tokenA)).status === 200, '⑤ 유저 스냅샷 첨부(내 티켓) → 200');
    const rSnapOk = await aSnap(tid);
    const rSnapOkBody = await rSnapOk.json();
    ok(rSnapOk.status === 200 && (rSnapOkBody.snapshot as { probe?: string })?.probe === PFX + 'mine', '⑤ 관리자 스냅샷 조회(우리 proj) → 200 + 내용 일치');
    const rSnapX = await aSnap(otherTid);
    const rSnapXBody = await rSnapX.json();
    ok(rSnapX.status === 404 && !rSnapXBody.snapshot, `⑤ 타 proj 티켓 스냅샷 조회 → 404·본문 없음(세이브 유출 차단) [status=${rSnapX.status}]`);
    // A/B 자가검증: 그 스냅샷은 DB에 실재한다 — "데이터가 없어서 404"가 아니라 "스코프가 막아서 404"임을 증명
    const cnt = (await db.select({ n: sql<number>`count(*)::int` }).from(diagnosticSnapshots).where(eq(diagnosticSnapshots.ticketId, otherTid)))[0]?.n ?? 0;
    ok(cnt === 1, `⑤-AB 타 proj 스냅샷은 DB에 실재(n=${cnt}) — 부재가 아니라 스코프가 막은 404`);
    // 유저 첨부 라우트도 타 proj 티켓엔 첨부 불가(방어층)
    ok((await uSnapPost({ ticketId: otherTid, snapshot: { probe: 'x' } }, tokenA)).status === 401, '⑤ 유저가 타 proj 티켓에 스냅샷 첨부 시도 → 401(소유권+proj)');

    console.log('── ⑥ proj 스코프 목록: 관리자 GET에 타 proj 티켓 미노출 ──');
    const list = await adminTickets();
    ok(list.some((t) => t.id === tid) && !list.some((t) => t.id === otherTid), '⑥ 관리자 목록 = 우리 proj만(타 게임 티켓 미노출)');

    console.log('── ⑦ fail-closed 인증(무토큰·유저토큰·오타 admin → 401) ──');
    ok((await aReply({ ticketId: tid, reply: 'x' }, null)).status === 401, '⑦ 무토큰 답변 → 401');
    ok((await aReply({ ticketId: tid, reply: 'x' }, tokenA)).status === 401, '⑦ 유저 토큰으로 답변 → 401(admin 아님)');
    ok((await aReply({ ticketId: tid, reply: 'x' }, ADMIN + 'x')).status === 401, '⑦ 오타 admin 토큰 → 401');
    ok((await aSnap(tid, null)).status === 401, '⑦ 무토큰 스냅샷 조회 → 401');
    ok((await aSnap(tid, ADMIN.slice(0, -1))).status === 401, '⑦ 잘린 admin 토큰 스냅샷 조회 → 401');
    ok((await aGet('', null)).status === 401, '⑦ 무토큰 관리자 목록 → 401');
    ok((await uGet(null)).status === 401, '⑦ 무토큰 유저 목록 → 401(익명 폴백 금지 P0-5)');
    ok((await uPost({ category: 'bug', content: PFX + '무토큰 등록 시도' }, null)).status === 401, '⑦ 무토큰 등록 → 401');
    ok((await uGet('bogus.token')).status === 401, '⑦ 위조 유저 토큰 → 401');
    // 답변 내용이 위 401 시도들로 오염되지 않았는지(fail-closed가 실제로 write를 막았나)
    ok((await rowOf(tid))?.reply === REPLY, '⑦-AB 401 시도들이 DB를 건드리지 않음(reply 원본 유지)');

    console.log('── ⑧ 빈 상태 → 200 [] ──');
    const rEmptyU = await uGet(tokenB);
    ok(rEmptyU.status === 200 && Array.isArray((await rEmptyU.json()).tickets) === true, '⑧ 티켓 0건 유저 GET → 200 + 배열');
    ok((await myTickets(tokenB)).length === 0, '⑧ 티켓 0건 유저 목록 = [](빈 배열, null/에러 아님)');
    const rEmptyA = await aGet('?status=_dv_nosuch_status');
    const rEmptyABody = await rEmptyA.json();
    ok(rEmptyA.status === 200 && Array.isArray(rEmptyABody.tickets) && rEmptyABody.tickets.length === 0, '⑧ 매칭 0건 관리자 필터 → 200 []');
    // A/B: 같은 필터 축이 실제로 걸러진다(항상 빈 배열 아님)
    ok((await adminTickets('?status=answered')).some((t) => t.id === tid), '⑧-AB status=answered 필터엔 우리 티켓이 잡힘(필터 민감도)');
  } finally {
    // 정리 — **이 실행이 만든 id만** 삭제(FK 순서: 스냅샷 → 티켓 → 유저 → proj). 프리픽스 일괄 삭제 금지.
    if (madeTickets.length) {
      await db.delete(diagnosticSnapshots).where(inArray(diagnosticSnapshots.ticketId, madeTickets));
      await db.delete(tickets).where(inArray(tickets.id, madeTickets));
    }
    if (madeUsers.length) await db.delete(users).where(inArray(users.id, madeUsers));
    if (madeProj) await db.delete(projInfo).where(and(eq(projInfo.projCode, OTHER_PROJ), sql`not exists (select 1 from users u where u.proj_code = ${OTHER_PROJ})`));
    console.log('  ✓ 정리 완료(이번 실행이 만든 티켓·스냅샷·유저·테스트 proj만 삭제)');
  }

  console.log(fail === 0 ? '\n✅ 문의(티켓) 라이브 가드 — 왕복 일치·proj 스코프(답변/스냅샷/목록)·404 대칭·상태 어휘·repliedAt·인증·빈 상태 전부 통과' : `\n❌ ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
