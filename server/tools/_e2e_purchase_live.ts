// 결제 라우트 LIVE E2E (BACKEND_SYSTEM §13.18) — 실행 중 서버(localhost:3000) HTTP 왕복 + 로컬 Supabase 원장 대조.
//   _dv_purchase(순수 판정 + in-process route 호출)가 못 덮는 **실제 HTTP 라우트 왕복**을 검증:
//   ①dev 로그인→userId ②RC 웹훅(Authorization 시크릿)→원장 지급 ③같은 txn 재전송→dedup(잔액 불변)
//   ④confirm 폴백(RC 키 없어 rc-unconfigured 503 관측 — 실제 RC 호출 mock 금지) + Bearer 없음→401
//   ⑤CANCELLATION 환불→음수 차감 ⑥SANDBOX→무시(원장 무변) ⑦Authorization 불일치→401.
//   실행: 서버가 RC_WEBHOOK_SECRET을 로드한 상태여야 함(.env.development.local, 서버 재시작 필요).
//   npx tsx tools/_e2e_purchase_live.ts   (dev는 .env.development.local 우선 — DATABASE_URL·RC_WEBHOOK_SECRET)
import './_env'; // db/postgres 연결 + 시크릿 주입 전에 env 로드(첫 import)

const BASE = process.env.E2E_BASE ?? 'http://localhost:3000';
const SEC = process.env.RC_WEBHOOK_SECRET ?? '';
const WH = '/api/purchase/webhook/revenuecat';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
const jget = async (path: string, headers: any = {}) => { const r = await fetch(BASE + path, { headers }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
const jpost = async (path: string, body: any, headers: any = {}) => { const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
// 웹훅 POST — RC는 { event } 래핑. auth=null이면 Authorization 헤더 생략.
const webhook = (event: any, auth: string | null) => jpost(WH, { event }, auth ? { authorization: auth } : {});

(async () => {
  if (!SEC || SEC.length < 16) {
    console.error(`\n❌ RC_WEBHOOK_SECRET 미설정/<16자 — .env.development.local에 추가하고 dev 서버 재시작 후 재실행.\n   (없으면 서버 verifyWebhookAuth가 fail-closed라 웹훅 지급 경로를 검증할 수 없음)`);
    process.exit(1);
  }
  const postgres = (await import('postgres')).default;
  const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });
  // 원장 잔액 = sum(delta) (돈의 진실 — wallet 라우트 로직과 독립). 유저별로 격리(테스트 유저 유일).
  const bal = async (uid: string): Promise<number> => { const r = await sql`select coalesce(sum(delta),0)::int n from wallet_ledger where user_id=${uid}`; return r[0].n; };
  let uid = '';
  let token = '';
  const TXN = `_E2E_TXN_${Date.now()}`;   // 유일 거래id(재실행/잔류와 충돌 방지 — 멱등키에 txn 포함)
  const grantEv = { app_user_id: '', transaction_id: TXN, environment: 'PRODUCTION', type: 'NON_RENEWING_PURCHASE', product_id: 'dia_1000' };

  try {
    console.log('=== 0. 서버 헬스 ===');
    const h = await jget('/api/health'); ok(h.s === 200 && h.j.ok, `서버 헬스 ${h.s}`);
    if (h.s !== 200) throw new Error('서버(:3000) 미기동 — dev 서버 먼저 띄울 것');

    console.log('\n=== ① dev 로그인 → userId(=RC app_user_id) ===');
    const login = await jpost('/api/auth/login', { provider: 'dev', providerId: `_e2e_purchase_${Date.now()}` });
    ok(login.s === 200 && login.j.token && login.j.userId, `dev 로그인 → userId=${login.j.userId}`);
    uid = login.j.userId; token = login.j.token;
    grantEv.app_user_id = uid;
    const USERH = { authorization: `Bearer ${token}` };
    ok(await bal(uid) === 0, '  신규 유저 잔액 0');

    console.log('\n=== ⑦ Authorization 불일치 → 401(위조 차단, 지급 전 검증) ===');
    const rBad = await webhook(grantEv, 'wrong-secret'); ok(rBad.s === 401, `틀린 시크릿 → ${rBad.s}(401 기대)`);
    const rNone = await webhook(grantEv, null); ok(rNone.s === 401, `헤더 없음 → ${rNone.s}(401 기대)`);
    ok(await bal(uid) === 0, '  401은 원장 무변화(지급 안 됨)');

    console.log('\n=== ② 정상 웹훅(dia_1000, PRODUCTION, 시크릿 일치) → 원장 +1000 ===');
    const r1 = await webhook(grantEv, SEC); ok(r1.s === 200 && r1.j.ok && r1.j.applied === true, `applied=true (status ${r1.s})`);
    ok(await bal(uid) === 1000, `  원장 +1000 반영 (실제=${await bal(uid)})`);

    console.log('\n=== ③ 같은 txn 웹훅 재전송 → dedup(applied=false, 잔액 불변) ===');
    const r2 = await webhook(grantEv, SEC); ok(r2.s === 200 && r2.j.ok && r2.j.applied === false, `재전송 applied=false (status ${r2.s})`);
    ok(await bal(uid) === 1000, '  이중지급 없음(잔액 1000 유지)');

    console.log('\n=== ④ confirm 폴백 — RC 키 없어 rc-unconfigured(503) 관측 + Bearer 없음 401 ===');
    const cNoAuth = await jpost('/api/purchase/confirm', { storeTxnId: TXN, productId: 'dia_1000' }, {});
    ok(cNoAuth.s === 401, `Bearer 없음 → ${cNoAuth.s}(401 기대)`);
    const cUnconf = await jpost('/api/purchase/confirm', { storeTxnId: TXN, productId: 'dia_1000' }, USERH);
    ok(cUnconf.s === 503 && cUnconf.j.reason === 'rc-unconfigured', `RC 미설정 → ${cUnconf.s}/${cUnconf.j.reason}(503/rc-unconfigured 기대)`);
    ok(await bal(uid) === 1000, '  confirm 미검증이라 지급 없음(잔액 1000 유지)');

    console.log('\n=== ⑥ SANDBOX 환경 웹훅 → 무시(prod 원장에 유령 다이아 방지) ===');
    const rSand = await webhook({ ...grantEv, transaction_id: `${TXN}_SBX`, environment: 'SANDBOX' }, SEC);
    ok(rSand.s === 200 && rSand.j.ignored === 'sandbox', `SANDBOX → ignored=${rSand.j.ignored}(sandbox 기대)`);
    ok(await bal(uid) === 1000, '  샌드박스는 원장 무변(잔액 1000 유지)');

    console.log('\n=== ⑤ CANCELLATION 환불 웹훅(같은 txn) → −1000(잔액 0) ===');
    const rRef = await webhook({ ...grantEv, type: 'CANCELLATION' }, SEC);
    ok(rRef.s === 200 && rRef.j.ok && rRef.j.applied === true, `환불 applied=true (status ${rRef.s})`);
    ok(await bal(uid) === 0, `  환불 −1000 → 잔액 0 (실제=${await bal(uid)})`);
    const rRef2 = await webhook({ ...grantEv, type: 'REFUND' }, SEC);
    ok(rRef2.s === 200 && rRef2.j.applied === false && await bal(uid) === 0, '  이중 환불(같은 txn) → dedup(잔액 0 유지)');

    console.log(fail === 0
      ? '\n✅ PASS 결제 LIVE E2E — 실 HTTP 라우트 왕복: 인증·지급·dedup·환불·샌드박스·confirm(rc-unconfigured) 전부 확인'
      : `\n❌ FAIL ${fail}건`);
  } finally {
    console.log('\n=== 정리(테스트 유저·원장·감사로그·매출롤업 복구) ===');
    try {
      // statsDaily 매출 롤업 되돌림 — 적용된 grant 1건(count+1, diamonds+1000, KRW+0). 환불은 롤업 미호출.
      const day = new Date().toISOString().slice(0, 10);
      await sql`update stats_daily set purchase_count = purchase_count - 1, diamonds_purchased = diamonds_purchased - 1000 where day=${day} and purchase_count >= 1 and diamonds_purchased >= 1000`;
      // 테스트 유저 전량 삭제(잔류 크래시분 포함 — providerId 접두 매칭). FK 순서: 자식→부모.
      await sql`delete from wallet_ledger where user_id in (select id from users where provider='dev' and provider_id like '_e2e_purchase_%')`;
      await sql`delete from purchase_event where user_id in (select id::text from users where provider='dev' and provider_id like '_e2e_purchase_%')`;
      await sql`delete from purchase_event where rc_app_user_id in (select id::text from users where provider='dev' and provider_id like '_e2e_purchase_%')`;
      await sql`delete from users where provider='dev' and provider_id like '_e2e_purchase_%'`;
      const left = await sql`select count(*)::int n from users where provider='dev' and provider_id like '_e2e_purchase_%'`;
      console.log(`  잔여 _e2e_purchase 유저 ${left[0].n} (0이어야 정상)`);
    } catch (e: any) { console.error('  정리 실패:', e.message); }
    await sql.end();
  }
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('THROW', e); process.exit(1); });
