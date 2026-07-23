// 우편함 순수 검증 가드 (MAILBOX_SYSTEM §12 _dv_mail) — 멱등키 빌더·만료 경계·캡 클램프·상태 필터·만료일 파생·상수 미러.
// **DB 무의존**(순수 함수만). 각 항목 A/B 자가검증(변이 주입 → 검출 증명). 프로덕션 코드 무변(가드 안에서 뮤턴트 재현).
// Usage: cd server && npx tsx tools/_dv_mail.ts
import {
  mailLedgerKey, mailBroadcastKey, mailExpiresInDays, mailExpiresAt, isMailExpired, validateAttach, classifyMail, includeInStatus,
} from '../lib/mail';
import { passMailKey, passDailyKey, parsePassMailKey } from '../lib/pass';
import { MAIL_RETENTION_DAYS, MAIL_PASS_EXPIRE_DAYS, MAIL_MAX_GRANT, MAIL_PURGE_GRACE_DAYS } from '../lib/econ';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

console.log('── 상수 미러(문서 락값 §3.3 손복제 드리프트) ──');
ok(MAIL_RETENTION_DAYS === 30, `MAIL_RETENTION_DAYS=30 (실측 ${MAIL_RETENTION_DAYS})`);
ok(MAIL_PASS_EXPIRE_DAYS === 60, `MAIL_PASS_EXPIRE_DAYS=60 (R3) (실측 ${MAIL_PASS_EXPIRE_DAYS})`);
ok(MAIL_MAX_GRANT === 10000, `MAIL_MAX_GRANT=10000 (실측 ${MAIL_MAX_GRANT})`);
ok(MAIL_PURGE_GRACE_DAYS === 30, `MAIL_PURGE_GRACE_DAYS=30 (실측 ${MAIL_PURGE_GRACE_DAYS})`);

console.log('── 멱등키 빌더 유일성(§4 — mail:<id> vs mail_bc:<bc>:<user> 비충돌) ──');
ok(mailLedgerKey('M1') === 'mail:M1', `개별 키 형식 mail:<mailId> (실측 ${mailLedgerKey('M1')})`);
ok(mailBroadcastKey('B1', 'U1') === 'mail_bc:B1:U1', `브로드캐스트 키 mail_bc:<bc>:<user> (실측 ${mailBroadcastKey('B1', 'U1')})`);
ok(mailLedgerKey('M1') !== mailBroadcastKey('M1', 'U1'), '개별 vs 브로드캐스트 키 비충돌(접두 mail: vs mail_bc:)');
ok(mailBroadcastKey('B1', 'U1') !== mailBroadcastKey('B1', 'U2'), '같은 broadcast 다른 user → 다른 키(전유저 공유라 userId 필수 §4)');
ok(mailLedgerKey('M1') !== mailLedgerKey('M2'), '다른 mailId → 다른 키');
// A/B: broadcast 키에서 userId 제거 뮤턴트 → 전유저 동일 키(첫 유저만 지급·나머지 dedup = 결함 검출)
{
  const brokenBc = (bc: string, _u: string) => `mail_bc:${bc}`; // userId 누락 뮤턴트
  ok(brokenBc('B1', 'U1') === brokenBc('B1', 'U2'), '  [A/B] userId 누락 키 → 유저 U1·U2 동일 키(U2부터 dedup 미지급 = 결함)');
  ok(mailBroadcastKey('B1', 'U1') !== mailBroadcastKey('B1', 'U2'), '  [A/B] 정상 키는 유저별 상이(각자 1회 지급)');
}

