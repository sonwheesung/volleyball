// 백엔드 통합 E2E — 실행 중 서버(localhost:3000) + 실 Supabase. 각 플로우 검증 후 **테스트 데이터 전량 정리**.
//   공지 발행→bootstrap 노출→삭제 · 쿠폰 개인+단체 발급→(단체)수령→지갑적립 · 문의 등록→조회. 전부 'E2E' 마킹 + 정리.
//   npx tsx tools/_e2e_backend.ts
import './_env'; // dev는 .env.development.local(로컬 Supabase) 우선, 없으면 .env.local — db/postgres 연결 전에 주입
const ADMIN = process.env.ADMIN_TOKEN!;
const BASE = 'http://localhost:3000';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
const jget = async (path: string, headers: any = {}) => { const r = await fetch(BASE + path, { headers }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
const jpost = async (path: string, body: any, headers: any = {}) => { const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
const jdel = async (path: string, headers: any = {}) => { const r = await fetch(BASE + path, { method: 'DELETE', headers }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
const ADMH = { authorization: `Bearer ${ADMIN}` };
const now = new Date().toISOString();

(async () => {
  const postgres = (await import('postgres')).default;
  const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });
  let uid = ''; // 테스트 유저(정리 대상)
  try {
    console.log('=== 0. 서버/DB 연결 ===');
    const h = await jget('/api/health'); ok(h.s === 200 && h.j.ok, `서버 헬스 ${h.s}`);

    console.log('\n=== 1. 관리자 공지사항 → bootstrap 노출 ===');
    const before = await jget('/api/bootstrap');
    const before_n = (before.j.announcements ?? before.j.notice ?? []).length ?? 0;
    const pub = await jpost('/api/admin/announcement', { title: 'E2E 점검 공지', body: 'E2E 자동 점검용 공지입니다.', startsAt: now, pinned: true }, ADMH);
    ok(pub.s === 200 && pub.j.ok && pub.j.id, `공지 발행 (id=${pub.j.id})`);
    const annId = pub.j.id;
    const after = await jget('/api/bootstrap');
    const list = after.j.announcements ?? after.j.notice ?? [];
    const shown = Array.isArray(list) && list.some((a: any) => a.id === annId || a.title === 'E2E 점검 공지');
    ok(shown, `bootstrap에 공지 노출 (${Array.isArray(list) ? list.length : '?'}건)`);
    const admList = await jget('/api/admin/announcement', ADMH);
    ok(admList.s === 200 && (admList.j.announcements ?? []).some((a: any) => a.id === annId), '관리자 목록에도 노출');
    // 삭제 → bootstrap에서 사라짐
    await jdel(`/api/admin/announcement?id=${annId}`, ADMH);
    const gone = await jget('/api/bootstrap');
    const goneList = gone.j.announcements ?? gone.j.notice ?? [];
    ok(!(Array.isArray(goneList) && goneList.some((a: any) => a.id === annId)), '삭제 후 bootstrap에서 사라짐');

    console.log('\n=== 2. 세션 발급(문의/수령용) ===');
    const login = await jpost('/api/auth/login', { provider: 'test', providerId: 'e2e-backend' });
    ok(login.s === 200 && login.j.token && login.j.userId, `세션 발급 (userId=${login.j.userId})`);
    const USERH = { authorization: `Bearer ${login.j.token}` };
    uid = login.j.userId;

    console.log('\n=== 3. 쿠폰 발급 — 개인 + 단체(전체) ===');
    const cAll = `E2EALL${Date.now() % 100000}`;
    const cOne = `E2EONE${Date.now() % 100000}`;
    const rAll = await jpost('/api/admin/coupon', { code: cAll, rewardDiamonds: 50, targetUserId: null, startsAt: now }, ADMH);
    ok(rAll.s === 200 && rAll.j.ok, `단체(전체) 쿠폰 발급 (${cAll})`);
    const rOne = await jpost('/api/admin/coupon', { code: cOne, rewardDiamonds: 70, targetUserId: uid, startsAt: now }, ADMH);
    ok(rOne.s === 200 && rOne.j.ok, `개인 쿠폰 발급 (${cOne} → ${uid})`);
    // DB 확인 — 개인/단체 구분 저장
    const cRows = await sql`select code, target_user_id, reward_diamonds from coupons where code in (${cAll},${cOne})`;
    ok(cRows.length === 2, 'DB에 쿠폰 2건 저장');
    ok(cRows.some((r: any) => r.code === cAll && r.target_user_id === null), '단체 쿠폰 target_user_id=null');
    ok(cRows.some((r: any) => r.code === cOne && r.target_user_id === uid), `개인 쿠폰 target_user_id=${uid}`);
    // 단체 쿠폰 수령 → 지갑 적립
    const redeem = await jpost('/api/coupon/redeem', { code: cAll }, USERH);
    ok(redeem.s === 200 && (redeem.j.ok || redeem.j.reward), `단체 쿠폰 수령 → 보상 ${redeem.j.reward ?? redeem.j.balance ?? '?'}`);

    console.log('\n=== 4. 문의하기(ticket) 등록 → 조회 ===');
    const tk = await jpost('/api/ticket', { category: 'etc', content: 'E2E 자동 점검 문의입니다(정리 대상).', device: { platform: 'android', osVersion: '14', appVersion: '0.0.0' } }, USERH);
    ok(tk.s === 200 && tk.j.ok && tk.j.ticketId, `문의 등록 (ticketId=${tk.j.ticketId})`);
    const tid = tk.j.ticketId;
    const dbTk = await sql`select id, user_id, category, content from tickets where id=${tid}`;
    ok(dbTk.length === 1 && dbTk[0].user_id === uid, 'DB에 문의 저장(userId 귀속)');
    const myTk = await jget('/api/ticket', USERH);
    ok(myTk.s === 200 && (myTk.j.tickets ?? []).some((t: any) => t.id === tid), '내 문의 목록 조회에 노출');
    // 테스트 유저 정리(문의/수령 삭제 후)

    console.log(fail === 0 ? '\n✅ PASS 백엔드 통합 — 공지·쿠폰(개인/단체)·문의 전부 Supabase 저장/노출 확인' : `\n❌ FAIL ${fail}건`);
  } finally {
    console.log('\n=== 정리(테스트 데이터 삭제 — FK 순서: 자식→부모) ===');
    try {
      if (uid) {
        await sql`delete from coupon_redemptions where user_id=${uid} or coupon_id in (select id from coupons where code like 'E2E%')`;
        await sql`delete from wallet_ledger where user_id=${uid}`;
        await sql`delete from tickets where user_id=${uid}`;
      }
      await sql`delete from coupons where code like 'E2E%'`;
      if (uid) await sql`delete from users where id=${uid}`;
      const leftC = await sql`select count(*)::int n from coupons where code like 'E2E%'`;
      const leftU = await sql`select count(*)::int n from users where provider='test'`;
      console.log(`  잔여 E2E 쿠폰 ${leftC[0].n} · test 유저 ${leftU[0].n} (0이어야 정상)`);
    } catch (e: any) { console.error('  정리 실패:', e.message); }
    await sql.end();
  }
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('THROW', e); process.exit(1); });
