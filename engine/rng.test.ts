import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from './rng';

test('같은 시드는 같은 수열을 만든다 (결정론)', () => {
  const a = createRng(12345);
  const b = createRng(12345);
  for (let i = 0; i < 100; i++) {
    assert.equal(a.next(), b.next());
  }
});

test('다른 시드는 다른 수열을 만든다', () => {
  const a = createRng(1);
  const b = createRng(2);
  assert.notEqual(a.next(), b.next());
});

test('next()는 [0, 1) 범위', () => {
  const r = createRng(42);
  for (let i = 0; i < 1000; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test('int(min, max)는 경계 포함 정수', () => {
  const r = createRng(7);
  const seen = new Set<number>();
  for (let i = 0; i < 5000; i++) {
    const v = r.int(1, 6);
    assert.ok(Number.isInteger(v));
    assert.ok(v >= 1 && v <= 6);
    seen.add(v);
  }
  assert.equal(seen.size, 6, '1..6 모두 등장해야 함');
});

test('chance(p)는 대략 p 비율로 true', () => {
  const r = createRng(99);
  let hits = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) if (r.chance(0.3)) hits++;
  const ratio = hits / n;
  assert.ok(Math.abs(ratio - 0.3) < 0.02, `ratio=${ratio}`);
});
