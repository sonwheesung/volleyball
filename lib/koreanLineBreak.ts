// 한글 어절(단어) 단위 줄바꿈 — 웹 `word-break: keep-all` 격. (2026-07-04 실기기 검증으로 신설)
//
// 왜: Android 라인브레이커(ICU)는 한글 음절 사이를 **항상** 줄바꿈 가능 지점으로 본다(CJK 규칙).
//   `textBreakStrategy`('simple'/'highQuality'/'balanced')는 "어디서 끊을지 최적화"만 바꿀 뿐,
//   **음절 간 끊김 자체를 없애지 못한다** → 긴 문장이 `구단주입|니다`처럼 글자 단위로 쪼개졌다.
//   (구 fix `Text.defaultProps.textBreakStrategy='simple'`는 효과 없음이 실기기로 확인됨, EMULATOR_E2E 관찰메모1.)
// 어떻게: 인접한 **두 한글 음절 사이에만** WORD JOINER(U+2060, 제로폭·이 위치 줄바꿈 금지)를 넣는다.
//   → 한글 어절은 통짜로 유지되고 줄바꿈은 **공백(어절 경계)** 에서만 일어난다.
//   공백·문장부호(·,.)·이모지·라틴·숫자는 손대지 않아 그 경계 줄바꿈·이모지 grapheme은 그대로.

import type { ReactNode } from 'react';

const WJ = '⁠'; // WORD JOINER — 제로폭, 이 위치에서 줄바꿈 금지

function isHangul(cp: number): boolean {
  return (
    (cp >= 0xac00 && cp <= 0xd7a3) || // 완성형 음절 (가~힣)
    (cp >= 0x1100 && cp <= 0x11ff) || // 한글 자모
    (cp >= 0x3130 && cp <= 0x318f) || // 호환용 자모
    (cp >= 0xa960 && cp <= 0xa97f) || // 자모 확장-A
    (cp >= 0xd7b0 && cp <= 0xd7ff) //   자모 확장-B
  );
}

/** 인접한 두 한글 음절 사이에 WORD JOINER 삽입(그 외 문자 경계는 불변). 순수 함수 — 헤드리스 A/B 가드 대상. */
export function keepAllHangul(s: string): string {
  if (s.length < 2) return s;
  const chars = Array.from(s); // 코드포인트 안전(서로게이트/이모지 분해 방지)
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    out += chars[i];
    if (i + 1 < chars.length) {
      const a = chars[i].codePointAt(0);
      const b = chars[i + 1].codePointAt(0);
      if (a !== undefined && b !== undefined && isHangul(a) && isHangul(b)) out += WJ;
    }
  }
  return out;
}

/** Text 자식(문자열/배열/엘리먼트) 재귀 변환 — 문자열 리프에만 keep-all. 엘리먼트는 그대로(중첩 Text도 패치되어 재적용). */
function transform(node: ReactNode): ReactNode {
  if (typeof node === 'string') return keepAllHangul(node);
  if (Array.isArray(node)) return node.map(transform);
  return node; // 숫자·엘리먼트·null·boolean → 불변
}

/** JSX 런타임(jsx/jsxs/jsxDEV)을 감싸, `type === Text`인 엘리먼트의 문자열 자식에만 keep-all 적용.
 *  RN 0.81의 Text는 forwardRef(.render)가 아니라 함수형 컴포넌트 → 컴포넌트 자체 래핑 불가.
 *  대신 Metro가 `_runtime.jsxDEV(...)`를 **속성 접근**으로 호출하는 점을 이용해 런타임 함수를 교체(전역·import순서 무관).
 *  전역 1회·멱등. 패치 성공하면 true. */
export function installKoreanKeepAll(TextComponent: unknown): string {
  const runtimes: Array<Record<string, unknown> | null> = [];
  // 정적 문자열 require만 Metro가 번들에 포함(동적 require(변수)는 미포함 → 런타임 실패).
  try { runtimes.push(require('react/jsx-dev-runtime') as Record<string, unknown>); } catch { runtimes.push(null); }
  try { runtimes.push(require('react/jsx-runtime') as Record<string, unknown>); } catch { runtimes.push(null); }
  const done: string[] = [];
  for (const rt of runtimes) {
    if (!rt) continue;
    for (const fn of ['jsx', 'jsxs', 'jsxDEV']) {
      const orig = rt[fn] as ((t: unknown, p: unknown, ...rest: unknown[]) => unknown) & { __kbKeepAll?: boolean };
      if (typeof orig !== 'function') continue;
      if (orig.__kbKeepAll) { done.push(fn + ':already'); continue; }
      const wrapped = function (type: unknown, props: unknown, ...rest: unknown[]) {
        if (type === TextComponent && props) {
          const p = props as { children?: ReactNode };
          if (p.children != null) {
            const kids = transform(p.children);
            if (kids !== p.children) props = { ...(p as object), children: kids };
          }
        }
        return orig(type, props, ...rest);
      };
      (wrapped as { __kbKeepAll?: boolean }).__kbKeepAll = true;
      rt[fn] = wrapped;
      done.push(fn);
    }
  }
  return done.join(',') || 'none';
}
