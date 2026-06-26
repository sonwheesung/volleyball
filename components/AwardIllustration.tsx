// 시상식 일러스트 — MVP 트로피만(블롭 제거, 2026-06-26 사용자 요청). 깔끔한 금 트로피 + 반짝이.
// 팀 색은 이 일러스트를 감싸는 카드(배경·텍스트)가 담당 — 트로피는 보편 금색. AWARDS_SYSTEM §6.
import Svg, { Defs, LinearGradient, Stop, G, Rect, Path } from 'react-native-svg';

interface Props {
  width?: number;
}

export function AwardIllustration({ width = 120 }: Props) {
  return (
    <Svg width={width} height={(width * 116) / 200} viewBox="0 0 200 116">
      <Defs>
        <LinearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFD879" />
          <Stop offset="1" stopColor="#F2A93B" />
        </LinearGradient>
      </Defs>

      {/* 반짝이 */}
      <G fill="#FFD879">
        <Path d="M100 8 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3 z" />
        <Path d="M52 36 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 z" />
        <Path d="M148 36 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 z" />
      </G>

      {/* 트로피 */}
      <G>
        <Rect x={90} y={80} width={20} height={14} rx={3} fill="#E0902A" />
        <Rect x={74} y={92} width={52} height={10} rx={4} fill="#C9791C" />
        <Path d="M68 26 h64 v14 a32 26 0 0 1 -64 0 z" fill="url(#tg)" />
        <Path d="M68 26 h64 v6 a32 10 0 0 1 -64 0 z" fill="#FFE49B" />
        <Path d="M68 30 a16 16 0 0 0 -16 16 a8 8 0 0 0 8 0 a10 10 0 0 1 8 -10 z" fill="#E0902A" />
        <Path d="M132 30 a16 16 0 0 1 16 16 a8 8 0 0 1 -8 0 a10 10 0 0 0 -8 -10 z" fill="#E0902A" />
        <Rect x={94} y={50} width={12} height={32} rx={3} fill="#E0902A" />
        <Path d="M100 40 l3 7 7.5 0.6 -5.7 5 1.8 7.3 -6.6 -4 -6.6 4 1.8 -7.3 -5.7 -5 7.5 -0.6 z" fill="#FFF3D0" />
      </G>
    </Svg>
  );
}
