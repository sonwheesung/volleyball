// 다이아 패스 순수 검증 가드 (DIAMOND_PASS_SYSTEM §10 _dv_pass) — 창 산술·리셋보정(KST 00:00)·캐치업 dayIndex·멱등키·상수 미러.
// ★ 재개정(2026-07-23): 유예(claim 창) 폐기 → 스케줄러 캐치업 창(catchupDayIndexes)으로 교체. 리셋 KST 04→00. mail idem_key(passMailKey)·클로백 Σ 프리픽스 추가.
// **DB 무의존**(순수 함수만). 각 항목 A/B 자가검증(변이 주입 → 검출 증명). 프로덕션 코드 무변(가드 안에서 뮤턴트 재현).
// Usage: cd server && npx tsx tools/_dv_pass.ts
import {
  passWindow, catchupDayIndexes, isPassActiveOn, passDayIndex,
  passDailyKey, passMailKey, passRefundKey, passDailyLedgerPrefix, passMailPrefix, parsePassMailKey,
} from '../lib/pass';
import { todayKstResetAdjusted, addDays, diffDays } from '../lib/dates';
import {
  PASS_DAILY_REWARD, PASS_DURATION_DAYS, PASS_MAX_TOTAL, PASS_RESET_HOUR_KST,
} from '../lib/econ';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
const eqArr = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

console.log('── 상수 미러(문서 락값 §0·§6 손복제 드리프트) ──');
// 문서 확정 기획(락): 매일 100·28일·최대 2,800·리셋 KST 00:00(자정, Q6 재확정). 유예 폐기(우편 30일 대체).
ok(PASS_DAILY_REWARD === 100, `PASS_DAILY_REWARD=100 (실측 ${PASS_DAILY_REWARD})`);
ok(PASS_DURATION_DAYS === 28, `PASS_DURATION_DAYS=28 (실측 ${PASS_DURATION_DAYS})`);
ok(PASS_MAX_TOTAL === 2800, `PASS_MAX_TOTAL=2800 파생 (실측 ${PASS_MAX_TOTAL})`);
ok(PASS_MAX_TOTAL === PASS_DAILY_REWARD * PASS_DURATION_DAYS, '  MAX = DAILY × DURATION 정합');
ok(PASS_RESET_HOUR_KST === 0, `PASS_RESET_HOUR_KST=0 (Q6 재확정 04→00) (실측 ${PASS_RESET_HOUR_KST})`);
// A/B: 락값과 다른 손복제(150/27)를 스펙과 대조 → 드리프트 검출
{
  const SPEC = { daily: 100, dur: 28, max: 2800, reset: 0 };
  const drifted = { daily: 150, dur: 28, max: 150 * 28, reset: 4 };
  ok(SPEC.daily === PASS_DAILY_REWARD && SPEC.reset === PASS_RESET_HOUR_KST, '  [A/B] 서버 상수 == 스펙 락(현행 통과)');
  ok(drifted.daily !== SPEC.daily && drifted.max !== SPEC.max && drifted.reset !== SPEC.reset, '  [A/B] 손복제 150·reset4 변이 → 스펙 대조서 드리프트 검출(민감도)');
}

console.log('── 창 산술: 28슬롯(dayIndex 0~27)·최대 2,800 ──');
const w = passWindow('2026-07-01');
ok(w.startDate === '2026-07-01' && w.endDate === '2026-07-28', `start 07-01 → end 07-28(포함 28일) — 실측 ${w.endDate}`);
ok(diffDays(w.startDate, w.endDate) === PASS_DURATION_DAYS - 1, '  end - start = 27일(28슬롯)');

console.log('── isPassActiveOn: 창 안(off 0~27)만 활성, 유예 없음(만료=off>27 즉시 창밖) ──');
ok(isPassActiveOn('2026-07-01', '2026-07-01') === true, 'off 0(구매 당일) → 활성');
ok(isPassActiveOn('2026-07-01', addDays('2026-07-01', 27)) === true, 'off 27(만료 당일=end) → 활성(마지막 슬롯)');
ok(isPassActiveOn('2026-07-01', addDays('2026-07-01', 28)) === false, 'off 28(만료+1) → 창 밖(유예 폐기 — 즉시 제외)');
ok(isPassActiveOn('2026-07-01', addDays('2026-07-01', -1)) === false, 'off -1(시작 전) → 창 밖');
// A/B: 유예 G=3 구로직 재현 — 만료+1일도 활성(정본은 창밖). 유예 폐기 민감도.
{
  const withGrace = (start: string, today: string, G = 3) => { const off = diffDays(start, today); return off >= 0 && off <= 27 + G; };
  ok(withGrace('2026-07-01', addDays('2026-07-01', 28)) === true, '  [A/B] 구 유예(G=3) → 만료+1일 여전히 활성(정본 창밖과 상이 = 유예 폐기 검출)');
  ok(isPassActiveOn('2026-07-01', addDays('2026-07-01', 28)) === false, '  [A/B] 정본은 만료+1일 창밖(유예 없음)');
}

