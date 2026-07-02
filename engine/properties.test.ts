// 속성 기반 테스트 (TEST_METHODOLOGY §1.I) — "입력이 무엇이든 이 속성은 참"을 시드 난수로 다수 검증.
// 고른 케이스·밟는 경로가 못 보는 입력공간의 빈 구석을 친다. 순수 함수에 단조성·범위·보존식을 건다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from './rng';
import { MED_REF, overall, overallRaw, teamOverall } from './overall';
import { LEAGUE_CAP, MAX_SALARY, FRANCHISE_MAX, clampSalary, maxSalaryFor, canAfford } from './cap';
import { computeSalary } from './salary';
import { applyAgingDay, FLOOR, DECAY_STATS } from './aging';
import { simulateMatchSimple } from './simMatch';
import { attributeProduction } from './production';
import { TRAINABLE_STATS } from './training';
import { LEAGUE } from '../data/league';
import type { Player, Position, TrainableStat } from '../types';

const POSITIONS: Position[] = ['S', 'OH', 'OP', 'MB', 'L'];
const num = (p: Player) => p as unknown as Record<string, number>; // 스탯 키 동적 접근용
const SKILLS = ['jump', 'agility', 'staminaMax', 'reaction', 'positioning', 'focus', 'consistency', 'vq', 'skSpike', 'skBlock', 'skDig', 'skReceive', 'skSet', 'skServe'] as const;

/** 시드 난수로 유효한 선수 1명 생성 — 속성 입력공간 샘플러 */
function randPlayer(seed: number): Player {
  const rng = createRng(seed);
  const r = (lo: number, hi: number) => Math.round(rng.range(lo, hi));
  const v = () => r(30, 95);
  const potential = {} as Record<TrainableStat, number>;
  for (const s of TRAINABLE_STATS) potential[s] = 99;
  return {
    id: `p${seed}`, name: 'x', age: r(17, 40), position: POSITIONS[r(0, 4)], isForeign: rng.next() < 0.15, height: r(160, 200),
    jump: v(), agility: v(), staminaMax: v(), staminaRegen: v(), reaction: v(), positioning: v(),
    focus: v(), consistency: v(), vq: v(), skSpike: v(), skBlock: v(), skDig: v(), skReceive: v(), skSet: v(), skServe: v(),
    xp: {}, potential, talentBase: 1, catTalent: { physical: 1, skill: 1, mental: 1 },
    contract: { salary: r(3000, 80000), years: r(1, 5), remaining: r(1, 5), signedAtAge: r(17, 40) },
    clubTenure: r(0, 15), peakAge: 28,
    career: { seasons: 0, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0, assists: 0 },
  };
}

test('속성: RNG는 항상 [0,1)·결정론·range는 경계 안', () => {
  for (let s = 0; s < 300; s++) {
    const a = createRng(s), b = createRng(s); // 결정론은 같은 스트림에서 lockstep
    for (let i = 0; i < 20; i++) {
      const x = a.next();
      assert.ok(x >= 0 && x < 1, `seed ${s} next=${x}`);
      assert.equal(b.next(), x, `결정론 seed ${s}`);
    }
    const c = createRng(s * 13 + 1); // range는 별도 스트림
    for (let i = 0; i < 20; i++) {
      const lo = -5 + (i % 7), hi = lo + 1 + (i % 11);
      const y = c.range(lo, hi);
      assert.ok(y >= lo && y < hi, `range ${lo}~${hi} = ${y}`);
    }
  }
});

test('속성: overall 유한·범위 + 전 스킬 상승 시 overallRaw 비감소(단조)', () => {
  for (let s = 1; s <= 300; s++) {
    const p = randPlayer(s);
    const o = overall(p);
    assert.ok(Number.isFinite(o) && o >= 0 && o <= 120, `overall=${o}`);
    const up: Player = { ...p };
    for (const k of SKILLS) num(up)[k] = Math.min(99, num(p)[k] + 4);
    assert.ok(overallRaw(up) >= overallRaw(p) - 1e-9, `단조 위반 ${overallRaw(p)}→${overallRaw(up)}`);
  }
});

