// 팀 색 — 우승 일러스트·연출에 쓰는 구단 색. 현재 구단별 색 데이터가 없어 **팀 id 해시로 결정론 생성**한다.
// 추후 CLUB_IDENTITY에 실제 구단 색이 들어오면 teamColors가 그 값을 우선 쓰도록 바꾸면 된다(이 함수만 교체).
// 순수 함수(시드=id). react-native-svg/RN 스타일 모두 hsl() 문자열을 색으로 받는다.

export function teamHue(id: string): number {
  let h = 2166136261 >>> 0;
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
