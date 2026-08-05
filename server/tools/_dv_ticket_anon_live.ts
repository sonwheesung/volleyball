// 익명 문의 라이브 가드 (/api/ticket/anon) — 라우트 핸들러 직접 import·호출, 라이브 dev DB.
// 검증: allowlist 게이트(미설정·미허용 proj = 404)·정상 등록 왕복(줄바꿈·이모지)·익명 유저 1행 재사용·
//       입력 검증(5자 미만 400·이상 category→etc·본문 상한 컷)·24h 총량 캡 429·응답에 ticketId 미노출·
//       osVersion 미수집(기기 지문 최소화)·**기존 /api/ticket 은 여전히 무토큰 401**(익명 추가가 기존 경로를 열지 않음).
// A/B 자가검증: 404 검사마다 대조군(허용 proj 동일 요청은 성공)을 같이 확인 — "항상 404라 통과"인 허위 오라클 배제.
// 정리: **이번 실행이 만든 proj 만** 삭제(실행마다 고유 proj 코드 — 병렬 세션 간섭 없음).
// Usage: cd server && npx tsx tools/_dv_ticket_anon_live.ts
import './_env'; // db 모듈 import 전에 env 주입(호이스팅 순서 — 첫 import)

(async () => {
  const anonRoute = await import('../app/api/ticket/anon/route');
  const ticketRoute = await import('../app/api/ticket/route');
  const { db } = await import('../db');
  const { tickets, users, projInfo } = await import('../db/schema');
  const { and, eq } = await import('drizzle-orm');

  let fail = 0;
  const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

  // 실행마다 고유 proj — 병렬 세션과 절대 안 겹치고, 정리도 이 proj만 지우면 끝난다.
  const PROJ = `_dv_anon_${Date.now().toString(36)}`;
  const CONTENT = '첫 줄\n둘째 줄  들여쓰기\n\n이모지 🏐💎 "따옴표" <tag> & 앰퍼샌드';

  const post = (body: unknown) =>
    anonRoute.POST(new Request('http://x/api/ticket/anon', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }));
  const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> });

  try {
    // ── 1. allowlist 미설정이면 라우트 비활성(404) ──
    delete process.env.ANON_TICKET_PROJECTS;
    {
      const r = await json(await post({ proj: PROJ, category: 'bug', content: CONTENT }));
      ok(r.status === 404, `allowlist 미설정 → 404 (got ${r.status})`);
      ok(r.body.ok === false, 'allowlist 미설정 → ok:false');
    }

    // 이후 테스트는 이 proj 만 허용. 대조군으로 쓸 미허용 proj 도 준비.
    process.env.ANON_TICKET_PROJECTS = `${PROJ}, someother `; // 공백·대소문자 정규화도 함께 검증
    process.env.ANON_TICKET_DAILY_CAP = '3';

    // ── 2. 미허용 proj → 404 (A/B: 허용 proj 는 아래 3에서 성공) ──
    {
      const r = await json(await post({ proj: 'not-allowed-proj', category: 'bug', content: CONTENT }));
      ok(r.status === 404, `미허용 proj → 404 (got ${r.status})`);
    }

    // ── 3. 정상 등록 ──
    {
      const r = await json(await post({
        proj: PROJ.toUpperCase(), // 대소문자 정규화 검증(허용 목록은 소문자)
        category: 'bug',
        content: `  ${CONTENT}  `, // 앞뒤 공백 — trim 검증
        device: { platform: 'android', appVersion: '1.2.3' },
      }));
      ok(r.status === 200 && r.body.ok === true, `정상 등록 → 200 ok (got ${r.status})`);
      ok(!('ticketId' in r.body), '응답에 ticketId 미노출');
    }

    const rows1 = await db.select().from(tickets).where(eq(tickets.projCode, PROJ));
    ok(rows1.length === 1, `DB 티켓 1건 (got ${rows1.length})`);
    ok(rows1[0]?.content === CONTENT, '본문 왕복 일치(줄바꿈·이모지·따옴표·꺾쇠, trim 적용)');
    ok(rows1[0]?.category === 'bug', 'category 저장');
    ok(rows1[0]?.platform === 'android' && rows1[0]?.appVersion === '1.2.3', '기기정보(platform·appVersion) 저장');
    ok(rows1[0]?.osVersion === null, 'osVersion 미수집(null) — 기기 지문 최소화');
    ok(rows1[0]?.status === 'open' && rows1[0]?.reply === null, '기본 상태 open·답변 없음');

    // ── 4. 익명 유저는 프로젝트당 1행 재사용 ──
    {
      const r = await json(await post({ proj: PROJ, category: 'suggestion', content: '두 번째 문의입니다' }));
      ok(r.status === 200, '두 번째 등록 성공');
    }
    const anonUsers = await db.select().from(users)
      .where(and(eq(users.projCode, PROJ), eq(users.provider, 'dev'), eq(users.providerId, 'anon')));
    ok(anonUsers.length === 1, `익명 유저 1행만 생성·재사용 (got ${anonUsers.length})`);
    const rows2 = await db.select().from(tickets).where(eq(tickets.projCode, PROJ));
    ok(rows2.length === 2 && new Set(rows2.map((t) => t.userId)).size === 1, '두 문의가 같은 익명 유저에 귀속');
    ok(anonUsers[0]?.ageConfirmedAt === null, '익명 유저는 연령확인 없음(null) — 스키마 주석대로');

    // ── 5. 입력 검증 ──
    {
      const r = await json(await post({ proj: PROJ, category: 'bug', content: '짧음' })); // 4자
      ok(r.status === 400, `본문 5자 미만 → 400 (got ${r.status})`);
    }
    {
      const r = await json(await post({ proj: PROJ, category: 'bug', content: '   \n  ' })); // trim 후 빈 문자열
      ok(r.status === 400, `공백만 있는 본문 → 400 (got ${r.status})`);
    }
    {
      const r = await json(await post({ proj: PROJ, category: '<script>', content: '이상한 분류값 테스트' }));
      ok(r.status === 200, '이상 category 도 접수는 성공');
    }
    const weird = await db.select().from(tickets).where(eq(tickets.projCode, PROJ));
    ok(weird.some((t) => t.category === 'etc'), '허용 목록 밖 category → etc 로 정규화');

    // ── 6. 24h 총량 캡(Upstash 없이 동작하는 fail-closed 가드) ──
    // 현재 3건(정상2 + 이상category1), 캡 3 → 다음 요청은 막혀야 한다.
    {
      const before = await db.select().from(tickets).where(eq(tickets.projCode, PROJ));
      ok(before.length === 3, `캡 검사 직전 3건 (got ${before.length})`);
      const r = await json(await post({ proj: PROJ, category: 'bug', content: '캡 초과 요청입니다' }));
      ok(r.status === 429, `24h 캡 초과 → 429 (got ${r.status})`);
      const after = await db.select().from(tickets).where(eq(tickets.projCode, PROJ));
      ok(after.length === 3, `캡 초과 요청은 저장 안 됨 (got ${after.length})`);
    }
    // 캡을 올리면 다시 통과(A/B 대조군 — "항상 429라 통과"인 허위 오라클 배제)
    {
      process.env.ANON_TICKET_DAILY_CAP = '10';
      const r = await json(await post({ proj: PROJ, category: 'bug', content: '캡 상향 후 요청입니다' }));
      ok(r.status === 200, `캡 상향 후 다시 성공 (got ${r.status})`);
    }
    // 잘못된 캡 값이면 기본값 폴백(설정 실수로 캡이 풀리지 않는다)
    {
      process.env.ANON_TICKET_DAILY_CAP = '0';
      const r = await json(await post({ proj: PROJ, category: 'bug', content: '캡 0 이면 기본값 폴백' }));
      ok(r.status === 200, '캡 0(잘못된 값) → 기본값 폴백으로 정상 동작');
    }

    // ── 7. 본문 상한 컷 ──
    {
      process.env.ANON_TICKET_DAILY_CAP = '100';
      const long = 'ㄱ'.repeat(2500);
      await post({ proj: PROJ, category: 'question', content: long });
      const rows = await db.select().from(tickets).where(eq(tickets.projCode, PROJ));
      const stored = rows.find((t) => t.content.startsWith('ㄱㄱㄱ'));
      ok(stored?.content.length === 2000, `본문 2000자로 컷 (got ${stored?.content.length})`);
    }

    // ── 8. 격리 대조군 — 익명 라우트 추가가 기존 인증 경로를 열지 않았는가 ──
    {
      const r = await ticketRoute.POST(new Request('http://x/api/ticket', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category: 'bug', content: '무토큰 요청입니다' }),
      }));
      ok(r.status === 401, `기존 /api/ticket 무토큰 → 여전히 401 (got ${r.status})`);
    }
    {
      const r = await ticketRoute.GET(new Request('http://x/api/ticket', { method: 'GET' }));
      ok(r.status === 401, `기존 /api/ticket GET 무토큰 → 여전히 401 (got ${r.status})`);
    }

    // ── 9. 익명 라우트에 GET 핸들러 없음(목록 조회 경로 미개방) ──
    ok(!('GET' in anonRoute), '익명 라우트에 GET 없음 — 문의 목록 조회 불가');
  } finally {
    // 정리 — 이번 실행이 만든 proj 만(고유 코드라 남의 데이터와 겹치지 않음). FK 역순 삭제.
    await db.delete(tickets).where(eq(tickets.projCode, PROJ));
    await db.delete(users).where(eq(users.projCode, PROJ));
    await db.delete(projInfo).where(eq(projInfo.projCode, PROJ));
    const left = await db.select().from(tickets).where(eq(tickets.projCode, PROJ));
    console.log(left.length === 0 ? '  ✓ 정리 완료' : `  ✗ 정리 실패 — ${left.length}건 남음`);
  }

  console.log(fail === 0 ? '\n✅ 익명 문의 가드 PASS' : `\n❌ ${fail}건 FAIL`);
  process.exit(fail === 0 ? 0 : 1);
})();