test('속성: clampSalary는 min(salary, 개인상한) + 상한 절대 초과 없음', () => {
  for (let s = 1; s <= 300; s++) {
    const p = randPlayer(s);
    const sal = createRng(s * 7).range(-10000, 200000);
    const cap = maxSalaryFor(p);
    assert.equal(clampSalary(sal, p), Math.min(sal, cap), `clamp seed ${s}`);
    assert.ok(cap === MAX_SALARY || cap === FRANCHISE_MAX, '상한은 일반 또는 프랜차이즈');
    assert.ok(cap <= FRANCHISE_MAX, `개인상한 ${cap} ≤ ${FRANCHISE_MAX}`);
  }
});

test('속성: canAfford(비프랜차이즈) = payroll+salary ≤ 캡 (경계 정확)', () => {
  for (let s = 0; s < 300; s++) {
    const rng = createRng(s + 1);
    const payroll = Math.round(rng.range(0, LEAGUE_CAP));
    const salary = Math.round(rng.range(0, 100000));
    assert.equal(canAfford(payroll, salary), payroll + salary <= LEAGUE_CAP, `seed ${s}`);
    assert.equal(canAfford(payroll, salary, { franchise: true }), true, '프랜차이즈는 항상 허용');
  }
});

test('속성: computeSalary는 [최저, 프랜차이즈상한] 안 + 전성기 이후 비증가(나이 단조)', () => {
  for (let s = 1; s <= 200; s++) {
    const p = randPlayer(s);
    for (let age = 18; age <= 40; age++) {
      const sal = computeSalary(p, MED_REF, age);
      assert.ok(sal >= 3000 && sal <= FRANCHISE_MAX, `salary=${sal} (age ${age})`);
    }
    for (let age = 32; age <= 39; age++) {
      assert.ok(computeSalary(p, MED_REF, age + 1) <= computeSalary(p, MED_REF, age), `노장 단조 위반 seed ${s} age ${age}`);
    }
  }
});

test('속성: applyAgingDay — 신체만 비증가·FLOOR 하한·기술/멘탈 불변·결정론', () => {
  const KEEP = ['reaction', 'positioning', 'focus', 'consistency', 'vq', 'skSpike', 'skBlock', 'skDig', 'skReceive', 'skSet', 'skServe'] as const;
  for (let s = 1; s <= 200; s++) {
    const p = randPlayer(s);
    const a = applyAgingDay(p, createRng(s)), b = applyAgingDay(p, createRng(s));
    for (const k of DECAY_STATS) {
      assert.ok(num(a)[k] <= num(p)[k], `${k} 증가 금지`);
      if (num(p)[k] >= FLOOR) assert.ok(num(a)[k] >= FLOOR, `${k} FLOOR 하한`);
      assert.equal(num(a)[k], num(b)[k], `결정론 ${k}`);
    }
    for (const k of KEEP) assert.equal(num(a)[k], num(p)[k], `${k} 불변(신체만 노쇠)`);
  }
});

test('속성: 생산 귀속 보존 — 선수별 points == spikes+blocks+aces (전 시드)', () => {
  const home = LEAGUE.teams[0].players.map((id) => LEAGUE.players.find((p) => p.id === id)!) as Player[];
  const away = LEAGUE.teams[1].players.map((id) => LEAGUE.players.find((p) => p.id === id)!) as Player[];
  for (let seed = 1; seed <= 40; seed++) {
    const sim = simulateMatchSimple(seed, teamOverall(home), teamOverall(away));
    const prod = attributeProduction(sim, home, away, seed);
    for (const [id, l] of prod) {
      assert.equal(l.points, l.spikes + l.blocks + l.aces, `보존 위반 ${id} seed ${seed}: ${l.points}≠${l.spikes}+${l.blocks}+${l.aces}`);
      assert.ok(l.backSpikes <= l.spikes, `backSpikes≤spikes ${id}`);
      for (const k of ['points', 'spikes', 'blocks', 'aces', 'digs', 'assists', 'receives', 'matches'] as const) {
        assert.ok(Number.isFinite(l[k]) && l[k] >= 0, `${k} 음수/NaN ${id}`);
      }
    }
  }
});
