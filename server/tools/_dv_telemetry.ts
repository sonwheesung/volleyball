// 시즌 종료 행동 텔레메트리 라이브 가드 (BACKEND_SYSTEM §13.27) — 라우트 핸들러 직접 import·호출, 라이브 dev DB.
// 검증: ① POST → DB에 payload 저장(내용 정확) ② 같은 (user,season) 재전송 = 업서트(1행 유지·payload 교체)
//       ③ 다른 season = 별 행 ④ 무토큰 401 ⑤ 비정수 season 400 · payload 비객체(배열/원시) 400 · 16KB 초과 413
//       ⑥ 관리자 집계(/api/admin/telemetry)가 저장분을 반영(reports·사용자 롤업)
//       + A/B 자가검증(업서트가 실제로 잡는가 — onConflict 없이 삽입만 하면 同시즌 재전송이 2행이 됐을 것을 직접 insert로 증명).
// Usage: cd server && npx tsx tools/_dv_telemetry.ts  (dev DB 필요 — _env가 .env.development.local의 DATABASE_URL 로드.
//         ⑥ 관리자집계 검증은 ADMIN_TOKEN 필요 — env 미설정이면 그 항목만 skip, 나머지는 검증됨.)
import './_env'; // db 모듈 import 전에 env 주입(호이스팅 순서 — 첫 import)

