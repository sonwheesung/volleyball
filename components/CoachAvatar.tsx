// 감독 이니셜 카드(STAFF §9.6-E Phase E) — 팀 컬러 배경 + 이름 이니셜 + 벤치 실루엣.
//   감독용 아바타 시트 생산은 별도 후속(사용자 결정 대기)이라 이번엔 이니셜 카드가 정본. 이미지 에셋 0·오프라인·결정론.
//   온브랜드: PlayerAvatar/LegendIllustration 톤(SVG·팀색) 준수.
import { memo } from 'react';
import Svg, { Rect, Path, Circle, Text as SvgText } from 'react-native-svg';
import { teamColors } from '../lib/teamColor';

/** 이름 첫 글자(이니셜) — 한글 1자·영문 1자. 빈 이름은 '·'. */
function initialOf(name: string): string {
  const t = (name ?? '').trim();
  return t ? Array.from(t)[0] : '·';
}

export const CoachAvatar = memo(function CoachAvatar({ id, name, size = 48 }: { id: string; name: string; size?: number }) {
  // 팀 컬러(감독 소속 팀 id) 배경 — 소속 없으면(프리) id 해시 폴백(teamColors 내부 처리).
  const c = teamColors(id);
  const initial = initialOf(name);
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Rect x={0} y={0} width={100} height={100} rx={14} fill={c.bg} />
      {/* 벤치 실루엣(어깨선) — 익명 실루엣 톤 */}
      <Path d="M18 100 Q18 74 50 68 Q82 74 82 100 Z" fill={c.arm} opacity={0.55} />
      <Circle cx={50} cy={44} r={19} fill={c.primary} opacity={0.55} />
      {/* 이니셜 — 밝은 톤 대비 */}
      <SvgText x={50} y={52} fontSize={30} fontWeight="900" fill={c.light} textAnchor="middle">{initial}</SvgText>
    </Svg>
  );
});
