// 시즌 일정 생성 (CLAUDE.md Phase 3 간이판).
// 더블 라운드로빈(서클 방식) → 경기일을 일자 인덱스에 매핑.
// 결정론: 같은 팀 목록 + 시드 = 같은 일정.

import type { Fixture, ScheduleEntry } from '../types';

const GAME_INTERVAL = 4; // 매치데이 간 간격(일)
const SEASON_OFFSET = 0; // 시즌 시작일의 첫 매치데이
const LEGS = 6;          // KOVO 여자부 정규리그 6라운드 풀리그

/** 서클 방식 1차 라운드로빈: 각 라운드의 [home, away] 페어 목록 */
function singleRoundRobin(ids: string[]): [string, string][][] {
  const arr = [...ids];
  if (arr.length % 2 !== 0) arr.push('__BYE__'); // 홀수면 부전승 슬롯
  const n = arr.length;
  const rounds: [string, string][][] = [];

  for (let r = 0; r < n - 1; r++) {
    const round: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a !== '__BYE__' && b !== '__BYE__') {
        // 라운드 패리티로 홈/원정 번갈아
        round.push(r % 2 === 0 ? [a, b] : [b, a]);
      }
    }
    rounds.push(round);
    // arr[0] 고정, 나머지 시계 회전
    arr.splice(1, 0, arr.pop() as string);
  }
  return rounds;
}

export function generateSeason(teamIds: string[], seed: number): Fixture[] {
  const base = singleRoundRobin(teamIds);
  // 6라운드 풀리그: 매 라운드 홈/원정 반전(짝수=원본, 홀수=스왑)
  const allRounds: [string, string][][] = [];
  for (let leg = 0; leg < LEGS; leg++) {
    for (const round of base) {
      allRounds.push(leg % 2 === 0 ? round : round.map(([h, a]) => [a, h] as [string, string]));
    }
  }

  const fixtures: Fixture[] = [];
  let idx = 0;
  allRounds.forEach((round, r) => {
    const dayIndex = SEASON_OFFSET + r * GAME_INTERVAL;
    round.forEach(([home, away]) => {
      fixtures.push({
        id: `f${idx}`,
        round: r,
        dayIndex,
        homeTeamId: home,
        awayTeamId: away,
        seed: seed + idx * 1009,
      });
      idx++;
    });
  });
  return fixtures;
}

/** 선택한 팀 기준 캘린더 일정(경기 + 전술 훈련 이벤트) */
export function teamScheduleEntries(season: Fixture[], teamId: string): ScheduleEntry[] {
  const entries: ScheduleEntry[] = [];
  for (const f of season) {
    if (f.homeTeamId !== teamId && f.awayTeamId !== teamId) continue;
    const isHome = f.homeTeamId === teamId;
    // 경기 전날 전술 훈련
    entries.push({ kind: 'event', dayIndex: f.dayIndex - 1, title: '전술 훈련' });
    entries.push({
      kind: 'match',
      dayIndex: f.dayIndex,
      fixture: f,
      isHome,
      opponentId: isHome ? f.awayTeamId : f.homeTeamId,
    });
  }
  entries.sort((a, b) => a.dayIndex - b.dayIndex);
  return entries;
}
