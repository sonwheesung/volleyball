import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossedThresholds, personalMilestones, passedValues, CAREER_THRESHOLDS } from './milestones';
import type { CareerStats } from '../types';

const C = (o: Partial<CareerStats>): CareerStats =>
  ({ seasons: 0, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0, ...o });

test('crossedThresholds: before→after 사이 임계만', () => {
  assert.deepEqual(crossedThresholds(900, 1100, CAREER_THRESHOLDS.points), [1000]);
  assert.deepEqual(crossedThresholds(900, 3200, CAREER_THRESHOLDS.points), [1000, 2000, 3000]);
  assert.deepEqual(crossedThresholds(1000, 1100, CAREER_THRESHOLDS.points), [], '이미 넘은 임계는 제외');
  assert.deepEqual(crossedThresholds(1100, 1000, CAREER_THRESHOLDS.points), [], '감소면 없음');
});

test('personalMilestones: 여러 스탯 동시 돌파', () => {
  const ms = personalMilestones(C({ points: 980, blocks: 290 }), C({ points: 1050, blocks: 510, seasons: 1 }));
  const keys = ms.map((m) => `${m.stat}:${m.threshold}`);
  assert.ok(keys.includes('points:1000'));
  assert.ok(keys.includes('blocks:300'));
  assert.ok(keys.includes('blocks:500'));
});

test('personalMilestones: 장수 시즌 임계', () => {
  const ms = personalMilestones(C({ seasons: 9 }), C({ seasons: 10 }));
  assert.ok(ms.some((m) => m.stat === 'seasons' && m.threshold === 10));
});

test('personalMilestones: 변화 없으면 빈 배열', () => {
  assert.deepEqual(personalMilestones(C({ points: 1200 }), C({ points: 1200, seasons: 1 })), []);
});

test('passedValues: 레전드 추월 감지', () => {
  // 레전드들 통산 [3000, 5000, 8000], 4200→5300 → 5000 추월
  assert.deepEqual(passedValues(4200, 5300, [3000, 5000, 8000]), [5000]);
  assert.deepEqual(passedValues(2000, 9000, [3000, 5000, 8000]), [3000, 5000, 8000]);
  assert.deepEqual(passedValues(8001, 9000, [3000, 5000, 8000]), []);
});
