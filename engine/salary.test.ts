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
    career: { seasons: 0, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0, assists: 0 },
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

test('루키 할인은 점진(하드 캡 절벽 없음) — 능력은 반영', () => {
  const star = buildP({ skSpike: 95, skServe: 95, jump: 95 });
  const scrub = buildP({ skSpike: 50, skBlock: 50, skDig: 50, skReceive: 50, skSet: 50, skServe: 50, jump: 50 });
  // 어린 서명은 전성기보다 싸다(할인)
  assert.ok(computeSalary(star, 20) < computeSalary(star, 27), '루키 서명 < 전성기 서명');
  // 절벽 없음: 고능력 루키가 저능력 루키보다 많이 받는다(하드 캡이면 둘 다 6000으로 동일했음)
  assert.ok(computeSalary(star, 20) > computeSalary(scrub, 20) * 1.3, '루키도 능력 반영');
});

test('외국인 프리미엄', () => {
  const dom = buildP();
  const foreign = buildP({ isForeign: true });
  assert.ok(computeSalary(foreign, 27) > computeSalary(dom, 27), '외국인이 더 높음');
});

test('contractStatus: 연봉/시장가치 비율로 평가', () => {
  assert.equal(contractStatus(50, 100), '저평가');
  assert.equal(contractStatus(100, 100), '적정');
  assert.equal(contractStatus(200, 100), '고평가');
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
