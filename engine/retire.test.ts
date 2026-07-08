import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from './rng';
import { retireChance, applyRetirements, RETIRE_AGE, capContractYears, RETIRE_PARAMS } from './retire';
import { TRAINABLE_STATS } from './training';
import { fillRosters } from '../data/rookies';
import type { Player, Position, TrainableStat } from '../types';

const MED = 66; // 시대 앵커(측정 기준값)

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
    career: { seasons: 0, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0, assists: 0 },
  };
}

test('은퇴 확률: 젊으면 0, 나이 들수록 증가, 40세 정년=1', () => {
  assert.equal(retireChance(25, 80, MED), 0);
  // 저OVR(HIGH 미만)은 나이 많을수록 확률 증가
  assert.ok(retireChance(37, 62, MED) > retireChance(33, 62, MED));
  assert.equal(retireChance(RETIRE_AGE, 90, MED), 1, '40세 무조건 은퇴(정년 하드월)');
  assert.equal(retireChance(41, 60, MED), 1);
});

test('HIGH(medOvr+δ) 이상은 은퇴 확률 정확히 0 (기량 지키면 39세까지)', () => {
  const HIGH = MED + RETIRE_PARAMS.highDelta;
  for (const age of [30, 33, 37, 39]) {
    assert.equal(retireChance(age, HIGH, MED), 0, `${age}세 HIGH 이상 0`);
    assert.equal(retireChance(age, HIGH + 5, MED), 0);
    assert.ok(retireChance(age, HIGH - 2, MED) > 0, `${age}세 HIGH 미만은 >0`);
  }
});

test('OVR 1점 차이가 항상 확률을 바꾼다 (절벽 금지 — 전지훈련 유효)', () => {
  for (const age of [31, 35, 39]) {
    for (let ovr = 50; ovr < MED + 5; ovr++) {
      const hi = retireChance(age, ovr, MED);        // 낮은 OVR
      const lo = retireChance(age, ovr + 1, MED);    // +1 OVR
      // HIGH 미만 구간에서 +1 OVR은 확률을 낮춘다(엄격 감소) — cap에 닿지 않는 한
      if (hi < 0.97 && hi > 0) assert.ok(lo < hi, `${age}세 ovr${ovr}: +1이 확률을 낮춰야(${hi}→${lo})`);
    }
  }
});

test('같은 나이면 저능력이 더 빨리 은퇴', () => {
  assert.ok(retireChance(33, 58, MED) > retireChance(33, 66, MED));
});

test('applyRetirements: 전원 젊으면 아무도 은퇴 안 함', () => {
  const snap: Record<string, Player> = { a: mk('a', 24), b: mk('b', 25) };
  const res = applyRetirements({ t: ['a', 'b'] }, snap, createRng(1), MED);
  assert.equal(res.retired.length, 0);
  assert.deepEqual(res.rosters.t, ['a', 'b']);
});

test('applyRetirements: 노장은 일부 은퇴 + 결정론', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const snap: Record<string, Player> = {
    a: mk('a', 38, 'OH', 58), b: mk('b', 39, 'OH', 55), c: mk('c', 41), d: mk('d', 37, 'OH', 58),
  };
  const a = applyRetirements({ t: ids }, snap, createRng(5), MED);
  const b = applyRetirements({ t: ids }, snap, createRng(5), MED);
  assert.deepEqual(a, b, '결정론');
  assert.ok(a.retired.length > 0, '노장 일부 은퇴');
});

test('applyRetirements: 40세+는 전원 은퇴(정년 하드월)', () => {
  const snap: Record<string, Player> = { a: mk('a', 40, 'OH', 99), b: mk('b', 42, 'S', 90) };
  const res = applyRetirements({ t: ['a', 'b'] }, snap, createRng(7), MED);
  assert.deepEqual([...res.retired].sort(), ['a', 'b'], '고OVR라도 40세면 은퇴');
});

test('applyRetirements: 외국인은 은퇴 루프 제외(rng 미소비 — 국내 스트림 불변)', () => {
  const dom = mk('d', 38, 'OH', 58);
  const foreign = { ...mk('f', 41, 'OP', 90), isForeign: true };
  // 외인이 앞에 있어도 국내 선수 판정은 동일해야(외인 rng 미소비)
  const withF = applyRetirements({ t: ['f', 'd'] }, { d: dom, f: foreign }, createRng(9), MED);
  const noF = applyRetirements({ t: ['d'] }, { d: dom }, createRng(9), MED);
  assert.deepEqual(withF.retired.filter((x) => x !== 'f'), noF.retired, '외인 유무가 국내 판정 불변');
  assert.ok(withF.rosters.t.includes('f'), '외인은 로스터 유지(하류 트라이아웃 분리)');
  assert.ok(!withF.retired.includes('f'), '외인은 은퇴자 목록 비포함(40세+라도)');
});

test('capContractYears: 정년(40) 초과 연한 차단, 최소 1', () => {
  assert.equal(capContractYears(37, 2), 2);   // 37세: 37,38,39 → 최대 3, 2 그대로
  assert.equal(capContractYears(38, 2), 2);   // 38세: 38,39 → 최대 2
  assert.equal(capContractYears(39, 3), 1);   // 39세: 39만 → 1
  assert.equal(capContractYears(40, 2), 1);   // 정년: 최소 1(음수/0 방지)
  assert.equal(capContractYears(25, 3), 3);   // 젊으면 무영향
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
