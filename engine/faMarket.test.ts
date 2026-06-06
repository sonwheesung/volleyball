import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFAEligible, assignFAGrades, askingPrice, listFreeAgents } from './faMarket';
import { TRAINABLE_STATS } from './training';
import type { Player, TrainableStat } from '../types';

function mk(id: string, seasons: number, remaining: number, salary: number): Player {
  const potential = {} as Record<TrainableStat, number>;
  for (const s of TRAINABLE_STATS) potential[s] = 90;
  const v = 70;
  return {
    id, name: id, age: 25, position: 'OH', isForeign: false, height: 180,
    jump: v, agility: v, staminaMax: v, staminaRegen: v, reaction: v, positioning: v,
    focus: v, consistency: v, vq: v, skSpike: v, skBlock: v, skDig: v, skReceive: v, skSet: v, skServe: v,
    xp: {}, potential, talentBase: 1, catTalent: { physical: 1, skill: 1, mental: 1 },
    contract: { salary, years: 3, remaining, signedAtAge: 22 },
    peakAge: 28,
    career: { seasons, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0 },
  };
}

test('자격: 6시즌 이상 + 계약 만료 임박', () => {
  assert.equal(isFAEligible(mk('a', 6, 1, 30000)), true);
  assert.equal(isFAEligible(mk('b', 5, 1, 30000)), false, '경력 부족');
  assert.equal(isFAEligible(mk('c', 8, 2, 30000)), false, '계약 잔여');
});

test('등급: 연봉 순위로 A/B/C', () => {
  const pool = [mk('hi', 8, 1, 70000), mk('mid', 8, 1, 40000), mk('lo', 8, 1, 10000)];
  const g = assignFAGrades(pool);
  assert.equal(g.get('hi'), 'A');
  assert.equal(g.get('lo'), 'C');
});

test('요구연봉: 등급 프리미엄 A>B>C', () => {
  assert.ok(askingPrice(40000, 'A') > askingPrice(40000, 'B'));
  assert.ok(askingPrice(40000, 'B') > askingPrice(40000, 'C'));
});

test('listFreeAgents: 자격자만 + 등급 부여', () => {
  const players = [mk('a', 8, 1, 50000), mk('b', 3, 1, 50000), mk('c', 8, 1, 20000)];
  const fas = listFreeAgents(players);
  assert.equal(fas.length, 2);
  assert.ok(fas.every((f) => f.grade));
});
