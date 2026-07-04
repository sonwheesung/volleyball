// 한글 어절 keep-all 순수 헬퍼 가드(UI_RULES — char-break 수정, 2026-07-04). `npx tsx tools/_dv_keepall.ts`
// keepAllHangul: 인접 두 한글 음절 사이에만 WORD JOINER(U+2060) 삽입, 그 외 경계 불변.
import { keepAllHangul } from '../lib/koreanLineBreak';

const WJ = '⁠';
let fail = 0;
const ok = (c: boolean, msg: string) => { if (!c) { console.error('  ✗ ' + msg); fail++; } else console.log('  ✓ ' + msg); };
const countWJ = (s: string) => (s.match(/⁠/g) ?? []).length;

console.log('[1] 한글 음절 사이 삽입');
{
  const out = keepAllHangul('구단주입니다');
  ok(out === '구' + WJ + '단' + WJ + '주' + WJ + '입' + WJ + '니' + WJ + '다', '구단주입니다 → 음절마다 WJ(5개): ' + JSON.stringify(out));
  ok(out.replace(/⁠/g, '') === '구단주입니다', 'WJ 제거하면 원문 복원(가시 문자 불변)');
}

console.log('[2] 공백·라틴·숫자·문장부호 경계는 불변(줄바꿈은 어절 경계에서만)');
{
  ok(countWJ(keepAllHangul('가 나')) === 0, '공백 사이 WJ 없음(어절 경계 유지): "가 나"');
  ok(keepAllHangul('AB') === 'AB', '라틴 사이 불변: AB');
  ok(keepAllHangul('12') === '12', '숫자 사이 불변: 12');
  ok(keepAllHangul('우승·시상') === '우' + WJ + '승' + '·' + '시' + WJ + '상', '가운뎃점(·) 경계엔 WJ 없음, 한글쌍(우승/시상)엔 삽입: 우승·시상');
  ok(keepAllHangul('다릅니다.') === '다' + WJ + '릅' + WJ + '니' + WJ + '다.', '문장 끝 마침표는 한글 아님 → 그 앞엔 WJ 없음');
  ok(keepAllHangul('A가') === 'A가', '라틴↔한글 경계 불변(둘 다 한글 아님)');
}

console.log('[3] 이모지·grapheme 안전(분해 금지)');
{
  const fam = '👨‍👩‍👧'; // ZWJ 가족 이모지
  ok(keepAllHangul(fam) === fam, '가족 이모지(ZWJ 시퀀스) 불변');
  ok(keepAllHangul('가🏐나') === '가🏐나', '한글-이모지-한글: 이모지 양옆 WJ 없음(한글 인접 아님)');
  const flag = '🇰🇷';
  ok(keepAllHangul(flag) === flag, '국기 이모지(서로게이트쌍) 불변');
}

console.log('[4] 멱등성(두 번 적용해도 WJ 증가 없음)');
{
  const once = keepAllHangul('선수단');
  const twice = keepAllHangul(once);
  ok(once === twice, '2회 적용 == 1회 적용(WJ↔한글 사이 재삽입 없음)');
}

console.log('[5] A/B 민감도(오라클이 진짜 잡는가 — 허위 오라클 차단)');
{
  const raw = '보는게임'; // 4음절 → 인접쌍 3개 → WJ 3개
  const patched = keepAllHangul(raw);
  ok(countWJ(raw) === 0 && countWJ(patched) === 3, 'raw 0개 vs patched 3개 — 변형을 실제로 검출(민감)');
  ok(raw.length + 3 === patched.length, '길이 정확히 +3(삽입 개수 = 음절수-1)');
}

console.log('[6] 엣지(빈/1글자/공백만)');
{
  ok(keepAllHangul('') === '', '빈 문자열');
  ok(keepAllHangul('가') === '가', '1글자(삽입 없음)');
  ok(keepAllHangul('   ') === '   ', '공백만');
}

console.log(fail === 0 ? '\nPASS (전체 통과)' : `\nFAIL (${fail}건)`);
process.exit(fail === 0 ? 0 : 1);