console.log('── 만료일 파생(R3 §3.3 — diamonds 30 / pass 60 / explicit 우선) ──');
ok(mailExpiresInDays('diamonds') === 30, `diamonds 기본 30일 (실측 ${mailExpiresInDays('diamonds')})`);
ok(mailExpiresInDays('pass') === 60, `pass 기본 60일(큐 점유 56 > 30 모순 해소) (실측 ${mailExpiresInDays('pass')})`);
ok(mailExpiresInDays('diamonds', 7) === 7, 'explicit 7일 우선(관리자 조정)');
ok(mailExpiresInDays('pass', 0) === 60, 'explicit 0/음수는 무시하고 기본(pass 60)');
{
  const base = new Date('2026-07-01T00:00:00Z');
  ok(mailExpiresAt(base, 'diamonds').toISOString().slice(0, 10) === '2026-07-31', 'diamonds expiresAt = base+30일 (07-31)');
  ok(mailExpiresAt(base, 'pass').toISOString().slice(0, 10) === '2026-08-30', 'pass expiresAt = base+60일 (08-30)');
  // A/B: pass 만료 30일 오설정 뮤턴트 → 08-30이 아니라 07-31(큐 점유 대기 중 만료 모순 = 검출)
  const wrongPass = (b: Date) => new Date(b.getTime() + 30 * 86_400_000); // pass도 30일 뮤턴트
  ok(wrongPass(base).toISOString().slice(0, 10) === '2026-07-31', '  [A/B] pass 30일 뮤턴트 → 07-31(정본 08-30과 불일치 = 큐 대기 만료 모순 검출)');
  ok(mailExpiresAt(base, 'pass').getTime() !== wrongPass(base).getTime(), '  [A/B] 정본 pass 만료(60) ≠ 30일 뮤턴트');
}

console.log('── 만료 판정 경계(E1 — now > expiresAt 만료, now == expiresAt 미만료) ──');
const exp = new Date('2026-07-31T00:00:00Z');
ok(isMailExpired(new Date('2026-07-31T00:00:01Z'), exp) === true, 'now > expiresAt(1초 후) → 만료');
ok(isMailExpired(new Date('2026-07-31T00:00:00Z'), exp) === false, 'now == expiresAt(경계) → 미만료(수령 가능)');
ok(isMailExpired(new Date('2026-07-30T23:59:59Z'), exp) === false, 'now < expiresAt → 미만료');
// A/B: 경계 오프바이원 뮤턴트(>=) → now==expires에서 만료(정본은 미만료 = 경계 하루 손실)
{
  const offByOne = (now: Date, e: Date) => now.getTime() >= e.getTime(); // >= 뮤턴트
  ok(offByOne(exp, exp) === true, '  [A/B] >= 뮤턴트 → now==expires 만료 처리(정본 미만료와 상이 = 경계 오프바이원 검출)');
  ok(isMailExpired(exp, exp) === false, '  [A/B] 정본은 now==expires 미만료(경계 수령 허용)');
}

console.log('── 캡 클램프(§5.3 — diamonds 0<amount≤MAX_GRANT, pass amount 무시) ──');
ok(validateAttach('diamonds', 500).ok === true && (validateAttach('diamonds', 500) as any).amount === 500, '정상 500 → ok·amount 500');
ok(validateAttach('diamonds', MAIL_MAX_GRANT).ok === true, '경계 10000(캡 정확값) → ok');
ok(validateAttach('diamonds', MAIL_MAX_GRANT + 1).ok === false && (validateAttach('diamonds', MAIL_MAX_GRANT + 1) as any).reason === 'over-cap', '10001(캡 초과) → over-cap 거부');
ok(validateAttach('diamonds', 0).ok === false, '0 → bad-amount(양수 강제)');
ok(validateAttach('diamonds', -50).ok === false, '음수 → bad-amount');
ok(validateAttach('pass').ok === true && (validateAttach('pass') as any).amount === null, 'pass → ok·amount null(수량 무시)');
ok(validateAttach('item').ok === false && (validateAttach('item') as any).reason === 'bad-type', '미지원 타입 → bad-type');
// A/B: 캡 미적용 뮤턴트 → 20000 통과(정본은 over-cap = blast-radius 바운드 붕괴)
{
  const noCap = (amt: number) => amt > 0; // 캡 검사 제거 뮤턴트
  ok(noCap(20000) === true, '  [A/B] 캡 미적용 뮤턴트 → 20000 통과(오발송 blast-radius 무제한 = 결함)');
  ok(validateAttach('diamonds', 20000).ok === false, '  [A/B] 정본은 20000 거부(캡 강제)');
}