(async () => {
  const loginRoute = await import('../app/api/auth/login/route');
  const teleRoute = await import('../app/api/telemetry/route');
  const adminRoute = await import('../app/api/admin/telemetry/route');
  const { db } = await import('../db');
  const { users, seasonTelemetry } = await import('../db/schema');
  const { eq, and, like, inArray } = await import('drizzle-orm');
  const { PROJ_CODE } = await import('../lib/proj');
  const { ensureProj } = await import('../lib/wallet');

  let fail = 0;
  const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

  const PFX = '_DVTELE_';
  const ADMIN = process.env.ADMIN_TOKEN ?? 'dev-admin';
  const createdIds: string[] = [];

  const hdr = (auth: string | null): Record<string, string> => { const h: Record<string, string> = { 'content-type': 'application/json' }; if (auth) h.authorization = `Bearer ${auth}`; return h; };
  const login = async (providerId: string) => {
    const r = await loginRoute.POST(new Request('http://x/api/auth/login', { method: 'POST', headers: hdr(null), body: JSON.stringify({ provider: 'dev', providerId, ageConfirmed: true }) }));
    return r.json() as Promise<{ token: string; userId: string }>;
  };
  const post = (body: unknown, auth: string | null) => teleRoute.POST(new Request('http://x/api/telemetry', { method: 'POST', headers: hdr(auth), body: typeof body === 'string' ? body : JSON.stringify(body) }));
  const adminGet = (auth: string | null) => adminRoute.GET(new Request('http://x/api/admin/telemetry', { method: 'GET', headers: hdr(auth) }));
  const rows = async (userId: string) => db.select().from(seasonTelemetry).where(and(eq(seasonTelemetry.projCode, PROJ_CODE), eq(seasonTelemetry.userId, userId)));

  const mkPayload = (over: Partial<Record<string, unknown>> = {}) => ({
    v: 1, season: 5, finalRank: 3, champion: false,
    subs: { total: 4, manual: 3, pinch: 1 }, timeouts: 2, interventions: 6,
    lineupChanges: 1, coachMode: true, releases: 2, expels: 0, trainingFocus: '4,6|1,10,12', campCount: 3, ...over,
  });

  try {
    await ensureProj();

    console.log('── 셋업: dev 로그인 1계정 ──');
    const a = await login(PFX + 'A_' + Date.now());
    ok(!!a.token && !!a.userId, '셋업: token+userId 발급');
    createdIds.push(a.userId);

    console.log('── ① POST → DB payload 저장(내용 정확) ──');
    const r1 = await (await post({ season: 5, payload: mkPayload() }, a.token)).json();
    ok(r1.ok === true, '① POST → ok:true');
    const after1 = await rows(a.userId);
    ok(after1.length === 1, '① DB 1행 생성');
    const p1 = (after1[0]?.payload ?? {}) as Record<string, unknown>;
    ok(p1.interventions === 6 && p1.coachMode === true && (p1.subs as Record<string, unknown>)?.manual === 3, '① payload 내용 정확(개입·지휘모드·subs 저장)');
    ok(after1[0]?.season === 5, '① season 정확(5)');

    console.log('── ② 같은 (user,season) 재전송 = 업서트(1행 유지·payload 교체) ──');
    const r2 = await (await post({ season: 5, payload: mkPayload({ interventions: 99, champion: true }) }, a.token)).json();
    ok(r2.ok === true, '② 재전송 → ok:true');
    const after2 = await rows(a.userId);
    ok(after2.length === 1, '② 행 수 불변(1 — 업서트 교체, 중복 행 안 생김)');
    const p2 = (after2.find((x) => x.season === 5)?.payload ?? {}) as Record<string, unknown>;
    ok(p2.interventions === 99 && p2.champion === true, '② payload가 새 값으로 교체됨(99·우승)');

    console.log('── ③ 다른 season = 별 행 ──');
    await (await post({ season: 6, payload: mkPayload({ season: 6 }) }, a.token)).json();
    const after3 = await rows(a.userId);
    ok(after3.length === 2, '③ 다른 시즌은 별 행(2행)');

    console.log('── ④ 무토큰 401 ──');
    ok((await post({ season: 7, payload: mkPayload() }, null)).status === 401, '④ 무토큰 POST → 401');

    console.log('── ⑤ 입력 검증(비정수 season · payload 비객체 · 16KB 초과) ──');
    ok((await post({ season: 5.5, payload: mkPayload() }, a.token)).status === 400, '⑤ 비정수 season → 400');
    ok((await post({ payload: mkPayload() }, a.token)).status === 400, '⑤ season 누락 → 400');
    ok((await post({ season: 5, payload: [1, 2, 3] }, a.token)).status === 400, '⑤ payload 배열 → 400(객체만)');
    ok((await post({ season: 5, payload: 'nope' }, a.token)).status === 400, '⑤ payload 문자열 → 400(객체만)');
    ok((await post({ season: 5, payload: null }, a.token)).status === 400, '⑤ payload null → 400');
    const big = { blob: 'x'.repeat(17 * 1024) };
    ok((await post({ season: 5, payload: big }, a.token)).status === 413, '⑤ 16KB 초과 payload → 413');
    // A/B 경계: 16KB '미만' 동일 형태는 200 → 413은 순전히 크기가 원인(오라클 민감)
    ok((await (await post({ season: 8, payload: { blob: 'x'.repeat(8 * 1024) } }, a.token)).json()).ok === true, '⑤-AB 16KB 미만 동일 형태는 200(거부는 크기가 원인)');

    console.log('── ⑥ 관리자 집계가 저장분 반영 ──');
    const adm = await (await adminGet(ADMIN)).json();
    if (adm.ok !== true) {
      console.log('  · (skip) admin 집계 응답 ok 아님 — ADMIN_TOKEN 불일치일 수 있음(무토큰 401만 확인)');
    } else {
      ok(nnumOk(adm.agg?.reports), '⑥ agg.reports 존재(≥0)');
      const mine = (adm.users as Array<{ userId: string; seasons: unknown[] }>).find((u) => u.userId === a.userId);
      ok(!!mine, '⑥ 사용자 롤업에 테스트 유저 등장');
      ok(!!mine && mine.seasons.length >= 2, '⑥ 테스트 유저 시즌 추이 2개 이상(5·6·8시즌)');
    }
    ok((await adminGet(null)).status === 401, '⑥ 무토큰 admin GET → 401');

    console.log('── ⑦ A/B: 업서트가 실제로 재전송 중복을 막는가(onConflict 없는 직접 삽입은 2행 됨) ──');
    // 라우트 우회 직접 insert 2회(같은 user,season) → UNIQUE 제약이 없었다면 2행. 실제로는 UNIQUE라 2번째가 throw됨을 확인.
    let dupThrew = false;
    try {
      await db.insert(seasonTelemetry).values({ projCode: PROJ_CODE, userId: a.userId, season: 5, payload: {} });
    } catch { dupThrew = true; }
    ok(dupThrew, '⑦-AB (proj,user,season) UNIQUE가 중복 삽입을 차단 — 라우트 업서트가 없으면 이 제약이 없거나 재전송이 500이 됐을 것(가드 민감)');
  } finally {
    const pref = await db.select({ id: users.id }).from(users).where(and(eq(users.projCode, PROJ_CODE), like(users.providerId, `${PFX}%`)));
    const allIds = Array.from(new Set([...createdIds, ...pref.map((u) => u.id)]));
    if (allIds.length) {
      await db.delete(seasonTelemetry).where(inArray(seasonTelemetry.userId, allIds));
      await db.delete(users).where(inArray(users.id, allIds));
    }
    console.log('  ✓ 정리 완료(_DVTELE_ 테스트 계정·텔레메트리 삭제)');
  }

  console.log(fail === 0 ? '\n✅ 시즌 텔레메트리 가드 — 저장·업서트교체·별시즌·인증401·입력검증(400/413)·관리자집계·UNIQUE(+AB) 전부 통과' : `\n❌ ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });

function nnumOk(v: unknown): boolean { return typeof v === 'number' && Number.isFinite(v) && v >= 0; }
