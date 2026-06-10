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

test('rollTraits: 대부분 0개, 최대 2개, 중복 없음', () => {
  let none = 0, one = 0, two = 0;
  for (let i = 0; i < 2000; i++) {
    const ts = rollTraits('player' + i);
    assert.ok(ts.length <= 2);
    assert.equal(new Set(ts).size, ts.length, '중복 없음');
    for (const t of ts) assert.ok(TRAITS[t], '카탈로그에 존재');
    if (ts.length === 0) none++; else if (ts.length === 1) one++; else two++;
  }
  assert.ok(none > one && one > two, `희소성: 무(${none}) > 1개(${one}) > 2개(${two})`);
  assert.ok(none / 2000 > 0.4, '대부분 무특성');
});

test('rollTraits: 부정 특성도 등장(도박 성립)', () => {
  const bad = new Set<Trait>(['choke', 'earlyDecline', 'glass']);
  let found = 0;
  for (let i = 0; i < 3000; i++) if (rollTraits('q' + i).some((t) => bad.has(t))) found++;
  assert.ok(found > 0, '부정 특성이 일부 선수에 존재');
});

test('노쇠 배수: 대기만성<1, 조로>1, 무특성=1', () => {
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
