import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsCompensationPlayer, compensationMoney, compensationMoneyOnly, pickCompensation } from './compensation';
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
    clubTenure: 5,
    peakAge: 28,
    career: { seasons: 5, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0, assists: 0 },
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

test("'돈만' 보상금: A 300% > B 200% > C 0 (보상선수 동반보다 1배 가중)", () => {
  assert.equal(compensationMoneyOnly('A', 10000), 30000);
  assert.equal(compensationMoneyOnly('B', 10000), 20000);
  assert.equal(compensationMoneyOnly('C', 10000), 0);
  // 보상선수 면제 대가 — 항상 동반 보상금보다 높다
  assert.ok(compensationMoneyOnly('A', 10000) > compensationMoney('A', 10000));
  assert.ok(compensationMoneyOnly('B', 10000) > compensationMoney('B', 10000));
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

test('이번 오프시즌 영입 FA는 보상선수 대상 제외(이중 배정 방지)', () => {
  // star = 방금 영입한 FA(signedByMe). 최고 OVR이라도 exclude면 넘어가지 않는다.
  const snap: Record<string, Player> = {
    star: mk('star', 95), mid: mk('mid', 75), low: mk('low', 60),
  };
  const roster = ['star', 'mid', 'low'];
  const signedByMe = ['star'];
  assert.equal(pickCompensation(roster, [], snap, [...signedByMe]), 'mid');
});

test('외국인은 보상선수 대상 제외(받는 팀 외인 2명 방지)', () => {
  // 외인 OP가 최고 OVR이라도 보상으로 넘어가지 않는다 — 1년 트라이아웃·팀당 1명 슬롯.
  const fgn = mk('fgn', 95, 'OP'); fgn.isForeign = true;
  const snap: Record<string, Player> = { fgn, mid: mk('mid', 75), low: mk('low', 60) };
  const roster = ['fgn', 'mid', 'low'];
  assert.equal(pickCompensation(roster, [], snap, []), 'mid'); // 외인 건너뛰고 차순위
  // 외인만 있으면 보상 없음(null)
  assert.equal(pickCompensation(['fgn'], [], snap, []), null);
});
