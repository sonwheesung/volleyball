import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsCompensationPlayer, compensationMoney, pickCompensation } from './compensation';
import { TRAINABLE_STATS } from './training';
import type { Player, Position, TrainableStat } from '../types';

function mk(id: string, v: number, pos: Position = 'OH'): Player {
  const potential = {} as Record<TrainableStat, number>;
  for (const s of TRAINABLE_STATS) potential[s] = 99;
  return {
    id, name: id, age: 26, position: pos, isForeign: false, height: 180,
    jump: v, agility: v, staminaMax: v, staminaRegen: v, reaction: v, positioning: v,
    focus: v, consistency: v, vq: v, skSpike: v, skBlock: v, skDig: v, skReceive: v, skSet: v, skServe: v,
    xp: {}, potential, talentBase: 1, catTalent: { physical: 1, skill: 1, mental: 1 },
    contract: { salary: 30000, years: 2, remaining: 2, signedAtAge: 24 },
    peakAge: 28,
    career: { seasons: 5, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0 },
  };
}

test('A·B는 보상선수 필요, C는 없음', () => {
  assert.equal(needsCompensationPlayer('A'), true);
  assert.equal(needsCompensationPlayer('B'), true);
  assert.equal(needsCompensationPlayer('C'), false);
});

test('보상금: A 200% > B 100% > C 0', () => {
  assert.equal(compensationMoney('A', 10000), 20000);
  assert.equal(compensationMoney('B', 10000), 10000);
  assert.equal(compensationMoney('C', 10000), 0);
});

test('보상선수: 비보호 중 최고 OVR, 보호/이미선택 제외', () => {
  const snap: Record<string, Player> = {
    star: mk('star', 95), mid: mk('mid', 75), low: mk('low', 60),
  };
  const roster = ['star', 'mid', 'low'];
  // star 보호 → mid 지명
  assert.equal(pickCompensation(roster, ['star'], snap, []), 'mid');
  // 보호 없음 → star 지명
  assert.equal(pickCompensation(roster, [], snap, []), 'star');
  // star 이미 선택 → mid
  assert.equal(pickCompensation(roster, [], snap, ['star']), 'mid');
  // 전부 보호 → 없음
  assert.equal(pickCompensation(roster, ['star', 'mid', 'low'], snap, []), null);
});
