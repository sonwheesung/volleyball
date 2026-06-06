// 가상 리그 시드 데이터 생성기 (Phase 2 간이판).
// 시드 RNG로 팀·선수·감독을 결정론적으로 생성한다. 같은 시드 = 같은 리그.

import { createRng, type Rng } from '../engine/rng';
import type { CareerStats, Coach, CoachStyle, Player, Position, Team } from '../types';
import { COACH_NAMES, FOREIGN_NAMES, GIVEN, SURNAMES, TEAM_NAMES } from './names';

export interface League {
  teams: Team[];
  players: Player[];
  coaches: Coach[];
}

// 한 팀의 포지션 구성 (16인) — KOVO 여자부 등록 규모 기준.
// 세터 3 / 아웃사이드 5 / 아포짓 2(외국인 1) / 미들 4 / 리베로 2
const ROSTER: Position[] = [
  'S', 'S', 'S',
  'OH', 'OH', 'OH', 'OH', 'OH',
  'OP', 'OP',
  'MB', 'MB', 'MB', 'MB',
  'L', 'L',
];

const STYLES: CoachStyle[] = ['attack', 'defense', 'balanced'];

const emptyCareer = (): CareerStats => ({
  seasons: 0, matches: 0, sets: 0, points: 0,
  spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0,
});

/** core 스탯은 높게, 그 외는 보통으로 — 포지션 차별화 */
function rollStat(rng: Rng, core: boolean): number {
  return core ? rng.int(68, 92) : rng.int(48, 78);
}

function heightFor(rng: Rng, pos: Position): number {
  switch (pos) {
    case 'MB': return rng.int(185, 192);
    case 'OP': return rng.int(180, 190);
    case 'OH': return rng.int(176, 186);
    case 'S': return rng.int(174, 183);
    case 'L': return rng.int(164, 172);
  }
}

function makePlayer(rng: Rng, id: string, pos: Position, isForeign: boolean): Player {
  const name = isForeign
    ? FOREIGN_NAMES[rng.int(0, FOREIGN_NAMES.length - 1)]
    : SURNAMES[rng.int(0, SURNAMES.length - 1)] + GIVEN[rng.int(0, GIVEN.length - 1)];

  // 포지션별 core 스탯 집합 (5.3 가중치 단순화)
  const core: Record<Position, Partial<Record<keyof Player, boolean>>> = {
    S: { skSet: true, focus: true },
    OH: { skSpike: true, skReceive: true, skServe: true },
    OP: { skSpike: true, skServe: true, jump: true },
    MB: { skBlock: true, skSpike: true, jump: true },
    L: { skDig: true, skReceive: true, agility: true },
  };
  const c = core[pos];

  return {
    id,
    name,
    age: rng.int(19, 34),
    position: pos,
    isForeign,
    height: heightFor(rng, pos),
    jump: rollStat(rng, !!c.jump),
    agility: rollStat(rng, !!c.agility),
    stamina: rng.int(55, 88),
    reaction: rng.int(52, 86),
    positioning: rng.int(50, 85),
    focus: rollStat(rng, !!c.focus),
    consistency: rng.int(50, 85),
    skSpike: rollStat(rng, !!c.skSpike),
    skBlock: rollStat(rng, !!c.skBlock),
    skDig: rollStat(rng, !!c.skDig),
    skReceive: rollStat(rng, !!c.skReceive),
    skSet: rollStat(rng, !!c.skSet),
    skServe: rollStat(rng, !!c.skServe),
    peakAge: pos === 'MB' ? 26 : 28,
    career: emptyCareer(),
  };
}

export function generateLeague(seed: number): League {
  const rng = createRng(seed);
  const teams: Team[] = [];
  const players: Player[] = [];
  const coaches: Coach[] = [];

  TEAM_NAMES.forEach((teamName, ti) => {
    const teamId = `t${ti}`;
    const playerIds: string[] = [];

    // 외국인 1명: OP 중 한 자리
    let foreignAssigned = false;
    ROSTER.forEach((pos, pi) => {
      const isForeign = pos === 'OP' && !foreignAssigned ? (foreignAssigned = true) : false;
      const pid = `${teamId}p${pi}`;
      players.push(makePlayer(rng, pid, pos, isForeign));
      playerIds.push(pid);
    });

    const coachId = `${teamId}c`;
    const style = STYLES[rng.int(0, STYLES.length - 1)];
    coaches.push({
      id: coachId,
      name: COACH_NAMES[rng.int(0, COACH_NAMES.length - 1)],
      age: rng.int(45, 64),
      charisma: rng.int(45, 95),
      style,
      teamId,
    });

    teams.push({
      id: teamId,
      name: teamName,
      players: playerIds,
      coachId,
      coachStyle: style,
      foreignSlots: 1,
    });
  });

  return { teams, players, coaches };
}
