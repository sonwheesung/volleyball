// 팀 색 — 우승 일러스트·연출에 쓰는 구단 색. **CLUB_IDENTITY의 실제 구단 hue를 우선** 쓰고,
// 비표준 id(합성 테스트 등)면 id 해시로 결정론 폴백한다(2026-06-26 연결, CLUB_IDENTITY_SYSTEM §2).
// 순수 함수. react-native-svg/RN 스타일 모두 hsl() 문자열을 색으로 받는다.
import { clubIdentity } from '../data/clubIdentity';

export function teamHue(id: string): number {
  const ci = clubIdentity(id);          // t0..t6 → 구단 시그니처 색
  if (ci) return ci.hue;
  let h = 2166136261 >>> 0;             // 비표준 id 폴백(결정론 해시)
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h % 360;
}

export interface TeamColors {
  hue: number;
  primary: string; // 몸통(메인)
  arm: string;     // 팔(어두운 음영)
  badge: string;   // 가슴 뱃지(더 어두운)
  bg: string;      // 축하 화면 배경(어두운 톤)
  light: string;   // 강조 텍스트(밝은 톤)
}

export function teamColors(id: string): TeamColors {
  const h = teamHue(id);
  return {
    hue: h,
    primary: `hsl(${h}, 60%, 47%)`,
    arm: `hsl(${h}, 60%, 39%)`,
    badge: `hsl(${h}, 52%, 31%)`,
    bg: `hsl(${h}, 38%, 15%)`,
    light: `hsl(${h}, 70%, 72%)`,
  };
}
