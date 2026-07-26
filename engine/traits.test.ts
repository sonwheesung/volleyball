import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rollTraits, TRAITS, agingTraitMult, trainTraitMult, injuryTraitMult, clutchFocusAdj, serveAggrAdj,
} from './traits';
import type { Trait } from '../types';

test('rollTraits: 같은 id = 같은 특성(결정론)', () => {
  for (const id of ['p1', 's3r7', 'abc']) {
    assert.deepEqual(rollTraits(id), rollTraits(id));
  }
});

test('rollTraits: 전원 1~3개, 중복·상극 없음', () => {
  let one = 0, two = 0, three = 0;
  for (let i = 0; i < 3000; i++) {
    const ts = rollTraits('player' + i);
    assert.ok(ts.length >= 1 && ts.length <= 3, `1~3개 (실제 ${ts.length})`);
    assert.equal(new Set(ts).size, ts.length, '중복 없음');
    for (const t of ts) assert.ok(TRAITS[t], '카탈로그에 존재');
    if (ts.includes('clutch') || ts.includes('bigGame')) assert.ok(!ts.includes('choke'), '멘탈 상극 금지');
    if (ts.includes('lateBloomer')) assert.ok(!ts.includes('earlyDecline'), '성장 상극 금지');
    if (ts.includes('iron')) assert.ok(!ts.includes('glass'), '내구 상극 금지');
    if (ts.length === 1) one++; else if (ts.length === 2) two++; else three++;
  }
  assert.equal(one + two + three, 3000, '전원 특성 보유');
  assert.ok(one > two && two > three, `희소성: 1개(${one}) > 2개(${two}) > 3개(${three})`);
});

test('rollTraits: 부정 특성도 등장(도박 성립)', () => {
  const bad = new Set<Trait>(['choke', 'earlyDecline', 'glass']);
  let found = 0;
  for (let i = 0; i < 3000; i++) if (rollTraits('q' + i).some((t) => bad.has(t))) found++;
  assert.ok(found > 0, '부정 특성이 일부 선수에 존재');
});

test('노쇠 배수: 대기만성<1, 짧은전성기>1, 무특성=1', () => {
  assert.ok(agingTraitMult(['lateBloomer']) < 1);
  assert.ok(agingTraitMult(['earlyDecline']) > 1);
  assert.equal(agingTraitMult(undefined), 1);
  assert.equal(agingTraitMult([]), 1);
});

test('훈련 배수: 노력형>1, 그 외=1', () => {
  assert.ok(trainTraitMult(['diligent']) > 1);
  assert.equal(trainTraitMult(['clutch']), 1);
  assert.equal(trainTraitMult(undefined), 1);
});

test('부상 배수: 유리몸>1, 철강<1', () => {
  assert.ok(injuryTraitMult(['glass']) > 1);
  assert.ok(injuryTraitMult(['iron']) < 1);
  assert.equal(injuryTraitMult(undefined), 1);
});

test('클러치 보정: 클러치+, 새가슴-, 무특성 0', () => {
  assert.ok(clutchFocusAdj(['clutch']) > 0);
  assert.ok(clutchFocusAdj(['choke']) < 0);
  assert.equal(clutchFocusAdj(undefined), 0);
  assert.equal(clutchFocusAdj(['iron']), 0);
});

test('서브 공격성: 서브머신+, 그 외 0', () => {
  assert.ok(serveAggrAdj(['serveMachine']) > 0);
  assert.equal(serveAggrAdj(undefined), 0);
});
