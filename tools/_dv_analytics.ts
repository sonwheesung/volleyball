// 분석 래퍼 가드 (ANALYTICS_PLAN) — track()이 **throw 없음**(계측 실패가 게임 안 멈춤)이고 taxonomy 등록이 건강한지.
import './_gt_mock';

(async () => {
  const { track, ANALYTICS_EVENTS } = await import('../lib/analytics');
  let fail = 0;
  const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

  console.log('── throw-none (전 이벤트 + 이상한 params) ──');
  let threw = false;
  for (const e of ANALYTICS_EVENTS) {
    try { track(e, { amount: 5, source: 'x', flag: true, bad: undefined, long: 'z'.repeat(500) }); }
    catch { threw = true; console.error('  ✗ threw on', e); }
  }
  ok(!threw, `${ANALYTICS_EVENTS.length}개 이벤트 전부 throw 없음(node=production 경로·SDK 미설치 no-op)`);
  try { track('app_open'); track('login', {}); ok(true, 'params 없음/빈 객체도 안전'); } catch { ok(false, 'no-param throw'); }

  console.log('── taxonomy 등록 건강 ──');
  ok(new Set(ANALYTICS_EVENTS).size === ANALYTICS_EVENTS.length, '중복 이벤트 없음');
  ok(ANALYTICS_EVENTS.every((e) => typeof e === 'string' && e.length > 0 && e.length <= 40), '전부 비어있지 않은 ≤40자 이름(Firebase 제약)');
  for (const must of ['app_open', 'login', 'logout', 'watch_ad', 'diamond_earned', 'diamond_spent', 'special_training', 'purchase']) {
    ok(ANALYTICS_EVENTS.includes(must as never), `계측 대상 '${must}' 등록됨`);
  }

  console.log(fail === 0 ? '\n✅ PASS _dv_analytics' : `\n❌ FAIL ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
})();
