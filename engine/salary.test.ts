import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSalary, marketValue, contractStatus, formatMoney } from './salary';
import { TRAINABLE_STATS } from './training';
import type { Player, Position, TrainableStat } from '../types';

function buildP(over: Partial<Player> = {}): Player {
  const potential = {} as Record<TrainableStat, number>;
  for (const s of TRAINABLE_STATS) potential[s] = 90;
  const v = 75;
  return {
    id: 'x', name: 'x', age: 27, position: 'OH' as Position, isForeign: false, height: 180,
    jump: v, agility: v, staminaMax: v, staminaRegen: v, reaction: v, positioning: v,
    focus: v, consistency: v, vq: v, skSpike: v, skBlock: v, skDig: v, skReceive: v, skSet: v, skServe: v,
    xp: {}, potential, talentBase: 1, catTalent: { physical: 1, skill: 1, mental: 1 },
    contract: { salary: 0, years: 2, remaining: 1, signedAtAge: 27 },
    clubTenure: 5,
    peakAge: 28,
    career: { seasons: 0, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0 },
    ...over,
  };
}

test('결정론: 난수 없이 같은 입력 = 같은 연봉', () => {
  const p = buildP();
  assert.equal(computeSalary(p, 27), computeSalary(p, 27));
});

test('OVR≠연봉: 같은 능력도 신인 서명(19) ≪ 전성기 서명(27)', () => {
  const p = buildP();
  const rookie = computeSalary(p, 19);
  const prime = computeSalary(p, 27);
  assert.ok(prime > rookie * 1.5, `prime=${prime} rookie=${rookie}`);
});

test('루키스케일: 어린 나이 서명은 상한(0.6억) 이하', () => {
  const star = buildP({ skSpike: 95, skServe: 95, jump: 95 }); // 고능력이어도
  assert.ok(computeSalary(star, 20) <= 6000, `rookie salary=${computeSalary(star, 20)}`);
});

test('외국인 프리미엄', () => {
  const dom = buildP();
  const foreign = buildP({ isForeign: true });
  assert.ok(computeSalary(foreign, 27) > computeSalary(dom, 27), '외국인이 더 높음');
});

test('contractStatus: 연봉/시장가치 비율로 평가', () => {
  assert.equal(contractStatus(50, 100), '꿀계약');
  assert.equal(contractStatus(100, 100), '적정');
  assert.equal(contractStatus(200, 100), '고연봉');
});

test('marketValue는 양수, 결정론', () => {
  const p = buildP();
  const m = marketValue(p);
  assert.ok(m > 0);
  assert.equal(m, marketValue(p));
});

test('formatMoney 표기', () => {
  assert.equal(formatMoney(32000), '3.2억');
  assert.equal(formatMoney(5000), '5000만');
});
