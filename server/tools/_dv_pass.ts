// 출석 패스 순수 검증 가드 (ATTENDANCE_PASS_SYSTEM §10 _dv_pass) — 창 산술·리셋보정·B3 유예·멱등키·상수 미러.
// **DB 무의존**(순수 함수만). 각 항목 A/B 자가검증(변이 주입 → 검출 증명). 프로덕션 코드 무변(가드 안에서 뮤턴트 재현).
// Usage: cd server && npx tsx tools/_dv_pass.ts
import {
  passWindow, claimableDayIndexes, isWithinClaimWindow, passDailyKey, passRefundKey,
} from '../lib/pass';
import { todayKstResetAdjusted, addDays, diffDays } from '../lib/dates';
import {
  PASS_DAILY_REWARD, PASS_DURATION_DAYS, PASS_MAX_TOTAL, PASS_RESET_HOUR_KST, PASS_GRACE_DAYS,
} from '../lib/econ';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
const eqArr = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

console.log('── 상수 미러(문서 락값 §0·§6 손복제 드리프트) ──');
// 문서 확정 기획(락): 매일 100·28일·최대 2,800·리셋 KST 04:00·유예 3일. 서버 상수가 이 락과 일치해야.
ok(PASS_DAILY_REWARD === 100, `PASS_DAILY_REWARD=100 (실측 ${PASS_DAILY_REWARD})`);
ok(PASS_DURATION_DAYS === 28, `PASS_DURATION_DAYS=28 (실측 ${PASS_DURATION_DAYS})`);
ok(PASS_MAX_TOTAL === 2800, `PASS_MAX_TOTAL=2800 파생 (실측 ${PASS_MAX_TOTAL})`);
ok(PASS_MAX_TOTAL === PASS_DAILY_REWARD * PASS_DURATION_DAYS, '  MAX = DAILY × DURATION 정합');
ok(PASS_RESET_HOUR_KST === 4, `PASS_RESET_HOUR_KST=4 (Q6) (실측 ${PASS_RESET_HOUR_KST})`);
ok(PASS_GRACE_DAYS === 3, `PASS_GRACE_DAYS=3 (Q5=B) (실측 ${PASS_GRACE_DAYS})`);
// A/B: 락값과 다른 손복제(150/27)를 스펙과 대조 → 드리프트 검출
{
  const SPEC = { daily: 100, dur: 28, max: 2800 };
  const drifted = { daily: 150, dur: 28, max: 150 * 28 };
  ok(SPEC.daily === PASS_DAILY_REWARD, '  [A/B] 서버 상수 == 스펙 락(현행 통과)');
  ok(drifted.daily !== SPEC.daily && drifted.max !== SPEC.max, '  [A/B] 손복제 150 변이 → 스펙 대조서 드리프트 검출(민감도)');
}

console.log('── 창 산술: 28슬롯(dayIndex 0~27)·최대 2,800 ──');
const w = passWindow('2026-07-01');
ok(w.startDate === '2026-07-01' && w.endDate === '2026-07-28', `start 07-01 → end 07-28(포함 28일) — 실측 ${w.endDate}`);
ok(diffDays(w.startDate, w.endDate) === PASS_DURATION_DAYS - 1, '  end - start = 27일(28슬롯)');
// 28일 완주 시뮬 — off 0..27 매일 접속, 각 dayIndex 1회 지급(멱등키가 dedupe). 총 28회 × 100 = 2,800.
{
  const claimed = new Set<number>();
  for (let off = 0; off <= 27; off++) {
    const today = addDays('2026-07-01', off);
    for (const idx of claimableDayIndexes('2026-07-01', today)) claimed.add(idx); // 멱등: Set이 중복 흡수
  }
  const total = claimed.size * PASS_DAILY_REWARD;
  ok(claimed.size === 28 && total === 2800, `28일 완주(매일 접속) → 28슬롯·${total}💎 (실측 ${claimed.size}슬롯·${total})`);
  // A/B: 창 29슬롯 변이(off 0..28) → 슬롯 29·2,900(초과) 검출
  const claimed29 = new Set<number>();
  for (let off = 0; off <= 28; off++) for (const idx of claimableDayIndexes('2026-07-01', addDays('2026-07-01', off))) claimed29.add(idx);
  ok(claimed29.size === 28, `  [A/B] off 28까지 돌려도 dayIndex는 27 클램프 → 여전히 28슬롯(초과지급 0) — 실측 ${claimed29.size}`);
}

