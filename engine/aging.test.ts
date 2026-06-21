import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from './rng';
import { applyAgingDay, ageOneSeason, FLOOR } from './aging';
import { TRAINABLE_STATS } from './training';
import type { Player, TrainableStat } from '../types';

const SEASON_DAYS = 164; // 매 캘린더일 적용, 시즌 ~164일

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
    contract: { salary: 0, years: 1, remaining: 1, signedAtAge: age },
    clubTenure: 5,
    peakAge: 28,
    career: { seasons: 0, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0, assists: 0 },
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
  assert.equal(after.staminaMax, 70);
});

test('노장(33세) 체력·근력은 한 시즌에 1~2점 하락', () => {
  const after = runSeason(makePlayer(33), 1);
  const dJump = 70 - after.jump;
  const dSta = 70 - after.staminaMax;
  assert.ok(dJump >= 1 && dJump <= 3, `jump 하락=${dJump}`);
  assert.ok(dSta >= 1 && dSta <= 3, `stamina 하락=${dSta}`);
});

test('신체만 하락(점프·민첩) — 반응/기술/VQ는 안 떨어진다', () => {
  const after = runSeason(makePlayer(36), 1); // 가장 노쇠 빠른 나이로도
  assert.ok(after.agility < 70, '민첩성 하락(신체 — CLAUDE.md 5.1)');
  assert.equal(after.reaction, 70, '반응속도 불변');
  assert.equal(after.skSpike, 70, '기술 불변');
  assert.equal(after.vq, 70, 'VQ 불변');
  assert.ok(after.jump < 70, '점프는 하락');
});

test('나이 들수록 체력·근력 하락이 가파르다', () => {
  const at30 = 70 - runSeason(makePlayer(30), 7).jump;
  const at36 = 70 - runSeason(makePlayer(36), 7).jump;
  assert.ok(at36 > at30, `30세 ${at30} vs 36세 ${at36}`);
});

test('FLOOR 아래로는 안 떨어진다', () => {
  let p = makePlayer(38, FLOOR + 1);
  for (let s = 0; s < 20; s++) p = runSeason(p, s);
  assert.ok(p.jump >= FLOOR, `jump=${p.jump}`);
});

test('결정론: 같은 시드 = 같은 결과', () => {
  const a = runSeason(makePlayer(34), 99).jump;
  const b = runSeason(makePlayer(34), 99).jump;
  assert.equal(a, b);
});

test('ageOneSeason: 시즌 경과 시 나이 +1 (스탯은 불변)', () => {
  const p = makePlayer(28);
  const next = ageOneSeason(p);
  assert.equal(next.age, 29, '나이는 매 시즌 정확히 +1');
  assert.equal(next.jump, p.jump, '스탯 변화는 일일 틱(aging/training) 몫 — ageOneSeason은 나이만');
});
