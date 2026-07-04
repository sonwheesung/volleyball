// 선수 아바타 — id 시드 결정론 얼굴 레이어(여자 V리그 톤) + 유니폼을 react-native-svg로 직접 그린다(오프라인·저장 없음).
// 온브랜드(B, 2026-07-04): LegendIllustration 스타일 재사용. 이미지 에셋 0. 유대감 1순위 — 전원 회색 아이콘 → 고유 얼굴.
import { memo } from 'react';
import Svg, { Rect, Path, Circle, Ellipse, G } from 'react-native-svg';
import { faceFeatures } from '../data/playerFace';

const EYE = '#2B2320';

function HairBack({ style, hair }: { style: number; hair: string }) {
  switch (style) {
    case 0: return <Path d="M28 40 Q26 15 50 13 Q74 15 72 40 L75 74 Q70 56 64 46 Q67 62 60 68 L40 68 Q33 62 36 46 Q30 56 25 74 Z" fill={hair} />; // 롱
    case 1: return <Path d="M67 28 Q88 34 83 60 Q81 74 71 68 Q82 52 65 44 Q70 34 67 28 Z" fill={hair} />; // 포니테일 꼬리
    case 2: return <Path d="M28 42 Q26 15 50 13 Q74 15 72 42 L70 58 Q64 46 60 44 L40 44 Q36 46 30 58 Z" fill={hair} />; // 단발
    case 3: return <Circle cx={50} cy={15} r={9} fill={hair} />; // 올림(번)
    default: return <Path d="M30 40 Q28 16 50 15 Q72 16 70 40 L68 50 Q63 42 59 42 L41 42 Q37 42 32 50 Z" fill={hair} />; // 숏
  }
}

function HairFront({ style, hair }: { style: number; hair: string }) {
  switch (style) {
    case 1: return <Path d="M30 34 Q50 13 70 34 Q63 25 50 25 Q37 25 30 34 Z" fill={hair} />;
    case 3: return <Path d="M30 33 Q50 15 70 33 Q60 25 50 25 Q40 25 30 33 Z" fill={hair} />;
    case 4: return <Path d="M30 36 Q50 14 72 36 Q72 27 50 24 Q31 29 30 36 Z" fill={hair} />;
    default: return <Path d="M29 31 Q50 15 71 31 Q71 41 65 41 Q60 30 50 32 Q40 30 35 41 Q29 41 29 31 Z" fill={hair} />; // 뱅(0·2)
  }
}

function Eyes({ style }: { style: number }) {
  if (style === 2) return ( // 감은 눈(웃음)
    <G stroke={EYE} strokeWidth={1.6} fill="none" strokeLinecap="round">
      <Path d="M38.5 42 Q42 38.5 45.5 42" />
      <Path d="M54.5 42 Q58 38.5 61.5 42" />
    </G>
  );
  const r = style === 1 ? 3 : 2.7;
  return (
    <G>
      <Ellipse cx={42} cy={42} rx={r} ry={r + 0.4} fill={EYE} />
      <Ellipse cx={58} cy={42} rx={r} ry={r + 0.4} fill={EYE} />
      <Circle cx={43} cy={41} r={0.9} fill="#fff" />
      <Circle cx={59} cy={41} r={0.9} fill="#fff" />
    </G>
  );
}

function Mouth({ style }: { style: number }) {
  const d = style === 2 ? 'M46 52 L54 52' : style === 1 ? 'M47 51 Q50 53.5 53 51' : 'M45 51 Q50 55 55 51';
  return <Path d={d} stroke="#9C5B52" strokeWidth={1.7} fill="none" strokeLinecap="round" />;
}

export const PlayerAvatar = memo(function PlayerAvatar({ id, size = 84, jersey = '#2E6E8E', trim = '#8FD3E8' }: { id: string; size?: number; jersey?: string; trim?: string }) {
  const f = faceFeatures(id);
  const hairDark = f.hair;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Rect x={0} y={0} width={100} height={100} fill={f.bg} />
      <HairBack style={f.style} hair={hairDark} />
      <Rect x={45} y={54} width={10} height={14} fill={f.skin} />
      {/* 유니폼(어깨) + 브이넥 + 트림 */}
      <Path d="M14 100 Q14 72 50 67 Q86 72 86 100 Z" fill={jersey} />
      <Path d="M42 67 L50 76 L58 67 Q50 71 42 67 Z" fill="#0B1320" />
      <Path d="M42 67 L50 76 L58 67" stroke={trim} strokeWidth={2} fill="none" />
      {/* 머리 + 귀 */}
      <Ellipse cx={50} cy={40} rx={19} ry={21} fill={f.skin} />
      <Circle cx={31} cy={42} r={3.4} fill={f.skin} />
      <Circle cx={69} cy={42} r={3.4} fill={f.skin} />
      <HairFront style={f.style} hair={hairDark} />
      {/* 눈썹 */}
      <G stroke={hairDark} strokeWidth={1.5} fill="none" strokeLinecap="round">
        <Path d="M38.5 36.5 Q42 35 45.5 36.5" />
        <Path d="M54.5 36.5 Q58 35 61.5 36.5" />
      </G>
      <Circle cx={37} cy={47} r={3} fill="#F2A0A0" opacity={0.45} />
      <Circle cx={63} cy={47} r={3} fill="#F2A0A0" opacity={0.45} />
      <Eyes style={f.eyes} />
      <Mouth style={f.mouth} />
    </Svg>
  );
});
