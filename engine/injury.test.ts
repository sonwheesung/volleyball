import { test } from 'node:test';
import assert from 'node:assert/strict';
import { injuryRisk, rollSeverity, INJURY_BASE, CONCURRENT_CAP } from './injury';
import { createRng } from './rng';

test('injuryRisk: 나이↑·체력↓·유리몸↑ 단조 증가, 상한 6%', () => {
  assert.ok(injuryRisk(34, 60) > injuryRisk(22, 60), '노장이 더 위험');
  assert.ok(injuryRisk(28, 40) > injuryRisk(28, 80), '체력 낮으면 더 위험');
  assert.ok(injuryRisk(28, 60, ['glass']) > injuryRisk(28, 60), '유리몸 가중');
  assert.ok(injuryRisk(28, 60, ['iron']) < injuryRisk(28, 60), '철강 경감');
  assert.ok(injuryRisk(40, 30, ['glass']) <= 0.06, '상한 6%');
  assert.ok(injuryRisk(22, 70) > 0, '항상 양수');
});

test('rollSeverity: 경미가 대부분, 시즌아웃은 희귀', () => {
  const rng = createRng(12345);
  const cnt = { minor: 0, moderate: 0, major: 0, season: 0 };
  for (let i = 0; i < 20000; i++) cnt[rollSeverity(rng).severity]++;
  assert.ok(cnt.minor > cnt.moderate, '경미 > 중기');
  assert.ok(cnt.moderate > cnt.major, '중기 > 중상');
  assert.ok(cnt.major > cnt.season, '중상 > 시즌아웃');
  assert.ok(cnt.minor / 20000 > 0.55, '절반 이상 경미');
  assert.ok(cnt.season / 20000 < 0.03, '시즌아웃 3% 미만');
});

test('rollSeverity: 결장 경기 수 양수, 심각도별 단조', () => {
  const rng = createRng(7);
  for (let i = 0; i < 1000; i++) {
    const inj = rollSeverity(rng);
    assert.ok(inj.missMatches >= 1);
    if (inj.severity === 'minor') assert.ok(inj.missMatches <= 2);
  }
});

test('INJURY_BASE 합리적 범위', () => {
  assert.ok(INJURY_BASE > 0 && INJURY_BASE < 0.02);
});

test('CONCURRENT_CAP = 3 (팀 동시부상 상한 — 뎁스 붕괴·라인업 파탄 방지)', () => {
  assert.equal(CONCURRENT_CAP, 3);
});
