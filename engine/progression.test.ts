import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evolvePlayer } from './progression';
import { overall } from './overall';
import { TRAINABLE_STATS } from './training';
import type { Player, Position, TrainableStat } from '../types';

const F = { primary: [4, 6] as [number, number], secondary: [1, 10, 12] as number[] };

function mk(age: number, sk: number, pos: Position = 'OH'): Player {
  const pot = {} as Record<TrainableStat, number>;
  for (const s of TRAINABLE_STATS) pot[s] = 99;
  return {
    id: 'p1', name: 'p1', age, position: pos, isForeign: false, height: 185,
    jump: 72, agility: 72, staminaMax: 72, staminaRegen: 72, reaction: 72, positioning: 72,
    focus: 72, consistency: 72, vq: 72,
    skSpike: sk, skBlock: sk, skDig: sk, skReceive: sk, skSet: sk, skServe: sk,
    xp: {}, potential: pot, talentBase: 1.5, catTalent: { physical: 1.5, skill: 1.5, mental: 1.5 },
    contract: { salary: 30000, years: 2, remaining: 2, signedAtAge: age - 1 },
    clubTenure: 1, peakAge: 27,
    career: { seasons: 1, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0 },
  };
}

test('출장정지(skipTrainDays) — 유망주 성장 정체(정지 길수록 덜 큰다)', () => {
  const young = mk(19, 55);
  const full = evolvePlayer(young, F, 164, undefined, 0);
  const dui = evolvePlayer(young, F, 164, undefined, 72);   // 음주 18경기 ≈ 72일
  const gam = evolvePlayer(young, F, 164, undefined, 116);  // 도박 30경기 ≈ 116일
  // 정지가 길수록 성장이 적다(단조)
  assert.ok(overall(full) > overall(dui), `full ${overall(full)} > dui ${overall(dui)}`);
  assert.ok(overall(dui) > overall(gam), `dui ${overall(dui)} > gam ${overall(gam)}`);
  assert.ok(full.skSpike > gam.skSpike);
});

test('노장은 정지 중 노쇠만 진행 → 순하락(훈련 유지 없음)', () => {
  const old = mk(35, 82);
  const full = evolvePlayer(old, F, 164, undefined, 0);
  const gam = evolvePlayer(old, F, 164, undefined, 116);
  // 정지 노장은 정상 진화보다 낮다(노쇠는 멈추지 않으므로)
  assert.ok(overall(gam) <= overall(full), `gam ${overall(gam)} <= full ${overall(full)}`);
});

test('skipTrainDays=0 은 기존과 바이트 동일(무사고 선수 불변 — 결정론 보존)', () => {
  const p = mk(24, 70);
  const a = evolvePlayer(p, F, 164, undefined, 0);
  const b = evolvePlayer(p, F, 164);            // skip 미지정(기본 0)
  assert.deepEqual(a, b);
});