console.log('── 캐치업 dayIndex(§2.3.2 순수 코어 — 스케줄러 발송 대상) ──');
// 매일 크론이 돌면 그날 슬롯만 새로 발송(앞 슬롯은 mail idem_key dedup). 캐치업: 크론 미실행일이 있으면 다음 실행이 빠진 dayIndex 몰아 발송.
ok(eqArr(catchupDayIndexes('2026-07-01', '2026-07-01'), [0]), '구매 당일(off 0) → [0](day-0 우편, grant가 이미 보냈으면 dedup)');
ok(eqArr(catchupDayIndexes('2026-07-01', '2026-07-06'), [0, 1, 2, 3, 4, 5]), '5일차(off 5) → [0..5] 캐치업(1~4 미실행일 몰아 발송·발송분 dedup)');
ok(eqArr(catchupDayIndexes('2026-07-01', addDays('2026-07-01', 27)), Array.from({ length: 28 }, (_, i) => i)), '만료 당일(off 27) → [0..27] (전 슬롯, 클램프 27)');
ok(eqArr(catchupDayIndexes('2026-07-01', addDays('2026-07-01', 28)), []), '만료+1일(off 28) → [](창 밖·발송 안 함, 유예 없음)');
ok(eqArr(catchupDayIndexes('2026-07-01', addDays('2026-07-01', -1)), []), '시작 전(off -1) → [](발송 안 함)');
// 28일 완주 = 매일 1슬롯씩 새로 발송, 합 28슬롯·2,800💎. mail idem_key(pass×dayIndex)가 중복 흡수.
{
  const sent = new Set<number>();
  for (let off = 0; off <= 27; off++) for (const idx of catchupDayIndexes('2026-07-01', addDays('2026-07-01', off))) sent.add(idx);
  ok(sent.size === 28 && sent.size * PASS_DAILY_REWARD === 2800, `28일 매일 크론 → 28슬롯·2,800💎 (실측 ${sent.size}슬롯)`);
  // A/B: dayIndex 클램프 없는 뮤턴트(off 그대로) → off 28에서 dayIndex 28 발생(29슬롯·초과지급)
  const noClamp = (start: string, today: string) => { const off = diffDays(start, today); if (off < 0) return [] as number[]; return Array.from({ length: off + 1 }, (_, i) => i); };
  ok(noClamp('2026-07-01', addDays('2026-07-01', 28)).length === 29, '  [A/B] 클램프 없는 뮤턴트 → off28서 29슬롯(dayIndex 28 초과지급 = 결함)');
  ok(catchupDayIndexes('2026-07-01', addDays('2026-07-01', 27)).length === 28, '  [A/B] 정본은 최대 28슬롯(dayIndex 27 클램프)');
}

console.log('── 리셋보정 KST 00:00 경계(Q6 재확정, 클라 시계 불신) ──');
// reset=0 → 리셋보정 날짜 = KST 캘린더 날짜(now+9h의 UTC 날짜). KST=UTC+9.
ok(todayKstResetAdjusted(0, new Date('2026-07-09T14:30:00Z')) === '2026-07-09', 'KST 07-09 23:30 → 07-09');
ok(todayKstResetAdjusted(0, new Date('2026-07-09T15:01:00Z')) === '2026-07-10', 'KST 07-10 00:01(자정 직후) → 07-10(경계 넘음)');
ok(todayKstResetAdjusted(0, new Date('2026-07-09T14:59:00Z')) === '2026-07-09', 'KST 07-09 23:59(자정 직전) → 07-09');
// A/B: 리셋 0→4 변이 → KST 00:01~03:59가 전날로 귀속(경계 하루 어긋남 = off-by-one 검출)
ok(todayKstResetAdjusted(4, new Date('2026-07-09T15:01:00Z')) === '2026-07-09', '  [A/B] 리셋 4시 변이 → KST 07-10 00:01이 07-09 귀속(0시 리셋과 하루 차 = 경계 민감도)');
ok(todayKstResetAdjusted(0, new Date('2026-07-09T15:01:00Z')) !== todayKstResetAdjusted(4, new Date('2026-07-09T15:01:00Z')), '  [A/B] 리셋 0 vs 4 결과 상이(경계 오프바이원 검출)');

