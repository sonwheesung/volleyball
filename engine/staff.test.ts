import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trainingBoosts, scoutReveal, SPECIALTY_TRAININGS, assistantBoost, headCoachSalary, assistantSalary, scoutSalary, STAFF_BUDGET } from './staff';
import { evolvePlayer } from './progression';
import type { AssistantCoach, Scout, Player, Position, TrainableStat, TrainingFocus } from '../types';
import { TRAINABLE_STATS } from './training';

function mkPlayer(pos: Position): Player {
  const potential = {} as Record<TrainableStat, number>;
  for (const s of TRAINABLE_STATS) potential[s] = 99;
  return {
    id: 'p1', name: 'p1', age: 20, position: pos, isForeign: false, height: 185,
    jump: 60, agility: 60, staminaMax: 60, staminaRegen: 60, reaction: 60, positioning: 60, focus: 60, consistency: 60, vq: 60,
    skSpike: 50, skBlock: 50, skDig: 50, skReceive: 50, skSet: 50, skServe: 50,
    xp: {}, potential, talentBase: 1, catTalent: { physical: 1, skill: 1, mental: 1 },
    contract: { salary: 10000, years: 3, remaining: 2, signedAtAge: 22 }, clubTenure: 1, peakAge: 28,
    career: { seasons: 0, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0 },
  };
}
const asst = (specialty: AssistantCoach['specialty'], rating: number): AssistantCoach =>
  ({ id: 'a', name: 'a', age: 45, specialty, rating, salary: 0, teamId: null });

test('trainingBoosts: 분야→훈련 매핑, 같은 분야 최고 1명만', () => {
  const b = trainingBoosts([asst('attack', 80), asst('attack', 60)]);
  for (const tid of SPECIALTY_TRAININGS.attack) assert.equal(b[tid], 1 + assistantBoost(80), '공격 훈련 부스트=최고 코치');
  assert.equal(b[6], undefined, '수비 훈련은 부스트 없음');
});

test('전문 코치 부스트: 공격코치 있으면 skSpike 더 빨리 성장', () => {
  const base = mkPlayer('OH');
  const focus: TrainingFocus = { primary: [4, 6], secondary: [1, 10, 12] };
  const plain = evolvePlayer(base, focus, 200);
  const boosted = evolvePlayer(base, focus, 200, trainingBoosts([asst('attack', 90)]));
  assert.ok(boosted.skSpike > plain.skSpike, `부스트 skSpike ${boosted.skSpike} > 기본 ${plain.skSpike}`);
});

test('전문 코치 부스트 없으면(undefined) 성장 불변(결정론)', () => {
  const base = mkPlayer('MB');
  const focus: TrainingFocus = { primary: [8, 1], secondary: [4, 3, 12] };
  const a = evolvePlayer(base, focus, 150);
  const b = evolvePlayer(base, focus, 150, undefined);
  const c = evolvePlayer(base, focus, 150, {});
  assert.deepEqual(a, b, 'boosts undefined = 기존');
  assert.deepEqual(a, c, 'boosts {} = 기존');
});

test('scoutReveal: 스카우터 없으면 0, 많을수록 증가, 0~1 범위', () => {
  const sc = (n: number): Scout => ({ id: 's', name: 's', age: 50, scouting: n, salary: 0, teamId: null });
  assert.equal(scoutReveal([]), 0);
  const one = scoutReveal([sc(80)]);
  const two = scoutReveal([sc(80), sc(70)]);
  assert.ok(one > 0 && one <= 1);
  assert.ok(two > one, '인원 많을수록 공개도↑');
  assert.ok(scoutReveal([sc(100), sc(100), sc(100)]) <= 1, '상한 1');
});

test('연봉: 역량 비례 단조 + 합리적 범위', () => {
  assert.ok(headCoachSalary(95) > headCoachSalary(45));
  assert.ok(assistantSalary(90) > assistantSalary(50));
  assert.ok(scoutSalary(90) > scoutSalary(45));
  assert.ok(headCoachSalary(95) + assistantSalary(90) * 2 + scoutSalary(90) * 2 > STAFF_BUDGET, '최고급 풀세트는 예산 초과(트레이드오프 존재)');
});
