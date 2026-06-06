import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from './rng';
import { applyAgingDay, FLOOR } from './aging';
import { TRAINABLE_STATS } from './training';
import type { Player, TrainableStat } from '../types';

const SEASON_DAYS = 100; // 시즌당 ~100 훈련일 가정

function makePlayer(age: number, startVal = 70): Player {
  const potential = {} as Record<TrainableStat, number>;
  for (const s of TRAINABLE_STATS) potential[s] = 99;
  const base = {
    jump: startVal, agility: startVal, staminaMax: startVal, staminaRegen: startVal,
    reaction: startVal, positioning: startVal,
    focus: startVal, consistency: startVal, vq: startVal,
    skSpike: startVal, skBlock: startVal, skDig: startVal, skReceive: startVal, skSet: startVal, skServe: startVal,
  };
  return {
    id: 'x', name: 'x', age, position: 'OH', isForeign: false, height: 180,
    ...base,
    xp: {}, potential, talentBase: 1.0,
    catTalent: { physical: 1, skill: 1, mental: 1 },
    peakAge: 28,
    career: { seasons: 0, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0 },
  };
}

function runSeason(p: Player, seed: number): Player {
  const rng = createRng(seed);
  let cur = p;
  for (let i = 0; i < SEASON_DAYS; i++) cur = applyAgingDay(cur, rng);
  return cur;
}

test('전성기 이전(24세)은 노쇠 없음', () => {
  const after = runSeason(makePlayer(24), 1);
  assert.equal(after.jump, 70);
  assert.equal(after.skSpike, 70);
});

test('노장(33세) 신체는 한 시즌에 1~2점 하락', () => {
  const after = runSeason(makePlayer(33), 1);
  const drop = 70 - after.jump;
  assert.ok(drop >= 1 && drop <= 3, `jump 하락=${drop}`);
});

test('33세도 멘탈(VQ)은 거의 유지', () => {
  const after = runSeason(makePlayer(33), 1);
  assert.equal(after.vq, 70, `vq=${after.vq}`);
});

test('나이 들수록 신체 하락이 가파르다', () => {
  const at30 = 70 - runSeason(makePlayer(30), 7).jump;
  const at36 = 70 - runSeason(makePlayer(36), 7).jump;
  assert.ok(at36 > at30, `30세 ${at30} vs 36세 ${at36}`);
});

test('FLOOR 아래로는 안 떨어진다', () => {
  let p = makePlayer(38, FLOOR + 1);
  for (let s = 0; s < 20; s++) p = runSeason(p, s); // 20시즌 갈아도
  assert.ok(p.jump >= FLOOR, `jump=${p.jump}`);
});

test('결정론: 같은 시드 = 같은 결과', () => {
  const a = runSeason(makePlayer(34), 99).jump;
  const b = runSeason(makePlayer(34), 99).jump;
  assert.equal(a, b);
});
