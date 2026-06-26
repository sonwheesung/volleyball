// 헌액 유니폼 일러스트 — 팀색 유니폼 + 중앙 등번호(react-native-svg). 명예의전당 레전드 표시용.
// 자릿수별 폰트(1자리 84 / 2자리 56 + textLength 폭 클램프) — 2자리 오버플로 교정(웹 스크린샷 검증).
// 이미지 파일 0·전 해상도 선명. docs/BROADCAST_SYSTEM §8.4.
import Svg, { G, Path, Text as SvgText } from 'react-native-svg';

interface Props {
  primary: string; // 유니폼 몸통(팀색)
  light: string;   // 소매·테두리 하이라이트(팀색 밝은 톤)
  num: number;     // 헌액 번호 1~99
  width?: number;
}

export function LegendIllustration({ primary, light, num, width = 120 }: Props) {
  const nstr = String(num);
  const two = nstr.length >= 2;
  const fsz = two ? 56 : 84;        // 자릿수별 폰트(2자리 축소)
  return (
    <Svg width={width} height={(width * 250) / 240} viewBox="0 0 240 250">
      {/* 반짝이 */}
      <G fill="#FFD879">
        <Path d="M120 18 l3.5 8 8 3.5 -8 3.5 -3.5 8 -3.5 -8 -8 -3.5 8 -3.5 z" />
        <Path d="M58 60 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 z" />
        <Path d="M182 60 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 z" />
      </G>
      {/* 소매(팀색 + 하이라이트) */}
      <Path d="M80 78 L48 96 L64 128 L92 110 Z" fill={primary} />
      <Path d="M160 78 L192 96 L176 128 L148 110 Z" fill={primary} />
      <Path d="M48 96 L64 128 L58 132 L42 100 Z" fill={light} />
      <Path d="M192 96 L176 128 L182 132 L198 100 Z" fill={light} />
      {/* 몸통 */}
      <Path d="M80 78 Q120 70 160 78 L168 220 Q120 234 72 220 Z" fill={primary} />
      {/* 브이넥 */}
      <Path d="M100 76 L120 104 L140 76 Q120 70 100 76 Z" fill="#0b1320" />
      <Path d="M100 76 L120 104 L140 76" fill="none" stroke={light} strokeWidth={4} />
      {/* 밑단 라인 */}
      <Path d="M72 220 Q120 234 168 220" fill="none" stroke={light} strokeWidth={5} />
      {/* 등번호 */}
      <SvgText
        x={120} y={178} textAnchor="middle" fill="#fff" fontSize={fsz} fontWeight="900"
        fontFamily="Arial, sans-serif"
        textLength={two ? 74 : undefined} lengthAdjust={two ? 'spacingAndGlyphs' : undefined}
      >
        {nstr}
      </SvgText>
    </Svg>
  );
}
