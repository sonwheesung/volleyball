import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rolloverPlayer, maybeBreakthrough } from './rollover';
import { MED_REF } from './overall'; // 시대 앵커(SALARY 2장) — 단위테스트는 시대 0
import { TRAINABLE_STATS } from './training';
import type { Player, Position, TrainableStat, TrainingFocus } from '../types';

function makePlayer(age: number, opts: { remaining?: number; skSpike?: number; jump?: number; pos?: Position; seasons?: number } = {}): Player {
  const potential = {} as Record<TrainableStat, number>;
  for (const s of TRAINABLE_STATS) potential[s] = 92;
  const v = 60;
  return {
    id: 'x', name: 'x', age, position: opts.pos ?? 'OH', isForeign: false, height: 180,
    jump: opts.jump ?? v, agility: v, staminaMax: v, staminaRegen: v, reaction: v, positioning: v,
    focus: v, consistency: v, vq: v,
    skSpike: opts.skSpike ?? v, skBlock: v, skDig: v, skReceive: v, skSet: v, skServe: v,
    xp: {}, potential, talentBase: 1.2, catTalent: { physical: 1, skill: 1, mental: 1 },
    contract: { salary: 30000, years: 3, remaining: opts.remaining ?? 3, signedAtAge: age },
    clubTenure: 5,
    peakAge: 28,
    career: { seasons: opts.seasons ?? 0, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0, assists: 0 },
  };
}

const FOCUS: TrainingFocus = { primary: [4, 1], secondary: [6, 7, 8] }; // 공격+웨이트

test('롤오버는 나이를 +1 한다', () => {
  const after = rolloverPlayer(makePlayer(24), FOCUS, MED_REF);
  assert.equal(after.age, 25);
});

test('결정론: 같은 입력 = 같은 결과', () => {
  const a = rolloverPlayer(makePlayer(24), FOCUS, MED_REF);
  const b = rolloverPlayer(makePlayer(24), FOCUS, MED_REF);
  assert.deepEqual(a, b);
});

test('계약 잔여가 1년 줄고, 만료 시 자동 재계약', () => {
  const dec = rolloverPlayer(makePlayer(24, { remaining: 3 }), FOCUS, MED_REF);
  assert.equal(dec.contract.remaining, 2);
  const renew = rolloverPlayer(makePlayer(24, { remaining: 1 }), FOCUS, MED_REF);
  assert.ok(renew.contract.remaining >= 2, '만료 → 재계약 연수');
  assert.equal(renew.contract.signedAtAge, 25, '새 나이로 서명');
});

test('FA 자격자는 만료 시 자동연장 안 됨(FA 공시), 영건은 자동연장', () => {
  const fa = rolloverPlayer(makePlayer(28, { remaining: 1, seasons: 8 }), FOCUS, MED_REF);
  assert.equal(fa.contract.remaining, 0, 'FA = 미계약 만료');
  const young = rolloverPlayer(makePlayer(22, { remaining: 1, seasons: 2 }), FOCUS, MED_REF);
  assert.ok(young.contract.remaining >= 2, '영건 자동연장');
});

test('여러 시즌: 어린 선수는 핵심 스탯이 성장한다', () => {
  let p = makePlayer(19, { skSpike: 60 });
  for (let s = 0; s < 3; s++) p = rolloverPlayer(p, FOCUS, MED_REF);
  assert.equal(p.age, 22);
  assert.ok(p.skSpike > 60, `skSpike ${p.skSpike}`);
});

test('여러 시즌: 노장은 체력·근력이 하락한다', () => {
  let p = makePlayer(33, { jump: 75 });
  for (let s = 0; s < 3; s++) p = rolloverPlayer(p, FOCUS, MED_REF);
  assert.equal(p.age, 36);
  assert.ok(p.jump < 75, `jump ${p.jump}`);
});

test('maybeBreakthrough: 돌파 발생 시 스탯 증가폭 ≤ 6 (성장 상한 — 절제)', () => {
  let fired = false;
  for (let s = 0; s < 400 && !fired; s++) {
    const p = makePlayer(20, { seasons: s }); // 영건 + 헤드룸 큼(92−60)
    const r = maybeBreakthrough(p);
    if (r === p) continue; // 미발생(같은 참조)
    fired = true;
    for (const k of TRAINABLE_STATS) {
      const d = (r as unknown as Record<string, number>)[k] - (p as unknown as Record<string, number>)[k];
      if (d !== 0) assert.ok(d > 0 && d <= 6, `${k} 증가폭 ${d} (≤6이어야 — 상한)`);
    }
  }
  assert.ok(fired, '400 시즌 내 돌파 표본 확보 실패');
});
