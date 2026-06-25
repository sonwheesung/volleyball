// 우승 일러스트 — 얼굴 없는 블롭 선수들이 우승컵을 든 미니멀 벡터(react-native-svg).
// 가운데 선수 = 우승팀 색(primary/arm/badge). 양옆은 고정 코랄·앰버. 어떤 해상도에서도 선명, 이미지 파일 0.
// sim-web '🏆 우승 화면' 탭에서 합의한 룩과 동일 마크업(BROADCAST_SYSTEM 우승 연출).
import Svg, { Defs, LinearGradient, Stop, G, Rect, Circle, Ellipse, Path } from 'react-native-svg';

interface Props {
  primary: string; // 가운데 선수 몸통(우승팀 색)
  arm: string;     // 가운데 선수 팔(음영)
  badge: string;   // 가슴 뱃지
  width?: number;
}

export function ChampionIllustration({ primary, arm, badge, width = 320 }: Props) {
  return (
    <Svg width={width} height={(width * 320) / 400} viewBox="0 0 400 320">
      <Defs>
        <LinearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFD879" />
          <Stop offset="1" stopColor="#F2A93B" />
        </LinearGradient>
      </Defs>

      {/* 콘페티 */}
      <G opacity={0.92}>
        <Rect x={60} y={30} width={11} height={11} rx={2} fill="#10B9A6" rotation={20} originX={65} originY={35} />
        <Rect x={330} y={46} width={11} height={11} rx={2} fill="#FF6B5A" rotation={-15} originX={335} originY={51} />
        <Rect x={120} y={20} width={9} height={9} rx={2} fill="#F2A93B" rotation={30} originX={124} originY={24} />
        <Rect x={278} y={24} width={10} height={10} rx={2} fill="#3B82F6" rotation={-25} originX={283} originY={29} />
        <Circle cx={200} cy={16} r={4} fill="#FF6B5A" />
        <Circle cx={352} cy={116} r={4} fill="#10B9A6" />
        <Circle cx={46} cy={116} r={4} fill="#F2A93B" />
      </G>

      {/* 반짝이 */}
      <G fill="#FFD879">
        <Path d="M200 32 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4 z" />
        <Path d="M250 66 l2.5 6 6 2.5 -6 2.5 -2.5 6 -2.5 -6 -6 -2.5 6 -2.5 z" />
        <Path d="M150 68 l2.5 6 6 2.5 -6 2.5 -2.5 6 -2.5 -6 -6 -2.5 6 -2.5 z" />
      </G>

      {/* 우승컵 */}
      <G>
        <Rect x={190} y={146} width={20} height={14} rx={3} fill="#E0902A" />
        <Rect x={176} y={158} width={48} height={9} rx={4} fill="#C9791C" />
        <Path d="M168 92 h64 v14 a32 26 0 0 1 -64 0 z" fill="url(#cg)" />
        <Path d="M168 92 h64 v6 a32 10 0 0 1 -64 0 z" fill="#FFE49B" />
        <Path d="M168 96 a16 16 0 0 0 -16 16 a8 8 0 0 0 8 0 a10 10 0 0 1 8 -10 z" fill="#E0902A" />
        <Path d="M232 96 a16 16 0 0 1 16 16 a8 8 0 0 1 -8 0 a10 10 0 0 0 -8 -10 z" fill="#E0902A" />
        <Rect x={194} y={116} width={12} height={32} rx={3} fill="#E0902A" />
        <Path d="M200 106 l3 7 7.5 0.6 -5.7 5 1.8 7.3 -6.6 -4 -6.6 4 1.8 -7.3 -5.7 -5 7.5 -0.6 z" fill="#FFF3D0" />
      </G>

      <Ellipse cx={200} cy={296} rx={150} ry={16} fill="#10B9A6" opacity={0.1} />

      {/* 왼쪽 블롭(코랄) */}
      <G>
        <Ellipse cx={112} cy={293} rx={34} ry={10} fill="#000" opacity={0.07} />
        <Path d="M96 188 a16 16 0 0 1 -10 -14 a7 7 0 0 1 13 -3 z" fill="#FF8475" />
        <Path d="M128 188 a16 16 0 0 0 10 -14 a7 7 0 0 0 -13 -3 z" fill="#FF8475" />
        <Rect x={86} y={196} width={52} height={92} rx={26} fill="#FF6B5A" />
        <Ellipse cx={100} cy={214} rx={8} ry={11} fill="#fff" opacity={0.35} />
      </G>

      {/* 오른쪽 블롭(앰버) */}
      <G>
        <Ellipse cx={288} cy={293} rx={32} ry={9} fill="#000" opacity={0.07} />
        <Path d="M304 192 a15 15 0 0 0 9 -13 a6.5 6.5 0 0 0 -12 -3 z" fill="#F6BC5C" />
        <Rect x={266} y={206} width={48} height={84} rx={24} fill="#F2A93B" />
        <Ellipse cx={279} cy={222} rx={7} ry={10} fill="#fff" opacity={0.35} />
      </G>

      {/* 가운데 블롭(우승팀 색) — 컵을 든 주인공 */}
      <G>
        <Ellipse cx={200} cy={295} rx={40} ry={11} fill="#000" opacity={0.09} />
        <Path d="M176 174 a18 20 0 0 1 6 -24 l11 7 a10 12 0 0 0 -4 16 z" fill={arm} />
        <Path d="M224 174 a18 20 0 0 0 -6 -24 l-11 7 a10 12 0 0 1 4 16 z" fill={arm} />
        <Rect x={162} y={168} width={76} height={124} rx={38} fill={primary} />
        <Ellipse cx={182} cy={192} rx={11} ry={15} fill="#fff" opacity={0.34} />
        <Circle cx={200} cy={236} r={21} fill={badge} />
        <Path d="M200 226 l0 20 M196 228 l4 -2" stroke="#fff" strokeWidth={3.6} strokeLinecap="round" fill="none" />
      </G>

      {/* 배구공 */}
      <G>
        <Circle cx={62} cy={262} r={20} fill="#fff" stroke="#D7DEE6" strokeWidth={1.5} />
        <Path d="M62 242 a20 20 0 0 1 17 10 M62 282 a20 20 0 0 1 -17 -10 M48 250 a26 26 0 0 0 6 26" stroke="#10B9A6" strokeWidth={2.2} fill="none" strokeLinecap="round" />
      </G>
    </Svg>
  );
}
