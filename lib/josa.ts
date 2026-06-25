// 한국어 조사 자동 선택 — 앞 단어 마지막 글자의 받침 유무로 이/가·을/를·은/는·와/과·으로/로 결정.
// 뉴스 기사 등 변수 이름(선수·팀)에 조사를 붙일 때 "이(가)" 병기 비문을 없앤다(NEWS_SYSTEM §4.5).
// 순수 함수. 한글은 종성 코드, 숫자는 발음, 영문은 모음끝 근사. 불명이면 안전하게 병기 폴백.

/** 마지막 글자에 받침이 있나 — true/false, 판정 불가면 null. */
export function hasBatchim(word: string): boolean | null {
  const s = word.trim();
  if (!s) return null;
  const ch = s.slice(-1);
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0; // 한글: 종성 있으면 받침
  if (/[0-9]$/.test(ch)) return ['0', '1', '3', '6', '7', '8'].includes(ch); // 발음: 영·일·삼·육·칠·팔 = 받침
  if (/[a-zA-Z]$/.test(ch)) return !/[aeiou]$/i.test(ch); // 영문: 모음끝=받침없음 근사
  return null;
}

/** word + (받침 있으면 withB / 없으면 withoutB). '으로'는 ㄹ받침 예외('로'). 불명이면 "withB(withoutB)" 병기. */
export function josa(word: string, withB: string, withoutB: string): string {
  const b = hasBatchim(word);
  if (b === null) return `${word}${withB}(${withoutB})`;
  if (withB === '으로') { // 으로/로 — ㄹ받침은 '로'
    const ch = word.trim().slice(-1).charCodeAt(0);
    if (ch >= 0xac00 && ch <= 0xd7a3 && (ch - 0xac00) % 28 === 8) return `${word}로`;
  }
  return `${word}${b ? withB : withoutB}`;
}

// 자주 쓰는 쌍 단축
export const eunNeun = (w: string) => josa(w, '은', '는');
export const iGa = (w: string) => josa(w, '이', '가');
export const eulReul = (w: string) => josa(w, '을', '를');
export const waGwa = (w: string) => josa(w, '과', '와');

// ─── 후처리: 완성된 문장의 조사 병기("코메츠이(가)")를 받침 기준 하나로 교정 ───
//   값이 정해진 이름·팀명에 "이(가)" 병기가 그대로 나오는 비문을 일괄 수리(NEWS push에서 헤드라인·본문에 적용).
//   "name(team)이(가)"처럼 괄호가 끼면 괄호를 건너뛴 앞 글자(=name 끝)로 판정.
const PAIRS: [RegExp, string, string][] = [
  [/이\(가\)/g, '이', '가'], [/을\(를\)/g, '을', '를'], [/은\(는\)/g, '은', '는'],
  [/과\(와\)/g, '과', '와'], [/와\(과\)/g, '과', '와'], [/으로\(로\)/g, '으로', '로'],
];
export function resolveJosa(text: string): string {
  let out = text;
  for (const [re, withB, withoutB] of PAIRS) {
    out = out.replace(re, (_m: string, offset: number, str: string) => {
      let i = offset - 1;
      if (str[i] === ')') { let d = 1; i--; while (i >= 0 && d > 0) { if (str[i] === ')') d++; else if (str[i] === '(') d--; i--; } } // 괄호 건너뜀
      const ch = i >= 0 ? str[i] : '';
      const b = hasBatchim(ch);
      if (b === null) return `${withB}(${withoutB})`; // 불명 → 병기 유지(안전)
      if (withB === '으로') { const code = ch.charCodeAt(0); if (code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 8) return '로'; }
      return b ? withB : withoutB;
    });
  }
  return out;
}