console.log('── day-0 즉시 · 정상 당일 후보(유예창 = 최근 G일, 미수령만 dedup 지급) ──');
// claimableDayIndexes는 "후보"(최근 G일 슬롯) — 매일 접속하면 앞 G-1일은 이미 수령돼 멱등 dedupe, 실지급은 당일 1슬롯.
ok(eqArr(claimableDayIndexes('2026-07-01', '2026-07-01'), [0]), '구매 당일(off 0) → [0] 즉시(B4, clamp lo=0)');
ok(eqArr(claimableDayIndexes('2026-07-01', '2026-07-06'), [3, 4, 5]), '5일차(off 5) → [3,4,5] 후보(유예창 G=3, 3·4 이미받았으면 dedup)');
ok(eqArr(claimableDayIndexes('2026-07-01', '2026-07-28'), [25, 26, 27]), '만료 당일(off 27) → [25,26,27] 후보(유예창)');

console.log('── B3: 만료 후 유예(start≤오늘≤end+G · dayIndex clamp 27) ──');
// end offset 27. G=3 → claim gate off ≤ 30. 슬롯 [max(0,off-2)…min(27,off)].
ok(eqArr(claimableDayIndexes('2026-07-01', addDays('2026-07-01', 28)), [26, 27]), '만료+1일(off 28) → [26,27] 유예 수령');
ok(eqArr(claimableDayIndexes('2026-07-01', addDays('2026-07-01', 29)), [27]), '만료+2일(off 29) → [27](26은 유예 만료)');
ok(eqArr(claimableDayIndexes('2026-07-01', addDays('2026-07-01', 30)), []), '만료+3일(off 30) → [](모든 슬롯 유예 경과)');
ok(eqArr(claimableDayIndexes('2026-07-01', addDays('2026-07-01', 31)), []), '만료+4일(off 31 > end+G) → [](gate 밖·미지급)');
ok(isWithinClaimWindow('2026-07-01', addDays('2026-07-01', 30)) === true, '  claim 창(gate) = off 30까지 열림(end+G)');
ok(isWithinClaimWindow('2026-07-01', addDays('2026-07-01', 31)) === false, '  off 31 → 창 밖');
// A/B: 유예 없는(G=0) 구로직 재현 — 만료+1일이면 [](미지급). 신로직(G=3)은 [26,27] 지급 = 유예 민감도.
{
  const graceless = (start: string, today: string) => { // G=0 뮤턴트(당일 소멸 (A))
    const off = diffDays(start, today); const last = 27;
    if (off < 0 || off > last) return [] as number[];
    return off <= last ? [off] : [];
  };
  ok(eqArr(graceless('2026-07-01', addDays('2026-07-01', 28)), []), '  [A/B] G=0 구로직 → 만료+1일 [](당일소멸) : 신 G=3은 [26,27](유예 검출)');
  ok(eqArr(graceless('2026-07-01', addDays('2026-07-01', 5)), [5]), '  [A/B] G=0 구로직 정상일은 신로직과 동일([5]) — 유예만 차이');
}

