import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateMatch, isSetOver, targetPoints } from './match';
import { TRAINABLE_STATS } from './training';
import type { Player, Position, TrainableStat } from '../types';

function mk(id: string, pos: Position, skill: number): Player {
  const potential = {} as Record<TrainableStat, number>;
  for (const s of TRAINABLE_STATS) potential[s] = 99;
  return {
    id, name: id, age: 25, position: pos, isForeign: false, height: 185,
    jump: skill, agility: skill, staminaMax: skill, staminaRegen: skill,
    reaction: skill, positioning: skill, focus: skill, consistency: skill, vq: skill,
    skSpike: skill, skBlock: skill, skDig: skill, skReceive: skill, skSet: skill, skServe: skill,
    xp: {}, potential, talentBase: 1, catTalent: { physical: 1, skill: 1, mental: 1 },
    contract: { salary: 10000, years: 3, remaining: 2, signedAtAge: 22 },
    clubTenure: 3, peakAge: 28,
    career: { seasons: 3, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0 },
  };
}

function team(prefix: string, skill: number): Player[] {
  const spec: [Position, number][] = [['S', 3], ['OH', 5], ['OP', 2], ['MB', 4], ['L', 2]];
  const out: Player[] = [];
  let i = 0;
  for (const [pos, n] of spec) for (let k = 0; k < n; k++) out.push(mk(`${prefix}-${pos}${k}-${i++}`, pos, skill));
  return out;
}

test('targetPoints/isSetOver: 25점·5세트 15점·듀스', () => {
  assert.equal(targetPoints(1), 25);
  assert.equal(targetPoints(5), 15);
  assert.equal(isSetOver(25, 24, 1), false, '듀스 미달');
  assert.equal(isSetOver(26, 24, 1), true);
  assert.equal(isSetOver(15, 13, 5), true);
});

test('결정론: 같은 시드·같은 선수 = 같은 경기', () => {
  const h = team('H', 70), a = team('A', 70);
  const r1 = simulateMatch(12345, h, a);
  const r2 = simulateMatch(12345, h, a);
  assert.deepEqual(r1, r2);
});

test('유효 스코어: 승자 3세트·각 세트 목표+듀스 충족', () => {
  for (let s = 0; s < 50; s++) {
    const r = simulateMatch(1000 + s, team('H', 70), team('A', 70));
    assert.ok(r.homeSets === 3 || r.awaySets === 3, '한 팀이 3세트 선취');
    assert.ok(r.homeSets < 3 || r.awaySets < 3, '동시 3세트 불가');
    r.setScores.forEach((sc, i) => {
      const won = Math.max(sc.home, sc.away);
      const tgt = targetPoints(i + 1);
      assert.ok(won >= tgt, `세트${i + 1} 목표점 도달`);
      assert.ok(Math.abs(sc.home - sc.away) >= 2, `세트${i + 1} 2점차`);
    });
    // 마지막 점수의 누적이 세트 스코어와 일치
    assert.equal(r.points[r.points.length - 1].setNo, r.setScores.length);
  }
});

test('전력 우위 팀이 과반 이상 승리', () => {
  let strongWins = 0;
  const N = 200;
  for (let s = 0; s < N; s++) {
    const r = simulateMatch(7000 + s * 13, team('STR', 82), team('WEAK', 60));
    if (r.homeSets > r.awaySets) strongWins++;
  }
  assert.ok(strongWins / N > 0.7, `강팀 승률 ${strongWins}/${N} > 70%`);
});

test('감독 옵션: 결정론 + 유효 스코어 유지', () => {
  const opts = { home: { style: 'attack' as const, charisma: 80 }, away: { style: 'defense' as const, charisma: 40 } };
  const r1 = simulateMatch(555, team('H', 72), team('A', 72), opts);
  const r2 = simulateMatch(555, team('H', 72), team('A', 72), opts);
  assert.deepEqual(r1, r2, '같은 시드·옵션 = 동일');
  assert.ok(r1.homeSets === 3 || r1.awaySets === 3);
  r1.setScores.forEach((sc, i) => {
    assert.ok(Math.max(sc.home, sc.away) >= targetPoints(i + 1));
    assert.ok(Math.abs(sc.home - sc.away) >= 2);
  });
});

test('구조적 홈 편향 없음: 동일 전력 ≈ 5:5', () => {
  let homeWins = 0;
  const N = 400;
  for (let s = 0; s < N; s++) {
    const r = simulateMatch(31 + s * 101, team('H', 70), team('A', 70));
    if (r.homeSets > r.awaySets) homeWins++;
  }
  const pct = homeWins / N;
  assert.ok(pct > 0.4 && pct < 0.6, `홈 승률 ${(pct * 100).toFixed(1)}% (40~60%)`);
});
