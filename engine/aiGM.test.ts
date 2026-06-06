import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiKeepsFA, aiFillFromPool } from './aiGM';
import { TRAINABLE_STATS } from './training';
import type { Player, Position, TrainableStat } from '../types';

function mk(id: string, age: number, pos: Position, v = 75): Player {
  const potential = {} as Record<TrainableStat, number>;
  for (const s of TRAINABLE_STATS) potential[s] = 90;
  return {
    id, name: id, age, position: pos, isForeign: false, height: 180,
    jump: v, agility: v, staminaMax: v, staminaRegen: v, reaction: v, positioning: v,
    focus: v, consistency: v, vq: v, skSpike: v, skBlock: v, skDig: v, skReceive: v, skSet: v, skServe: v,
    xp: {}, potential, talentBase: 1, catTalent: { physical: 1, skill: 1, mental: 1 },
    contract: { salary: 30000, years: 2, remaining: 0, signedAtAge: age },
    peakAge: 28,
    career: { seasons: 8, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0 },
  };
}

test('aiKeepsFA: 어리고 잘하면 잔류, 늙거나 약하면 포기', () => {
  assert.equal(aiKeepsFA(mk('a', 27, 'OH', 80)), true);
  assert.equal(aiKeepsFA(mk('b', 33, 'OH', 80)), false, '노장 포기');
  assert.equal(aiKeepsFA(mk('c', 27, 'OH', 60)), false, '약체 포기');
});

test('aiFillFromPool: AI팀 빈 포지션을 풀의 OVR 높은 순으로 채우고, 내 팀은 건드리지 않음', () => {
  const snapshot: Record<string, Player> = {
    o1: mk('o1', 24, 'OH', 90), o2: mk('o2', 24, 'OH', 70), keepS: mk('keepS', 24, 'S', 80),
  };
  // AI팀(ai)은 OH 0명 → 풀에서 OH 채움. 내팀(me)은 그대로.
  const rosters = { ai: ['keepS'], me: [] as string[] };
  const res = aiFillFromPool(rosters, ['o1', 'o2'], snapshot, 'me');
  assert.ok(res.rosters.ai.includes('o1'), 'OVR 높은 o1 우선 영입');
  assert.deepEqual(res.rosters.me, [], '내 팀은 AI가 안 건드림');
  // OH 5명 필요 → o1,o2 둘 다 들어감
  assert.ok(res.rosters.ai.includes('o2'));
  assert.equal(res.remaining.length, 0);
});
