// 버전 비교 가드 (BACKEND_SYSTEM §13.11/§13.16) — 순수: cmpVersion·belowVersion·needsSoftUpdate.
// 강제 게이트(min)·소프트 배너(latest) 판정의 근간. A/B로 "문자열 비교였다면 오답" 재현(정수 비교 증명).
import { cmpVersion, belowVersion, needsSoftUpdate } from '../lib/bootstrap';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

console.log('── cmpVersion(정수 비교) ──');
ok(cmpVersion('1.2.0', '1.2.0') === 0, '동일 = 0');
ok(cmpVersion('1.2.0', '1.3.0') < 0, '1.2.0 < 1.3.0');
ok(cmpVersion('1.10.0', '1.9.0') > 0, '1.10.0 > 1.9.0 (정수 — 문자열 아님)');
ok(cmpVersion('1.2', '1.2.0') === 0, '자리수 다름 보정(1.2 == 1.2.0)');
ok(cmpVersion('2.0.0', '1.9.9') > 0, 'major 우선');

console.log('── belowVersion(하드 게이트 근간) ──');
ok(belowVersion('1.2.0', '1.3.0'), '미만 → true');
ok(!belowVersion('1.3.0', '1.3.0'), '동일 → false');
ok(!belowVersion('1.4.0', '1.3.0'), '초과 → false');
ok(!belowVersion('1.3.0', null), 'target null → false(게이트 없음)');

console.log('── needsSoftUpdate(소프트 배너 §13.16) ──');
ok(needsSoftUpdate('1.2.0', { min: '1.0.0', latest: '1.3.0' }), 'latest 미만·min 이상 → 소프트 true');
ok(!needsSoftUpdate('1.0.0', { min: '1.2.0', latest: '1.3.0' }), 'min 미만(강제 대상) → 소프트 false(하드 게이트가 처리)');
ok(!needsSoftUpdate('1.3.0', { min: '1.0.0', latest: '1.3.0' }), '최신 = 소프트 false');
ok(!needsSoftUpdate('1.4.0', { min: '1.0.0', latest: '1.3.0' }), '최신보다 높음 → false');
ok(!needsSoftUpdate('1.2.0', { min: null, latest: null }), 'latest 없음 → false');
ok(needsSoftUpdate('1.2.0', { min: null, latest: '1.3.0' }), 'min 없음 + latest 미만 → true');

console.log('── A/B: 문자열 비교였다면 오답(정수 비교 증명) ──');
ok(cmpVersion('1.10.0', '1.9.0') > 0 && '1.10.0' < '1.9.0', "A/B: 문자열이면 '1.10'<'1.9'(오답) — cmpVersion은 정수라 1.10>1.9(정답)");

console.log(fail === 0 ? '\n✅ PASS _dv_version' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
