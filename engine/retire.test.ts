import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from './rng';
import { retireChance, applyRetirements } from './retire';
import { TRAINABLE_STATS } from './training';
import { fillRosters } from '../data/rookies';
import type { Player, Position, TrainableStat } from '../types';

function mk(id: string, age: number, pos: Position = 'OH', v = 70): Player {
  const potential = {} as Record<TrainableStat, number>;
  for (const s of TRAINABLE_STATS) potential[s] = 90;
  return {
    id, name: id, age, position: pos, isForeign: false, height: 180,
    jump: v, agility: v, staminaMax: v, staminaRegen: v, reaction: v, positioning: v,
    focus: v, consistency: v, vq: v, skSpike: v, skBlock: v, skDig: v, skReceive: v, skSet: v, skServe: v,
    xp: {}, potential, talentBase: 1, catTalent: { physical: 1, skill: 1, mental: 1 },
    contract: { salary: 10000, years: 1, remaining: 1, signedAtAge: age },
    clubTenure: 5,
    peakAge: 28,
    career: { seasons: 0, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0 },
  };
}

test('은퇴 확률: 젊으면 0, 나이 들수록 증가', () => {
  assert.equal(retireChance(25, 80), 0);
  assert.ok(retireChance(37, 80) > retireChance(33, 80));
  assert.ok(retireChance(40, 90) >= 0.95);
});

test('같은 나이면 저능력이 더 빨리 은퇴', () => {
  assert.ok(retireChance(33, 60) > retireChance(33, 80));
});

test('applyRetirements: 전원 젊으면 아무도 은퇴 안 함', () => {
  const snap: Record<string, Player> = { a: mk('a', 24), b: mk('b', 25) };
  const res = applyRetirements({ t: ['a', 'b'] }, snap, createRng(1));
  assert.equal(res.retired.length, 0);
  assert.deepEqual(res.rosters.t, ['a', 'b']);
});

test('applyRetirements: 노장은 일부 은퇴 + 결정론', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const snap: Record<string, Player> = {
    a: mk('a', 38), b: mk('b', 39, 'OH', 55), c: mk('c', 41), d: mk('d', 37),
  };
  const a = applyRetirements({ t: ids }, snap, createRng(5));
  const b = applyRetirements({ t: ids }, snap, createRng(5));
  assert.deepEqual(a, b, '결정론');
  assert.ok(a.retired.length > 0, '노장 일부 은퇴');
});

test('fillRosters: 빈 자리를 신인(18~20세)으로 16인까지 채움', () => {
  const reg: Record<string, Player> = { a: mk('a', 24, 'S'), b: mk('b', 25, 'OH') };
  const r1 = fillRosters({ t: ['a', 'b'] }, (id) => reg[id], 1);
  assert.equal(r1.rosters.t.length, 16);
  for (const p of r1.newPlayers) {
    assert.ok(p.age >= 18 && p.age <= 20);
    assert.equal(p.isForeign, false);
  }
  const r2 = fillRosters({ t: ['a', 'b'] }, (id) => reg[id], 1);
  assert.deepEqual(r1.newPlayers, r2.newPlayers, '결정론');
});
