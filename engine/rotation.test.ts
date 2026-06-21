// 로테이션 규칙 단위 테스트 (변이 테스트 §1.G 공백 보강 — rotate/frontRow/backRow 미검증이었음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rotate, frontRow, backRow, serverIndex, isFrontRow } from './rotation';

test('rotate: 사이드아웃 시 시계방향 1칸(0→1, 4→5, 5→0)', () => {
  assert.equal(rotate(0), 1);
  assert.equal(rotate(4), 5);
  assert.equal(rotate(5), 0); // 한 바퀴 순환
});

test('frontRow: 전위 3슬롯 = zone 2·3·4 시프트', () => {
  assert.deepEqual(frontRow(0), [1, 2, 3]);
  assert.deepEqual(frontRow(5), [0, 1, 2]);
});

test('backRow: 후위 3슬롯 = zone 1(서버)·5·6', () => {
  assert.deepEqual(backRow(0), [0, 4, 5]);
  assert.deepEqual(backRow(1), [1, 5, 0]);
});

test('serverIndex = zone1 = rotation % 6', () => {
  assert.equal(serverIndex(0), 0);
  assert.equal(serverIndex(5), 5);
});

test('전위/후위 분리: 6슬롯 전수 커버 + 서버는 후위', () => {
  for (let r = 0; r < 6; r++) {
    const f = new Set(frontRow(r)), b = new Set(backRow(r));
    assert.equal(f.size, 3, `전위 3명 (r=${r})`);
    assert.equal(b.size, 3, `후위 3명 (r=${r})`);
    for (const i of f) assert.ok(!b.has(i), `슬롯 ${i} 전후위 중복 (r=${r})`);
    assert.equal(new Set([...f, ...b]).size, 6, `6슬롯 전수 (r=${r})`);
    assert.equal(isFrontRow(r, frontRow(r)[0]), true, `전위 슬롯 판정 (r=${r})`);
    assert.equal(isFrontRow(r, serverIndex(r)), false, `서버(zone1)는 후위 (r=${r})`);
  }
});