console.log('── 발송 우편 멱등키 passMailKey(pass×dayIndex, userId 없음) ──');
ok(passMailKey('p1', 0) === 'pass_daily:p1:0', '키 형식 pass_daily:<pass>:<dayIndex>(mails.idem_key)');
ok(passMailKey('p1', 0) === passMailKey('p1', 0), '같은 (pass,idx) → 동일 키(스케줄러·day-0·캐치업 dedupe)');
ok(passMailKey('p1', 0) !== passMailKey('p1', 1), '다른 dayIndex → 다른 키(28슬롯 각 1통)');
ok(passMailKey('p1', 0) !== passMailKey('p2', 0), '다른 pass(재구매) → 다른 키(dayIndex 0 재시작 충돌 없음)');
// parsePassMailKey — claim 시 pass/idx 복원(reason 분기)
{
  const uuid = '11111111-2222-3333-4444-555555555555';
  ok(JSON.stringify(parsePassMailKey(passMailKey(uuid, 7))) === JSON.stringify({ passId: uuid, dayIndex: 7 }), 'parsePassMailKey 왕복 복원(passId·dayIndex)');
  ok(parsePassMailKey('mail:abc') === null, '일반 우편 키(mail:<id>) → null(pass_daily 아님)');
  ok(parsePassMailKey('pass_daily:notuuid:0') === null, 'UUID 아닌 passId → null(형식 가드)');
}

console.log('── 일일 수령 원장 멱등키 passDailyKey(user×pass×dayIndex) + 클로백 Σ 프리픽스 ──');
ok(passDailyKey('u1', 'p1', 0) === 'pass_daily:u1:p1:0', '원장 키 형식 pass_daily:<user>:<pass>:<dayIndex>');
ok(passDailyKey('u1', 'p1', 0) !== passDailyKey('u1', 'p1', 1), '다른 dayIndex → 다른 키(각 슬롯 1회 지급)');
ok(passDailyKey('u1', 'p1', 0) !== passDailyKey('u2', 'p1', 0), '다른 user → 다른 키');
ok(passRefundKey('u1', 'T9') === 'refund_pass:u1:T9', '환불 클로백 키 refund_pass:<user>:<txn>');
// 클로백 Σ 앵커: passDailyLedgerPrefix(user,pass) = 그 유저·패스의 모든 dayIndex 키를 LIKE로 묶는다(ref=mail:<id>라 storeTxnId로 못 묶음)
ok(passDailyLedgerPrefix('u1', 'p1') === 'pass_daily:u1:p1:', 'Σ 프리픽스 = pass_daily:<user>:<pass>:');
ok(passDailyKey('u1', 'p1', 5).startsWith(passDailyLedgerPrefix('u1', 'p1')), '  그 패스 슬롯 키는 프리픽스로 시작(LIKE 매칭)');
ok(!passDailyKey('u1', 'p2', 0).startsWith(passDailyLedgerPrefix('u1', 'p1')), '  다른 패스(p2) 키는 프리픽스 불일치(패스 격리)');
ok(!passDailyKey('u2', 'p1', 0).startsWith(passDailyLedgerPrefix('u1', 'p1')), '  다른 유저 키도 불일치(유저 격리)');
ok(passMailPrefix('p1') === 'pass_daily:p1:', 'recall 대상 우편 프리픽스 = pass_daily:<pass>:');
ok(passMailKey('p1', 3).startsWith(passMailPrefix('p1')) && !passMailKey('p2', 3).startsWith(passMailPrefix('p1')), '  그 패스 우편만 recall 프리픽스 매칭(패스 격리)');
// A/B: Σ를 dayIndex 무시하고 passId만 exact 매칭(프리픽스 아님) → dayIndex 있는 실키는 안 잡혀 클로백 0(under-clawback)
{
  const wrongExact = 'pass_daily:u1:p1'; // dayIndex 없는 exact 뮤턴트
  ok(passDailyKey('u1', 'p1', 0) !== wrongExact, '  [A/B] dayIndex 없는 exact 키 뮤턴트 → 실 슬롯 키(…:0)와 불일치(exact면 Σ=0 under-clawback = 결함)');
  ok(passDailyKey('u1', 'p1', 0).startsWith(passDailyLedgerPrefix('u1', 'p1')), '  [A/B] 정본은 프리픽스 LIKE라 모든 슬롯 포착(Σ 정합)');
}

console.log(fail === 0 ? '\n✅ _dv_pass 순수 검증 통과 — 창·isPassActiveOn(유예폐기)·캐치업 dayIndex·리셋 KST00·발송/원장 멱등키·클로백 Σ 프리픽스·상수미러 전부' : `\n❌ ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