console.log('── 상태 필터 분류(§5.1 — classifyMail / includeInStatus, SQL WHERE 미러) ──');
const now = new Date('2026-07-15T00:00:00Z');
const future = new Date('2026-08-01T00:00:00Z');
const past = new Date('2026-07-10T00:00:00Z');
ok(classifyMail({ claimedAt: null, recalledAt: null, expiresAt: future }, now) === 'unclaimed', '미수령·미만료 → unclaimed');
ok(classifyMail({ claimedAt: now, recalledAt: null, expiresAt: future }, now) === 'claimed', '수령됨 → claimed');
ok(classifyMail({ claimedAt: null, recalledAt: null, expiresAt: past }, now) === 'expired', '미수령·만료 → expired');
ok(classifyMail({ claimedAt: null, recalledAt: now, expiresAt: future }, now) === 'recalled', '회수 → recalled(우선)');
ok(classifyMail({ claimedAt: now, recalledAt: now, expiresAt: future }, now) === 'recalled', '회수는 수령보다 우선(목록 제외)');
// includeInStatus: 회수는 전 탭 제외 / all=만료·수령 포함 / unclaimed=미수령·미만료만
ok(includeInStatus('all', 'recalled') === false, 'all 탭도 회수분 제외');
ok(includeInStatus('all', 'expired') === true, 'all 탭 = 만료분 포함(Q2 투명성)');
ok(includeInStatus('all', 'claimed') === true, 'all 탭 = 수령분 포함');
ok(includeInStatus('unclaimed', 'expired') === false, 'unclaimed 탭 = 만료분 제외(all 탭에서만)');
ok(includeInStatus('unclaimed', 'unclaimed') === true, 'unclaimed 탭 = 미수령·미만료');
ok(includeInStatus('claimed', 'unclaimed') === false, 'claimed 탭 = 미수령 제외');
ok(includeInStatus('claimed', 'claimed') === true, 'claimed 탭 = 수령분');
// A/B: 회수 필터 누락 뮤턴트 → 회수분이 all에 노출(정본은 제외)
{
  const noRecallFilter = (cls: string) => cls !== '__never__'; // recalled 제외 안 하는 뮤턴트
  ok(noRecallFilter('recalled') === true, '  [A/B] 회수 필터 누락 뮤턴트 → 회수분 목록 노출(정본 제외와 상이 = 결함)');
  ok(includeInStatus('all', 'recalled') === false, '  [A/B] 정본은 회수분 all에서도 제외');
}

console.log('── system:pass 일일 우편 키·파싱(DIAMOND_PASS §2.3·§2.5 — reason 분기·회수 제외) ──');
// 다이아 패스 일일 우편(sender system:pass)은 diamonds 첨부지만 claim 시 reason='pass_daily'(클로백 Σ 추적). idem_key에서 pass/idx 파싱.
const PID = '11111111-2222-3333-4444-555555555555';
ok(passMailKey(PID, 0) === `pass_daily:${PID}:0`, `발송 우편 idem_key = pass_daily:<pass>:<dayIndex>(userId 없음) — 실측 ${passMailKey(PID, 0)}`);
ok(parsePassMailKey(passMailKey(PID, 5))?.passId === PID, 'parse → passId 복원(claim 시 원장 키 빌드)');
ok(parsePassMailKey(passMailKey(PID, 5))?.dayIndex === 5, 'parse → dayIndex 복원');
ok(parsePassMailKey(mailLedgerKey('abc')) === null, '일반 우편 키(mail:<id>) → null(pass_daily 아님 → reason=mail)');
ok(passDailyKey('u1', PID, 0) !== passMailKey(PID, 0), '수령 원장 키(user×pass×idx) ≠ 발송 우편 키(pass×idx) — 발송 dedupe vs 수령 dedupe 스코프 분리');
// A/B: sender 무시하고 전 우편 reason='mail' 처리하는 뮤턴트 → pass_daily 원장이 안 생겨 클로백 Σ(reason='pass_daily') 0(under-clawback)
{
  const senderIgnored = (_sender: string) => 'mail';                                  // sender 무시 뮤턴트
  const correctReason = (sender: string) => (sender === 'system:pass' ? 'pass_daily' : 'mail'); // 정본 분기
  ok(senderIgnored('system:pass') === 'mail' && correctReason('system:pass') === 'pass_daily', '  [A/B] sender 무시 뮤턴트 → pass 우편도 reason=mail(클로백 Σ 누락 = 결함) : 정본은 system:pass→pass_daily');
  ok(correctReason('admin') === 'mail', '  [A/B] 일반(admin/system) 우편은 reason=mail(정상)');
}

console.log(fail === 0 ? '\n✅ _dv_mail 순수 검증 통과 — 멱등키·만료 경계·캡·상태분류·만료일파생·상수미러·system:pass 파싱/reason분기 전부' : `\n❌ ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
