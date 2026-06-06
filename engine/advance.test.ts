import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planNextAction } from './advance';
import type { Fixture } from '../types';

const f = (id: string, day: number, home: string, away: string): Fixture => ({
  id, round: 0, dayIndex: day, homeTeamId: home, awayTeamId: away, seed: 1,
});

const season: Fixture[] = [
  f('a', 4, 't0', 't1'),
  f('b', 0, 't2', 't3'), // t0 무관, 더 이른 날
  f('c', 8, 't1', 't0'),
];

test('내 팀의 가장 이른 미경기 경기를 고른다', () => {
  const action = planNextAction(season, 't0', {});
  assert.equal(action.kind, 'match');
  if (action.kind === 'match') assert.equal(action.fixture.id, 'a');
});

test('치른 경기는 건너뛴다', () => {
  const action = planNextAction(season, 't0', { a: { fixtureId: 'a', homeSets: 3, awaySets: 0 } });
  assert.equal(action.kind, 'match');
  if (action.kind === 'match') assert.equal(action.fixture.id, 'c');
});

test('남은 경기 없으면 시즌 종료', () => {
  const action = planNextAction(season, 't0', {
    a: { fixtureId: 'a', homeSets: 3, awaySets: 0 },
    c: { fixtureId: 'c', homeSets: 0, awaySets: 3 },
  });
  assert.equal(action.kind, 'seasonOver');
});
