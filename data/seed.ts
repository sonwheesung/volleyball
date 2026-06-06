// 가상 리그 시드 데이터 생성기 (Phase 2 간이판).
// 시드 RNG로 팀·선수·감독을 결정론적으로 생성한다. 같은 시드 = 같은 리그.

import { createRng, type Rng } from '../engine/rng';
import { TRAINABLE_STATS } from '../engine/training';
import { computeSalary } from '../engine/salary';
import type {
  CareerStats,
  Coach,
  CoachStyle,
  Player,
  Position,
  TrainableStat,
  TrainingFocus,
} from '../types';
import { COACH_NAMES, FOREIGN_NAMES, GIVEN, SURNAMES, TEAM_NAMES } from './names';

export interface League {
  teams: Team[];
  players: Player[];
  coaches: Coach[];
}

import type { Team } from '../types';

// 한 팀의 포지션 구성 (16인) — KOVO 여자부 등록 규모 기준.
// 세터 3 / 아웃사이드 5 / 아포짓 2(외국인 1) / 미들 4 / 리베로 2
const ROSTER: Position[] = [
  'S', 'S', 'S',
  'OH', 'OH', 'OH', 'OH', 'OH',
  'OP', 'OP',
  'MB', 'MB', 'MB', 'MB',
  'L', 'L',
];

// 감독 아키타입 7종 (TRAINING_SYSTEM 3.1) → 팀마다 1개씩 배정(분화 보장)
const ARCHETYPES: { name: string; focus: TrainingFocus; style: CoachStyle }[] = [
  { name: '체력파', focus: { primary: [1, 2], secondary: [3, 4, 12] }, style: 'balanced' },
  { name: '기본기파', focus: { primary: [4, 6], secondary: [5, 7, 9] }, style: 'balanced' },
  { name: '전술파', focus: { primary: [10, 11], secondary: [6, 9, 12] }, style: 'defense' },
  { name: '공격파', focus: { primary: [4, 1], secondary: [5, 9, 3] }, style: 'attack' },
  { name: '수비파', focus: { primary: [6, 7], secondary: [8, 2, 3] }, style: 'defense' },
  { name: '스파르타', focus: { primary: [2, 3], secondary: [1, 12, 6] }, style: 'balanced' },
  { name: '밸런스', focus: { primary: [4, 6], secondary: [1, 10, 12] }, style: 'balanced' },
];

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

/** 재능 등급 분포 (TRAINING_SYSTEM 1.2) → talentBase */
function rollTalent(rng: Rng): number {
  const r = rng.next();
  if (r < 0.03) return 1.25 + rng.next() * 0.15; // S
  if (r < 0.15) return 1.12 + rng.next() * 0.13; // A
  if (r < 0.60) return 0.95 + rng.next() * 0.17; // B
  if (r < 0.90) return 0.80 + rng.next() * 0.15; // C
  return 0.60 + rng.next() * 0.20;               // D
}

export function makePlayer(
  rng: Rng,
  id: string,
  pos: Position,
  isForeign: boolean,
  ageOverride?: number,
): Player {
  const name = isForeign
    ? FOREIGN_NAMES[rng.int(0, FOREIGN_NAMES.length - 1)]
    : SURNAMES[rng.int(0, SURNAMES.length - 1)] + GIVEN[rng.int(0, GIVEN.length - 1)];

  // 포지션별 core 스탯 (5.3 가중치 단순화)
  const core: Record<Position, Partial<Record<keyof Player, boolean>>> = {
    S: { skSet: true, vq: true, focus: true },
    OH: { skSpike: true, skReceive: true, skServe: true },
    OP: { skSpike: true, skServe: true, jump: true },
    MB: { skBlock: true, skSpike: true, jump: true },
    L: { skDig: true, skReceive: true, agility: true },
  };
  const c = core[pos];
  const age = ageOverride ?? rng.int(19, 34);

  // 현재 스탯
  const cur = {
    height: heightFor(rng, pos),
    jump: rollStat(rng, !!c.jump),
    agility: rollStat(rng, !!c.agility),
    staminaMax: rng.int(55, 88),
    staminaRegen: rng.int(50, 85),
    reaction: rng.int(52, 86),
    positioning: rng.int(50, 85),
    focus: rollStat(rng, !!c.focus),
    consistency: rng.int(50, 85),
    vq: rollStat(rng, !!c.vq),
    skSpike: rollStat(rng, !!c.skSpike),
    skBlock: rollStat(rng, !!c.skBlock),
    skDig: rollStat(rng, !!c.skDig),
    skReceive: rollStat(rng, !!c.skReceive),
    skSet: rollStat(rng, !!c.skSet),
    skServe: rollStat(rng, !!c.skServe),
  };

  // 재능
  const talentBase = rollTalent(rng);
  const catTalent = {
    physical: 0.85 + rng.next() * 0.3,
    skill: 0.85 + rng.next() * 0.3,
    mental: 0.85 + rng.next() * 0.3,
  };

  // 스탯별 포텐셜: 어릴수록·재능 좋을수록 헤드룸 큼
  const youth = Math.max(0, Math.min(1, (26 - age) / 8));
  const potential = {} as Record<TrainableStat, number>;
  for (const s of TRAINABLE_STATS) {
    const base = (cur as Record<string, number>)[s];
    const head = Math.round((4 + rng.int(0, 12)) * (0.4 + 0.6 * youth) * talentBase);
    potential[s] = Math.min(99, base + Math.max(0, head));
  }

  // 계약: 0~3시즌 전 서명 → 현재 능력과 자연 불일치
  const yearsAgo = rng.int(0, 3);
  const signedAtAge = Math.max(18, age - yearsAgo);
  const remaining = rng.int(1, 3);

  const player: Player = {
    id,
    name,
    age,
    position: pos,
    isForeign,
    ...cur,
    xp: {},
    potential,
    talentBase,
    catTalent,
    contract: { salary: 0, years: yearsAgo + remaining, remaining, signedAtAge },
    clubTenure: Math.max(0, age - 19), // 시드는 자팀 육성(홈그로운) 가정
    peakAge: pos === 'MB' ? 26 : 28,
    career: { ...emptyCareer(), seasons: Math.max(0, age - 19) }, // 데뷔 추정
  };
  player.contract.salary = computeSalary(player, signedAtAge, rng);
  return player;
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
    let teamSalary = 0;
    ROSTER.forEach((pos, pi) => {
      const isForeign = pos === 'OP' && !foreignAssigned ? (foreignAssigned = true) : false;
      const pl = makePlayer(rng, `${teamId}p${pi}`, pos, isForeign);
      players.push(pl);
      playerIds.push(pl.id);
      teamSalary += pl.contract.salary;
    });

    // 아키타입을 팀마다 다르게 배정 (분화 보장)
    const arch = ARCHETYPES[ti % ARCHETYPES.length];
    const coachId = `${teamId}c`;
    coaches.push({
      id: coachId,
      name: COACH_NAMES[rng.int(0, COACH_NAMES.length - 1)],
      age: rng.int(45, 64),
      charisma: rng.int(45, 95),
      style: arch.style,
      archetype: arch.name,
      trainingFocus: arch.focus,
      teamId,
    });

    teams.push({
      id: teamId,
      name: teamName,
      players: playerIds,
      coachId,
      coachStyle: arch.style,
      foreignSlots: 1,
      budget: Math.round((teamSalary * 1.12) / 1000) * 1000, // 총연봉 + 12% 여유
    });
  });

  return { teams, players, coaches };
}
