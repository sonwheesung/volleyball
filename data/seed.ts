// 가상 리그 시드 데이터 생성기 (Phase 2 간이판).
// 시드 RNG로 팀·선수·감독을 결정론적으로 생성한다. 같은 시드 = 같은 리그.

import { createRng, strSeed, type Rng } from '../engine/rng';
import { TRAINABLE_STATS } from '../engine/training';
import { rollFAPref } from '../engine/faMarket';
import { computeSalary } from '../engine/salary';
import { headCoachSalary, assistantSalary, scoutSalary } from '../engine/staff';
import type {
  AssistantCoach,
  CareerStats,
  Coach,
  CoachSpecialty,
  CoachStyle,
  Player,
  Position,
  Scout,
  TrainableStat,
  TrainingFocus,
} from '../types';
import { COACH_NAMES, FOREIGN_NAMES, GIVEN, SURNAMES, TEAM_NAMES } from './names';

export interface League {
  teams: Team[];
  players: Player[];
  coaches: Coach[];            // 팀 배정 감독 + 프리에이전트 감독 풀(teamId=null)
  assistants: AssistantCoach[]; // 전문 코치 풀(프리)
  scouts: Scout[];             // 스카우터 풀(프리)
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

// 감독 아키타입 7종 (TRAINING_SYSTEM 3.1) → 팀마다 1개씩 배정(분화 보장). UI 훈련방향 선택지로도 재사용.
export interface Archetype { name: string; focus: TrainingFocus; style: CoachStyle }
export const ARCHETYPES: Archetype[] = [
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
  bias = 0, // 팀 전력 티어(시드 전용) — 그 팀 선수 능력을 ±이동해 팀 OVR 분포를 넓힘
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

  // 팀 전력 티어 적용 — OVR에 기여하는 능력만 ±이동(키·체력 제외). 시드 로스터 한정.
  if (bias !== 0) {
    const adj = (v: number) => Math.max(20, Math.min(95, Math.round(v + bias)));
    for (const k of ['jump', 'agility', 'reaction', 'positioning', 'focus', 'consistency', 'vq',
      'skSpike', 'skBlock', 'skDig', 'skReceive', 'skSet', 'skServe'] as (keyof typeof cur)[]) {
      cur[k] = adj(cur[k]);
    }
  }

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
  player.faPref = rollFAPref(createRng(strSeed(id)), TEAM_NAMES.length);
  return player;
}

// 신인(유망주) 생성 — 현재 OVR은 낮게(육성 대상), 포텐셜은 높게.
// 드래프트 클래스 + 자동 충원 공용. KOVO 신인 기준(대부분 즉전감 아님).
export function makeProspect(rng: Rng, id: string, pos: Position): Player {
  const name = SURNAMES[rng.int(0, SURNAMES.length - 1)] + GIVEN[rng.int(0, GIVEN.length - 1)];
  const age = rng.int(18, 20);
  const core: Record<Position, Partial<Record<keyof Player, boolean>>> = {
    S: { skSet: true, vq: true, focus: true },
    OH: { skSpike: true, skReceive: true, skServe: true },
    OP: { skSpike: true, skServe: true, jump: true },
    MB: { skBlock: true, skSpike: true, jump: true },
    L: { skDig: true, skReceive: true, agility: true },
  };
  const c = core[pos];

  // 재능을 먼저 굴려 현재 피지컬·기술에 반영(즉전감 대형 신인 vs 프로젝트형 분화)
  const talentBase = rollTalent(rng);
  const catTalent = {
    physical: 0.85 + rng.next() * 0.3,
    skill: 0.85 + rng.next() * 0.3,
    mental: 0.85 + rng.next() * 0.3,
  };
  const boost = Math.round((talentBase - 0.95) * 16); // 재능 보너스 (대략 -5 ~ +7)
  const clamp = (v: number) => Math.max(30, Math.min(80, v));
  const sk = (isCore: boolean) => clamp((isCore ? rng.int(46, 64) : rng.int(36, 54)) + boost);

  const cur = {
    height: heightFor(rng, pos),
    jump: clamp((c.jump ? rng.int(56, 76) : rng.int(48, 68)) + boost),
    agility: clamp((c.agility ? rng.int(56, 76) : rng.int(48, 68)) + boost),
    staminaMax: rng.int(50, 74),
    staminaRegen: rng.int(48, 72),
    reaction: clamp(rng.int(44, 62) + boost),
    positioning: rng.int(34, 52),   // 경험 부족(전원 낮게)
    focus: c.focus ? rng.int(48, 64) : rng.int(42, 58),
    consistency: rng.int(38, 56),   // 기복 큼(전원 낮게)
    vq: rng.int(32, 50),            // 배구 IQ 낮게 시작(경험으로 성장)
    skSpike: sk(!!c.skSpike),
    skBlock: sk(!!c.skBlock),
    skDig: sk(!!c.skDig),
    skReceive: sk(!!c.skReceive),
    skSet: sk(!!c.skSet),
    skServe: sk(!!c.skServe),
  };
  const potential = {} as Record<TrainableStat, number>;
  for (const s of TRAINABLE_STATS) {
    const base = (cur as Record<string, number>)[s];
    const head = Math.round((12 + rng.int(0, 18)) * talentBase); // 큰 성장 여지
    potential[s] = Math.min(99, base + Math.max(0, head));
  }

  const player: Player = {
    id, name, age, position: pos, isForeign: false,
    ...cur,
    xp: {}, potential, talentBase, catTalent,
    contract: { salary: 0, years: 3, remaining: 3, signedAtAge: age },
    clubTenure: 0,
    peakAge: pos === 'MB' ? 26 : 28,
    career: emptyCareer(),
  };
  player.contract.salary = computeSalary(player, age, rng);
  player.faPref = rollFAPref(createRng(strSeed(id)), TEAM_NAMES.length);
  return player;
}

// 팀 전력 티어 — 시드 로스터의 팀 OVR 분포를 넓혀(압축 66~71 → ~62~76) 강·약팀을 만든다.
// 대칭 분포라 리그 평균은 유지. 드래프트(꼴찌 우선)·노쇠·FA로 수십 시즌 뒤 평균회귀(parity 유지).
const TIER_SPREAD = 3;

export function generateLeague(seed: number): League {
  const rng = createRng(seed);
  const teams: Team[] = [];
  const players: Player[] = [];
  const coaches: Coach[] = [];

  // 팀별 전력 티어(대칭) — rng로 팀 배정 셔플 → 시드마다 강팀이 달라짐
  const N = TEAM_NAMES.length;
  const tiers = TEAM_NAMES.map((_, i) => (N <= 1 ? 0 : (i / (N - 1) - 0.5) * 2 * TIER_SPREAD));
  for (let i = tiers.length - 1; i > 0; i--) { const j = rng.int(0, i); [tiers[i], tiers[j]] = [tiers[j], tiers[i]]; }

  TEAM_NAMES.forEach((teamName, ti) => {
    const teamId = `t${ti}`;
    const playerIds: string[] = [];
    const teamBias = tiers[ti];

    // 외국인 1명: OP 중 한 자리
    let foreignAssigned = false;
    let teamSalary = 0;
    ROSTER.forEach((pos, pi) => {
      const isForeign = pos === 'OP' && !foreignAssigned ? (foreignAssigned = true) : false;
      const pl = makePlayer(rng, `${teamId}p${pi}`, pos, isForeign, undefined, teamBias);
      players.push(pl);
      playerIds.push(pl.id);
      teamSalary += pl.contract.salary;
    });

    // 아키타입을 팀마다 다르게 배정 (분화 보장)
    const arch = ARCHETYPES[ti % ARCHETYPES.length];
    const coachId = `${teamId}c`;
    const charisma = rng.int(45, 95);
    coaches.push({
      id: coachId,
      name: COACH_NAMES[rng.int(0, COACH_NAMES.length - 1)],
      age: rng.int(45, 64),
      charisma,
      style: arch.style,
      archetype: arch.name,
      trainingFocus: arch.focus,
      salary: headCoachSalary(charisma),
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

  // ── 스태프 프리에이전트 풀 (STAFF_SYSTEM) — 단장이 영입 ──
  const assistants: AssistantCoach[] = [];
  const scouts: Scout[] = [];
  const STYLES: CoachStyle[] = ['attack', 'defense', 'balanced'];
  const SPECIALTIES: CoachSpecialty[] = ['attack', 'defense', 'stamina', 'setter', 'mental'];

  // 프리 감독 6명(아키타입·성향 다양)
  for (let i = 0; i < 6; i++) {
    const arch = ARCHETYPES[rng.int(0, ARCHETYPES.length - 1)];
    const ch = rng.int(48, 96);
    coaches.push({
      id: `fc${i}`, name: COACH_NAMES[rng.int(0, COACH_NAMES.length - 1)], age: rng.int(44, 65),
      charisma: ch, style: STYLES[rng.int(0, STYLES.length - 1)], archetype: arch.name,
      trainingFocus: arch.focus, salary: headCoachSalary(ch), teamId: null,
    });
  }
  // 전문 코치 — 분야별 4명(=20)
  let ai = 0;
  for (const sp of SPECIALTIES) for (let k = 0; k < 4; k++) {
    const rating = rng.int(52, 92);
    assistants.push({
      id: `ac${ai++}`, name: COACH_NAMES[rng.int(0, COACH_NAMES.length - 1)], age: rng.int(38, 62),
      specialty: sp, rating, salary: assistantSalary(rating), teamId: null,
    });
  }
  // 스카우터 12명
  for (let i = 0; i < 12; i++) {
    const sc = rng.int(45, 93);
    scouts.push({
      id: `sc${i}`, name: COACH_NAMES[rng.int(0, COACH_NAMES.length - 1)], age: rng.int(40, 66),
      scouting: sc, salary: scoutSalary(sc), teamId: null,
    });
  }

  return { teams, players, coaches, assistants, scouts };
}
