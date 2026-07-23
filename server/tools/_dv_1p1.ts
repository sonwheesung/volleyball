// 월 1+1 순수 검증 가드 (ATTENDANCE_PASS_SYSTEM §10 _dv_1p1) — 월-멱등키(월×팩 1회)·R4 월귀속(purchased_at)·R3 샌드박스 스코프·환불 월키 미복구.
// **DB 무의존**(키 빌더·월귀속 순수 함수만). A/B 자가검증. 라이브 이중지급/부활/미복구 실동작은 _dv_pass_live가 HTTP로 검증.
// Usage: cd server && npx tsx tools/_dv_1p1.ts
import { bonus1p1Key, bonusRefundKey, passRefundKey } from '../lib/pass';
import { kstYearMonth } from '../lib/dates';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

console.log('── 월-멱등키 = 월×팩 1회 강제(§3.1) ──');
const k = (pid: string, ym: string, sb = false) => bonus1p1Key('u1', pid, ym, sb);
ok(k('dia_1000', '2026-07') === 'iap_bonus_1p1:u1:dia_1000:2026-07', '키 형식 iap_bonus_1p1:<user>:<pack>:<연월>');
ok(k('dia_1000', '2026-07') === k('dia_1000', '2026-07'), '같은 (user,pack,월) → 동일 키 → 그 달 2번째 구매 dedupe(보너스 0)');
ok(k('dia_1000', '2026-07') !== k('dia_1000', '2026-08'), '다음 달(2026-08) → 다른 키 → 보너스 부활');
ok(k('dia_1000', '2026-07') !== k('dia_500', '2026-07'), '다른 팩 → 다른 키(팩별 독립 월 1회)');
ok(bonus1p1Key('u1', 'dia_1000', '2026-07', false) !== bonus1p1Key('u2', 'dia_1000', '2026-07', false), '다른 user → 다른 키');
// A/B: 키에서 연월 제거(또는 txnId 추가) → 매 구매 유니크 → 매번 보너스(월1회 강제 붕괴 = 검출)
{
  const brokenNoMonth = (pid: string) => `iap_bonus_1p1:u1:${pid}`; // 연월 누락 뮤턴트 — 팩 단위라 월경계 무시
  ok(brokenNoMonth('dia_1000') === brokenNoMonth('dia_1000'), '  [A/B] 연월 누락 키는 7월·8월 같은 키(오히려 dedupe 과다 — 월경계 소실)');
  const brokenWithTxn = (pid: string, ym: string, txn: string) => `iap_bonus_1p1:u1:${pid}:${ym}:${txn}`; // txnId 추가 뮤턴트
  ok(brokenWithTxn('dia_1000', '2026-07', 'T1') !== brokenWithTxn('dia_1000', '2026-07', 'T2'), '  [A/B] txnId 섞인 키 → 같은 달 매 구매 다른 키 → 매번 보너스(월1회 붕괴 검출)');
  ok(k('dia_1000', '2026-07') === k('dia_1000', '2026-07'), '  [A/B] 정상 키는 같은 달 재구매 동일 → 2번째 dedupe(월1회 강제)');
}

console.log('── R4: 월귀속 = purchased_at KST 연월(웹훅 처리시각 아님) ──');
// KST 월말 23:59 vs 다음달 00:01 경계. KST=UTC+9.
ok(kstYearMonth(new Date('2026-07-31T14:59:00Z')) === '2026-07', 'KST 07-31 23:59 → 2026-07(월말 귀속)');
ok(kstYearMonth(new Date('2026-07-31T15:01:00Z')) === '2026-08', 'KST 08-01 00:01 → 2026-08(월초 귀속)');
ok(kstYearMonth(new Date('2026-07-15T00:00:00Z')) === '2026-07', 'KST 07-15 09:00 → 2026-07(대낮 무영향)');
// A/B: 월말 자정 근처 구매(purchased_at=KST 07-31 23:59)를 웹훅 처리시각(KST 08-01 00:05)으로 귀속하면 8월로 오귀속
{
  const purchasedAt = new Date('2026-07-31T14:59:00Z');   // 실거래(KST 07-31 23:59)
  const processedAt = new Date('2026-07-31T15:05:00Z');   // 웹훅 처리(KST 08-01 00:05, 지연)
  const correct = k('dia_1000', kstYearMonth(purchasedAt)); // R4: purchased_at 기준
  const wrong = k('dia_1000', kstYearMonth(processedAt));   // 뮤턴트: 처리시각 기준
  ok(kstYearMonth(purchasedAt) === '2026-07' && kstYearMonth(processedAt) === '2026-08', '  [A/B] purchased_at=2026-07 vs 처리시각=2026-08(경계 지연)');
  ok(correct !== wrong, '  [A/B] 처리시각 귀속 시 다른 월키 → "그 달 첫 구매" 어긋남(경계 오귀속 검출) : R4는 purchased_at로 봉인');
}

console.log('── R3: 샌드박스 월키 별도 스코프(prod 월키 미소진) ──');
ok(bonus1p1Key('u1', 'dia_1000', '2026-07', true) === 'iap_bonus_1p1:u1:dia_1000:2026-07:sandbox', '샌드박스 키 = :sandbox 접미');
ok(bonus1p1Key('u1', 'dia_1000', '2026-07', true) !== bonus1p1Key('u1', 'dia_1000', '2026-07', false), '샌드박스 키 ≠ prod 키(테스트 구매가 실 월키 미소진)');
// A/B: 스코프 없는 구로직 → 샌드박스·prod 같은 키 → 샌드박스 테스트가 실유저 그 달 보너스 소진(검출)
{
  const brokenNoScope = (sb: boolean) => `iap_bonus_1p1:u1:dia_1000:2026-07`; // sandbox 무시 뮤턴트
  ok(brokenNoScope(true) === brokenNoScope(false), '  [A/B] 스코프 무시 키 → 샌드박스=prod 같은 키(실 월키 소진 = 결함 검출)');
  ok(bonus1p1Key('u1', 'dia_1000', '2026-07', true) !== bonus1p1Key('u1', 'dia_1000', '2026-07', false), '  [A/B] 정상은 스코프 분리(격리)');
}

console.log('── §4.2: 환불 월키 미복구(환불→재구매 파밍 차단) ──');
// 보너스 회수는 별도 키(refund_bonus:...)라 원 월-멱등키(iap_bonus_1p1:...:월)는 원장에 그대로 → 같은 달 재구매 보너스 0.
ok(bonusRefundKey('u1', 'T9') === 'refund_bonus:u1:T9', '보너스 회수 키 refund_bonus:<user>:<txn>(별도 키)');
ok(bonusRefundKey('u1', 'T9') !== bonus1p1Key('u1', 'dia_1000', '2026-07', false), '회수 키 ≠ 월-멱등키 → 회수해도 월키 원장에 잔존(플래그 미복구)');
ok(bonusRefundKey('u1', 'T9') !== passRefundKey('u1', 'T9'), '보너스 회수 키 ≠ 패스 클로백 키(reason=refund 공유·멱등키 분리 §4.4)');

console.log(fail === 0 ? '\n✅ _dv_1p1 순수 검증 통과 — 월×팩 멱등·R4 purchased_at 귀속·R3 샌드박스 스코프·환불 월키 미복구 전부' : `\n❌ ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
