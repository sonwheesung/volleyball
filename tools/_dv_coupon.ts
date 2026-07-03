// 쿠폰·관리자 순수 로직 가드 (BACKEND_SYSTEM §13.14/§13.15) — normalizeCode + requireAdmin fail-closed.
// 서버 왕복(발급·사용·이중지급0·타겟·만료)은 로컬 서버 라이브 E2E(임시 스크립트, 검증 후 삭제)가 실증.
import { normalizeCode } from '../server/lib/coupon';
import { isAdmin } from '../server/lib/admin';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
const mkReq = (auth?: string): Request => ({ headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? auth ?? null : null) } } as unknown as Request);

console.log('── 쿠폰 코드 정규화(대문자+trim) ──');
ok(normalizeCode('  abc123 ') === 'ABC123', '공백 trim + 대문자');
ok(normalizeCode('Launch100') === 'LAUNCH100', '대소문자 정규화');
ok(normalizeCode('') === '', '빈 코드 → 빈 문자열');
ok(normalizeCode(undefined as unknown as string) === '', 'undefined 안전 처리');

console.log('── requireAdmin fail-closed(§13.15 P0-B) ──');
process.env.ADMIN_TOKEN = '';
ok(!isAdmin(mkReq('Bearer anything-you-want-here')), '토큰 미설정 → 전면 거부(fail-closed, env 누락=무방비 아님)');
process.env.ADMIN_TOKEN = 'short-token';
ok(!isAdmin(mkReq('Bearer short-token')), '토큰 <16자 → 거부(약한 토큰 차단)');
const TOKEN = 'valid-admin-token-1234'; // 22자
process.env.ADMIN_TOKEN = TOKEN;
ok(isAdmin(mkReq('Bearer ' + TOKEN)), '정확 토큰(≥16) → 허용');
ok(!isAdmin(mkReq('Bearer wrong-admin-token-1234')), '틀린 토큰(같은 길이) → 거부');
ok(!isAdmin(mkReq('Bearer ' + TOKEN + 'x')), '길이 다른 토큰 → 거부(timingSafeEqual 길이 가드)');
ok(!isAdmin(mkReq()), '헤더 없음 → 거부');
ok(!isAdmin(mkReq(TOKEN)), 'Bearer 접두 없음 → 거부');

console.log(fail === 0 ? '\n✅ PASS _dv_coupon (순수 정규화·admin fail-closed)' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
