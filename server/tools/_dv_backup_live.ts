// 시즌 종료 세이브 백업 라이브 가드 (BACKEND_SYSTEM §13.26) — 라우트 핸들러 직접 import·호출, 라이브 dev DB.
// 검증: ① 업로드→목록 등장(sizeBytes·saveVersion 정확) ② 6개→5개 유지(최고령 삭제) ③ 同시즌 재업로드=교체(행 수 불변)
//       ④ 다운로드 payload 바이트 왕복 동일 ⑤ 무토큰 401·타유저 id 404 ⑥ 3MB 초과 413 ⑦ 쓰레기 payload(봉투 불일치) 400
//       + A/B 자가검증(상한·봉투 검증이 실제로 잡는가 — 검증 제거 모사 시 통과됐을 입력이 실제로 거부됨을 증명).
// Usage: cd server && DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/postgres" npx tsx tools/_dv_backup_live.ts
import './_env'; // db 모듈 import 전에 env 주입(호이스팅 순서 — 첫 import)

(async () => {
  const loginRoute = await import('../app/api/auth/login/route');
  const backupRoute = await import('../app/api/save-backup/route');
  const idRoute = await import('../app/api/save-backup/[id]/route');
  const { db } = await import('../db');
  const { users, saveBackups } = await import('../db/schema');
  const { eq, and, like, inArray } = await import('drizzle-orm');
  const { PROJ_CODE } = await import('../lib/proj');
  const { ensureProj } = await import('../lib/wallet');

  let fail = 0;
  const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const PFX = '_DVBK_';
  const MISSING = '00000000-0000-0000-0000-000000000000'; // 유효 UUID·미존재
  const createdIds: string[] = [];

  const hdr = (auth: string | null): Record<string, string> => { const h: Record<string, string> = { 'content-type': 'application/json' }; if (auth) h.authorization = `Bearer ${auth}`; return h; };
  const login = async (providerId: string) => {
    const r = await loginRoute.POST(new Request('http://x/api/auth/login', { method: 'POST', headers: hdr(null), body: JSON.stringify({ provider: 'dev', providerId, ageConfirmed: true }) }));
    return r.json() as Promise<{ token: string; userId: string }>;
  };
  const envelope = (version: string, pad = '') => JSON.stringify({ app: 'baeknyeon', kind: 'save-export', version, state: { d: 'seed', pad } });
  const post = (body: unknown, auth: string | null) => backupRoute.POST(new Request('http://x/api/save-backup', { method: 'POST', headers: hdr(auth), body: JSON.stringify(body) }));
  const list = (auth: string | null) => backupRoute.GET(new Request('http://x/api/save-backup', { method: 'GET', headers: hdr(auth) }));
  const download = (id: string, auth: string | null) => idRoute.GET(new Request(`http://x/api/save-backup/${id}`, { method: 'GET', headers: hdr(auth) }), { params: Promise.resolve({ id }) });
  const rowCount = async (userId: string) => (await db.select({ id: saveBackups.id }).from(saveBackups).where(and(eq(saveBackups.projCode, PROJ_CODE), eq(saveBackups.userId, userId)))).length;

  try {
    await ensureProj();

    console.log('── 셋업: dev 로그인 2계정(userA·userB) ──');
    const a = await login(PFX + 'A_' + Date.now());
    const b = await login(PFX + 'B_' + Date.now());
    ok(!!a.token && !!a.userId && !!b.token && !!b.userId, '셋업: 두 계정 token+userId 발급');
    createdIds.push(a.userId, b.userId);

    console.log('── ① 업로드 → 목록 등장(sizeBytes·saveVersion 정확) ──');
    const p1 = envelope('3');
    const expBytes = Buffer.byteLength(p1, 'utf8');
    const r1 = await (await post({ season: 10, payload: p1 }, a.token)).json();
    ok(r1.ok === true && typeof r1.id === 'string' && r1.keptCount === 1, '① 업로드 → ok+id+keptCount=1');
    const l1 = await (await list(a.token)).json();
    const row1 = (l1.backups ?? []).find((x: { id: string }) => x.id === r1.id);
    ok(!!row1, '① 목록에 방금 업로드가 등장');
    ok(row1?.season === 10, '① season 정확(10)');
    ok(row1?.sizeBytes === expBytes, `① sizeBytes 정확(${expBytes})`);
    ok(row1?.saveVersion === '3', '① saveVersion 봉투서 추출 정확(3)');
    ok(!('payload' in (row1 ?? {})), '① 목록엔 payload 미포함(가벼움)');

    console.log('── ④ 다운로드 payload 바이트 왕복 동일 ──');
    const d1 = await (await download(r1.id, a.token)).json();
    ok(d1.ok === true && d1.payload === p1, '④ 다운로드 payload === 업로드 원문(바이트 왕복 동일)');

    console.log('── ② 6개(다른 season) 업로드 → 최고령 삭제, 5개 유지 ──');
    for (let s = 1; s <= 6; s++) { await post({ season: 100 + s, payload: envelope(`v${s}`) }, b.token); await sleep(4); } // sleep=created_at 순서 확정
    ok((await rowCount(b.userId)) === 5, '② 6개 업로드 후 DB 행 5개(롤링 상한)');
    const lB = await (await list(b.token)).json();
    const seasonsB = new Set<number>((lB.backups ?? []).map((x: { season: number }) => x.season));
    ok(!seasonsB.has(101), '② 최고령(season 101, 첫 업로드) 삭제됨');
    ok(seasonsB.has(106), '② 최신(season 106) 유지됨');
    ok((lB.backups?.[0]?.season) === 106, '② 목록 최신순(맨 앞=106)');

    console.log('── ③ 同시즌 재업로드 = 교체(행 수 불변) ──');
    const before = await rowCount(b.userId);
    const rRe = await (await post({ season: 106, payload: envelope('replaced') }, b.token)).json();
    ok(rRe.ok === true && rRe.keptCount === 5, '③ 同시즌 재업로드 → ok+keptCount=5');
    ok((await rowCount(b.userId)) === before, `③ 행 수 불변(${before} 유지 — 중복 행 안 생김)`);
    const dRe = await (await download(rRe.id, b.token)).json();
    ok(dRe.ok === true && JSON.parse(dRe.payload).version === 'replaced', '③ season 106 내용이 새 payload로 교체됨');

    console.log('── ⑤ 무토큰 401 · 타유저 id 404 ──');
    ok((await post({ season: 10, payload: envelope('x') }, null)).status === 401, '⑤ 무토큰 POST → 401');
    ok((await list(null)).status === 401, '⑤ 무토큰 GET(목록) → 401');
    ok((await download(r1.id, null)).status === 401, '⑤ 무토큰 GET(다운로드) → 401');
    // userA가 userB의 백업 id를 조회 → 404(소유/존재 노출 0)
    ok((await download(rRe.id, a.token)).status === 404, '⑤ 타유저(userB) 백업 id를 userA가 조회 → 404');
    ok((await download(MISSING, a.token)).status === 404, '⑤ 미존재 id → 404');
    ok((await download('not-a-uuid', a.token)).status === 404, '⑤ 비UUID id → 404(DB 캐스트 에러 누출 없음)');

    console.log('── ⑥ 3MB 초과 거부(413) + A/B 경계(3MB 미만 봉투 정상=200) ──');
    const over = envelope('big', 'x'.repeat(3_200_000)); // payload 바이트 > 3MB
    ok(Buffer.byteLength(over, 'utf8') > 3 * 1024 * 1024, '⑥ (준비) over payload > 3MB 확인');
    ok((await post({ season: 20, payload: over }, a.token)).status === 413, '⑥ 3MB 초과 payload → 413 거부');
    // A/B 민감도: 봉투는 동일(baeknyeon/save-export)이고 크기만 3MB '미만'이면 통과 → 413은 순전히 '크기'가 원인
    const under = envelope('big', 'x'.repeat(3_000_000)); // payload 바이트 < 3MB
    ok(Buffer.byteLength(under, 'utf8') < 3 * 1024 * 1024, '⑥ (준비) under payload < 3MB 확인');
    const rUnder = await (await post({ season: 20, payload: under }, a.token)).json();
    ok(rUnder.ok === true, '⑥-AB 크기만 3MB 미만인 동일 봉투는 200(거부는 봉투 아닌 크기가 원인 — 오라클 민감)');

    console.log('── ⑦ 쓰레기 payload(봉투 불일치) 400 + A/B(봉투검증 제거 모사 시 통과됐을 입력이 실제로 거부됨) ──');
    const badApp = JSON.stringify({ app: 'evil', kind: 'save-export', version: '1', state: {} }); // app 불일치
    const badKind = JSON.stringify({ app: 'baeknyeon', kind: 'not-export', version: '1' }); // kind 불일치
    const notJson = 'this is not json at all {';
    ok((await post({ season: 30, payload: badApp }, a.token)).status === 400, '⑦ app 불일치 payload → 400');
    ok((await post({ season: 30, payload: badKind }, a.token)).status === 400, '⑦ kind 불일치 payload → 400');
    ok((await post({ season: 30, payload: notJson }, a.token)).status === 400, '⑦ 비JSON payload → 400');
    ok((await post({ season: 30, payload: '' }, a.token)).status === 400, '⑦ 빈 payload → 400');
    ok((await post({ season: 1.5, payload: envelope('x') }, a.token)).status === 400, '⑦ 비정수 season → 400');
    // A/B 민감도: 봉투 검증이 '없었다면' 이 쓰레기 payload는 DB에 그대로 저장됐을 것 —
    // 라우트를 우회한 직접 insert가 성공함을 보여 "400은 라우트 봉투검증이 잡은 것(DB 제약 아님)"을 증명 → 검증 제거 모사 시 통과됨.
    const abIns = await db.insert(saveBackups)
      .values({ projCode: PROJ_CODE, userId: a.userId, season: 999, payload: badApp, sizeBytes: Buffer.byteLength(badApp, 'utf8'), saveVersion: null })
      .returning({ id: saveBackups.id });
    ok(abIns.length === 1, '⑦-AB 봉투검증 우회(직접 insert)면 쓰레기 payload가 DB에 저장됨 — 즉 검증 제거 시 통과됐을 입력을 라우트가 400으로 거부(허위 오라클 아님)');
    await db.delete(saveBackups).where(inArray(saveBackups.id, abIns.map((r) => r.id))); // A/B 인공물 즉시 제거
  } finally {
    // 정리 — 프리픽스 테스트 유저의 백업 먼저(FK) → 유저 삭제(현재 실행분 + 잔여분 방어)
    const pref = await db.select({ id: users.id }).from(users).where(and(eq(users.projCode, PROJ_CODE), like(users.providerId, `${PFX}%`)));
    const allIds = Array.from(new Set([...createdIds, ...pref.map((u) => u.id)]));
    if (allIds.length) {
      await db.delete(saveBackups).where(inArray(saveBackups.userId, allIds));
      await db.delete(users).where(inArray(users.id, allIds));
    }
    console.log('  ✓ 정리 완료(_DVBK_ 테스트 계정·백업 삭제)');
  }

  console.log(fail === 0 ? '\n✅ 세이브 백업 가드 — 업로드/목록·롤링5·同시즌교체·왕복동일·인증401/404·3MB413·봉투400(+AB) 전부 통과' : `\n❌ ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
