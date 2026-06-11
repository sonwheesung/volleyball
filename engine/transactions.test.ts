import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROSTER_MAX, ROSTER_MIN, canRelease, BETRAYAL_PREMIUM, inSeasonCost,
  STARTER_NEED, healthyByPos, shortagePositions,
} from './transactions';
import type { Player, Position } from '../types';

test('정원 하한: ROSTER_MIN 밑으로 방출 불가', () => {
  assert.equal(canRelease(ROSTER_MIN + 1), true);   // 11 → 10 허용
  assert.equal(canRelease(ROSTER_MIN), false);      // 10 → 9 차단
  assert.equal(canRelease(0), false);               // 빈 명단 방어
  assert.ok(ROSTER_MIN >= 7 + 3, '선발 7 + 동시부상 상한 3 여유');
  assert.ok(ROSTER_MIN < ROSTER_MAX);
});

test('배신 웃돈: 방출 재영입 ×1.5, 일반 영입은 원가', () => {
  assert.equal(inSeasonCost(10000, false), 10000);
  assert.equal(inSeasonCost(10000, true), 15000);
  assert.equal(inSeasonCost(33333, true), Math.round(33333 * BETRAYAL_PREMIUM));
});

test('포지션 구멍 판정: 가용 < 선발 필요', () => {
  const mk = (pos: Position): Player => ({ position: pos } as Player);
  const healthy = healthyByPos([mk('S'), mk('OH'), mk('OH'), mk('MB'), mk('L')]); // OP 0, MB 1
  const holes = shortagePositions(healthy);
  assert.deepEqual([...holes].sort(), ['MB', 'OP'].sort());
  assert.equal(STARTER_NEED.OP, 1);
});
