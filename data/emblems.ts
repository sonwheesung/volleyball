// 구단 엠블럼 — 단일 소스(select-team·team 상세·경기 스코어보드 공용). LEAGUE.teams 순서로 매핑.
import { LEAGUE } from './league';

const EMBLEMS = [
  require('../assets/clubs/incheon.png'),
  require('../assets/clubs/suwon.png'),
  require('../assets/clubs/daejeon.png'),
  require('../assets/clubs/gwangju.png'),
  require('../assets/clubs/gimcheon.png'),
  require('../assets/clubs/hwaseong.png'),
  require('../assets/clubs/seoul.png'),
];

/** 팀 id → 엠블럼 이미지 소스(없으면 첫 엠블럼 폴백) */
export function emblemFor(teamId: string): number {
  const i = LEAGUE.teams.findIndex((t) => t.id === teamId);
  return EMBLEMS[i >= 0 ? i : 0] ?? EMBLEMS[0];
}
