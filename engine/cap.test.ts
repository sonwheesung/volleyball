import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFranchise, maxSalaryFor, clampSalary, canAfford, LEAGUE_CAP, MAX_SALARY, FRANCHISE_MAX } from './cap';
import { TRAINABLE_STATS } from './training';
import type { Player, TrainableStat } from '../types';

function mk(tenure: number): Player {
  const potential = {} as Record<TrainableStat, number>;
  for (const s of TRAINABLE_STATS) potential[s] = 90;
  const v = 80;
  return {
    id: 'x', name: 'x', age: 28, position: 'OP', isForeign: false, height: 185,
    jump: v, agility: v, staminaMax: v, staminaRegen: v, reaction: v, positioning: v,
    focus: v, consistency: v, vq: v, skSpike: v, skBlock: v, skDig: v, skReceive: v, skSet: v, skServe: v,
    xp: {}, potential, talentBase: 1, catTalent: { physical: 1, skill: 1, mental: 1 },
    contract: { salary: 50000, years: 2, remaining: 2, signedAtAge: 26 },
    clubTenure: tenure,
    peakAge: 28,
    career: { seasons: tenure, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0, assists: 0 },
  };
}

test('프랜차이즈: 근속 6시즌 이상', () => {
  assert.equal(isFranchise(mk(6)), true);
  assert.equal(isFranchise(mk(3)), false);
});

test('개인 상한: 일반 MAX, 프랜차이즈는 예외 한도', () => {
  assert.equal(maxSalaryFor(mk(2)), MAX_SALARY);
  assert.equal(maxSalaryFor(mk(8)), FRANCHISE_MAX);
  assert.equal(clampSalary(999999, mk(2)), MAX_SALARY);
  assert.equal(clampSalary(999999, mk(8)), FRANCHISE_MAX);
});

test('canAfford: 캡 안에서만, 프랜차이즈 재계약은 예외', () => {
  assert.equal(canAfford(LEAGUE_CAP - 10000, 5000), true);
  assert.equal(canAfford(LEAGUE_CAP - 10000, 20000), false);
  assert.equal(canAfford(LEAGUE_CAP - 10000, 20000, { franchise: true }), true);
});
