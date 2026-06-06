import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from './rng';
import { applyTrainingDay, TRAINABLE_STATS } from './training';
import type { Player, Position, TrainableStat, TrainingFocus } from '../types';

// 매 캘린더일 훈련 → 개월 = 일수 / 30
const PER_MONTH = 30;

function makePlayer(opts: {
  age: number;
  talentBase: number;
  position?: Position;
  skSpikePot?: number;
}): Player {
  const potential = {} as Record<TrainableStat, number>;
  for (const s of TRAINABLE_STATS) potential[s] = 85; // 넉넉한 헤드룸
  potential.skSpike = opts.skSpikePot ?? 90;

  return {
    id: 'test',
    name: '테스트',
    age: opts.age,
    position: opts.position ?? 'OH',
    isForeign: false,
    height: 180,
    jump: 60, agility: 60, staminaMax: 60, staminaRegen: 60,
    reaction: 60, positioning: 60,
    focus: 60, consistency: 60, vq: 60,
    skSpike: 70, skBlock: 60, skDig: 60, skReceive: 60, skSet: 60, skServe: 60,
    xp: {},
    potential,
    talentBase: opts.talentBase,
    catTalent: { physical: 1.0, skill: 1.0, mental: 1.0 },
    contract: { salary: 0, years: 1, remaining: 1, signedAtAge: opts.age },
    clubTenure: 5,
    peakAge: 28,
    career: { seasons: 0, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0 },
  };
}

// 공격(4) 핵심 → skSpike 주 스탯 집중
const FOCUS: TrainingFocus = { primary: [4, 5], secondary: [6, 7, 8] };

function daysToPlusOne(p: Player, seed: number): number {
  const rng = createRng(seed);
  const start = p.skSpike;
  let cur = p;
  for (let day = 1; day <= 2000; day++) {
    cur = applyTrainingDay(cur, FOCUS, rng);
    if (cur.skSpike > start) return day;
  }
  return -1;
}

test('보통 선수(24세·재능1.0): 핵심 스탯 +1 ≈ 4개월', () => {
  const days = daysToPlusOne(makePlayer({ age: 24, talentBase: 1.0 }), 111);
  const months = days / PER_MONTH;
  assert.ok(months >= 3 && months <= 5.5, `보통 +1 = ${days}일(${months.toFixed(1)}개월)`);
});

test('어리고 특급(19세·재능1.3): 핵심 스탯 +1 ≈ 2~3개월', () => {
  const days = daysToPlusOne(makePlayer({ age: 19, talentBase: 1.3 }), 111);
  const months = days / PER_MONTH;
  assert.ok(months >= 1.8 && months <= 3.4, `특급 +1 = ${days}일(${months.toFixed(1)}개월)`);
});

test('어린 특급이 보통보다 확실히 빠르다', () => {
  const normal = daysToPlusOne(makePlayer({ age: 24, talentBase: 1.0 }), 111);
  const young = daysToPlusOne(makePlayer({ age: 19, talentBase: 1.3 }), 111);
  assert.ok(young < normal, `young=${young} normal=${normal}`);
});

test('포텐셜 상한에 닿으면 더 안 큰다', () => {
  const p = makePlayer({ age: 19, talentBase: 1.3, skSpikePot: 70 }); // 현재=상한
  const rng = createRng(5);
  let cur = p;
  for (let i = 0; i < 500; i++) cur = applyTrainingDay(cur, FOCUS, rng);
  assert.equal(cur.skSpike, 70, '상한 도달 스탯은 불변');
});

test('노장(33세) 신체 스탯은 훈련해도 0 성장', () => {
  // 웨이트(1) 핵심 → jump 주 스탯
  const focus: TrainingFocus = { primary: [1, 2], secondary: [3, 4, 5] };
  const p = makePlayer({ age: 33, talentBase: 1.3 });
  const rng = createRng(9);
  let cur = p;
  for (let i = 0; i < 800; i++) cur = applyTrainingDay(cur, focus, rng);
  assert.equal(cur.jump, 60, '전성기 후 신체는 성장 없음');
});

test('결정론: 같은 시드 = 같은 소요일', () => {
  const a = daysToPlusOne(makePlayer({ age: 24, talentBase: 1.0 }), 77);
  const b = daysToPlusOne(makePlayer({ age: 24, talentBase: 1.0 }), 77);
  assert.equal(a, b);
});
