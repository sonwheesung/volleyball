// 환불 순수 가드 (BACKEND_SYSTEM §13.17) — 음수 balance 허용 게이트가 **환불만** 여는지(reason 파생).
// 이 한 줄이 머니-크리티컬: refund 외 reason에 음수가 새면 무한 소비 버그. A/B로 전 reason 대조.
// 서버 왕복(음수 환불·멱등·티켓 refunded·음수→spend 차단)은 로컬 서버 라이브 E2E로 실증.
import { allowsNegativeBalance } from '../server/lib/econ';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

console.log('── 잔액게이트 우회 = 환불만(§13.17 P0-1) ──');
ok(allowsNegativeBalance('refund') === true, 'refund → 음수 balance 허용');
// A/B: 다른 모든 reason은 음수 불가(spend/earn 게이트 유지) — 하나라도 true면 무한소비 구멍
for (const r of ['camp', 'ad', 'achievement', 'coupon', 'purchase', 'adjust', '']) {
  ok(allowsNegativeBalance(r) === false, `${r || '(빈문자)'} → 음수 불가(게이트 유지)`);
}

console.log(fail === 0 ? '\n✅ PASS _dv_refund' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
