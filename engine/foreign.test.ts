import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tryoutOrder, resolveTryout, aiForeignChoice, FOREIGN_SALARY, ALT_POOL_SIZE } from './foreign';
import { generateForeignPool } from '../data/tryout';
import { overall } from './overall';

test('트라이아웃 순번: 추첨 결정론 + 전 팀 포함', () => {
  const ids = ['t1', 't2', 't3', 't4', 't5', 't6', 't7'];
  const o1 = tryoutOrder(3, ids);
  assert.deepEqual(o1, tryoutOrder(3, ids));             // 결정론
  assert.deepEqual([...o1].sort(), [...ids].sort());     // 전 팀
  assert.notDeepEqual(tryoutOrder(3, ids), tryoutOrder(4, ids)); // 시즌마다 다른 추첨
});

test('외인 풀: 국내 평균 그 이상 보장(바닥) + OP 중심 + 1년 계약', () => {
  const pool = generateForeignPool(5, 70);
  assert.equal(pool.length, 10);
  for (const p of pool) {
    assert.ok(p.isForeign);
    assert.ok(overall(p) >= 72, `외인 ${p.name} OVR ${overall(p)} < 국내평균+2`);
    assert.equal(p.contract.salary, FOREIGN_SALARY);
    assert.equal(p.contract.remaining, 1);
  }
  assert.ok(pool.filter((p) => p.position === 'OP').length >= 6, 'OP 중심');
  assert.deepEqual(pool.map((p) => p.id), generateForeignPool(5, 70).map((p) => p.id)); // 결정론
});

test('지명 해석: 팀당 1명 · 내 위시 우선 · 뺏기면 차순위 · 대체 풀', () => {
  const pool = generateForeignPool(7, 70);
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const order = tryoutOrder(7, ids);
  const my = order[order.length - 1]; // 내가 마지막 순번 — 위시 1순위는 뺏길 수 있다
  const best = [...pool].sort((x, y) => overall(y) - overall(x));
  const res = resolveTryout(order, pool, my, [best[0].id, best[best.length - 1].id], 7);
  assert.equal(Object.keys(res.picks).length, 7);                       // 전 팀 1명씩
  assert.equal(new Set(Object.values(res.picks)).size, 7);              // 중복 지명 없음
  assert.equal(res.altPoolIds.length, Math.min(ALT_POOL_SIZE, 3));      // 10-7=3 미지명 → 대체 풀
  // 내 픽: 위시 1순위가 남아 있으면 그 선수, 아니면 차순위(최약체) — 어느 쪽이든 위시 안에서
  assert.ok([best[0].id, best[best.length - 1].id].includes(res.picks[my]));
});

test('AI 지명: 결정론 + 대체로 강한 선수를 고른다(안개 허용)', () => {
  const pool = generateForeignPool(9, 70);
  const pick = aiForeignChoice(pool, 9, 'tX');
  assert.equal(pick?.id, aiForeignChoice(pool, 9, 'tX')?.id);
  const rank = [...pool].sort((a, b) => overall(b) - overall(a)).findIndex((p) => p.id === pick?.id);
  assert.ok(rank <= 3, `AI 픽이 ${rank + 1}위 — 안개를 감안해도 너무 약함`);
});