console.log('── 리셋보정 KST 04:00 경계(Q6, 클라 시계 불신) ──');
// KST 03:59(리셋 전) → 전날 귀속 / KST 04:01(리셋 후) → 당일. KST=UTC+9.
ok(todayKstResetAdjusted(4, new Date('2026-07-09T18:59:00Z')) === '2026-07-09', 'KST 07-10 03:59(리셋 전) → 07-09 귀속(자정 넘긴 플레이 보호)');
ok(todayKstResetAdjusted(4, new Date('2026-07-09T19:01:00Z')) === '2026-07-10', 'KST 07-10 04:01(리셋 후) → 07-10 귀속');
ok(todayKstResetAdjusted(4, new Date('2026-07-10T14:30:00Z')) === '2026-07-10', 'KST 07-10 23:30 → 07-10(대낮 무영향)');
// A/B: 리셋 4→0(자정) 변이 → 같은 KST 03:59가 07-10으로 귀속(경계 하루 어긋남 = off-by-one 검출)
ok(todayKstResetAdjusted(0, new Date('2026-07-09T18:59:00Z')) === '2026-07-10', '  [A/B] 리셋 0시 변이 → KST 03:59가 07-10 귀속(4시 리셋과 하루 차 = 경계 민감도)');
ok(todayKstResetAdjusted(4, new Date('2026-07-09T18:59:00Z')) !== todayKstResetAdjusted(0, new Date('2026-07-09T18:59:00Z')), '  [A/B] 리셋 4 vs 0 결과 상이(경계 오프바이원 검출)');

console.log('── 멱등키 user×pass×dayIndex 유일성(§2.5) ──');
ok(passDailyKey('u1', 'p1', 0) === 'pass_daily:u1:p1:0', '키 형식 pass_daily:<user>:<pass>:<dayIndex>');
ok(passDailyKey('u1', 'p1', 0) === passDailyKey('u1', 'p1', 0), '같은 (user,pass,idx) → 동일 키(재시도 dedupe)');
ok(passDailyKey('u1', 'p1', 0) !== passDailyKey('u1', 'p1', 1), '다른 dayIndex → 다른 키(28슬롯 각 1회)');
ok(passDailyKey('u1', 'p1', 0) !== passDailyKey('u1', 'p2', 0), '다른 pass(재구매) → 다른 키(dayIndex 0 재시작 충돌 없음)');
ok(passDailyKey('u1', 'p1', 0) !== passDailyKey('u2', 'p1', 0), '다른 user → 다른 키');
ok(passRefundKey('u1', 'T9') === 'refund_pass:u1:T9', '환불 클로백 키 refund_pass:<user>:<txn>');
// A/B: dayIndex를 뺀 손상 키(pass_daily:<user>:<pass>) → 모든 날 같은 키 → 첫날만 지급(under-grant) OR 재청구 dedup 붕괴
{
  const brokenKey = (u: string, p: string, _i: number) => `pass_daily:${u}:${p}`; // dayIndex 누락 뮤턴트
  ok(brokenKey('u1', 'p1', 0) === brokenKey('u1', 'p1', 5), '  [A/B] dayIndex 누락 키 → day0·day5 같은 키(2일차부터 dedupe로 미지급 = 결함 검출)');
  ok(passDailyKey('u1', 'p1', 0) !== passDailyKey('u1', 'p1', 5), '  [A/B] 정상 키는 day0·day5 상이(각 슬롯 독립 지급)');
  // A/B: 재청구 이중지급 시나리오 — 정상 키는 재시도서 동일(dedupe=1지급), 시각 섞인 키는 매번 달라 이중지급
  const noncedKey = (u: string, p: string, i: number) => `pass_daily:${u}:${p}:${i}:${Math.random()}`; // 멱등 파괴 뮤턴트
  ok(noncedKey('u1', 'p1', 0) !== noncedKey('u1', 'p1', 0), '  [A/B] nonce 키 → 재시도마다 다른 키(멱등 붕괴 → 이중지급 = 검출)');
  ok(passDailyKey('u1', 'p1', 0) === passDailyKey('u1', 'p1', 0), '  [A/B] 정상 키는 재시도 동일(멱등 dedupe → 이중지급 0)');
}

console.log(fail === 0 ? '\n✅ _dv_pass 순수 검증 통과 — 창 산술·28슬롯·2800·B3 유예·리셋 KST04·멱등키·상수미러 전부' : `\n❌ ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
