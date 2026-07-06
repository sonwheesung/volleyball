import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trainingBoosts, staffEffects, NO_EFFECTS, scoutReveal, SPECIALTY_TRAININGS, assistantBoost, potRaise, headCoachSalary, assistantSalary, scoutSalary, STAFF_BUDGET, COACH_SLOTS } from './staff';
import { evolvePlayer } from './progression';
import { overallRaw } from './overall';
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
    career: { seasons: 0, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0, assists: 0 },
  };
}
const asst = (specialty: AssistantCoach['specialty'], rating: number): AssistantCoach =>
  ({ id: 'a', name: 'a', age: 45, specialty, rating, salary: 0, teamId: null });

test('trainingBoosts: 분야→훈련 매핑, 같은 분야 최고 1명만', () => {
  const b = trainingBoosts([asst('attack', 80), asst('attack', 60)]);
  for (const tid of SPECIALTY_TRAININGS.attack) assert.equal(b[tid], 1 + assistantBoost(80), '공격 훈련 부스트=최고 코치');
  assert.equal(b[6], undefined, '수비 훈련은 부스트 없음');
});

test('공격코치(기량): skSpike 더 빨리 + 훈련 상한(포텐−GAP) 위로 더 높이 성장', () => {
  // §1.8 C(2026-07-01): 훈련 상한 = 포텐 − TRAIN_GAP(12). 마지막 GAP은 경기경험만 채운다.
  // 코치 potBonus는 포텐을 +5 올려 훈련 상한도 함께 올린다(72→77) — "포텐 위로"가 아니라 "상한 위로".
  const base = mkPlayer('OH');
  base.skSpike = 70; base.potential.skSpike = 84; // 훈련 상한 84−12=72 근접
  const focus: TrainingFocus = { primary: [4, 6], secondary: [1, 10, 12] };
  const plain = evolvePlayer(base, focus, 600);
  const coached = evolvePlayer(base, focus, 600, staffEffects([asst('attack', 90)]));
  assert.ok(plain.skSpike <= 72, `기본은 훈련 상한 72(=84−GAP)에서 멈춤(실측 ${plain.skSpike})`);
  assert.ok(coached.skSpike > 72, `코치는 상한을 올려 그 위로 성장(${coached.skSpike} > 72, 포텐 +${potRaise(90)})`);
  assert.ok(coached.skSpike > plain.skSpike, '코치가 더 높이');
});

test('코치 역량 등급 단조성: 역량↑ → 성장(OVR) 단조 증가 + potRaise 산식', () => {
  // §1.8 봉인(2026-07-07, 검증=Fable 5): 코치無 < 역량60 < 역량95 OVR 단조.
  // 하드코딩 수치가 아니라 단조 관계로 어서션(시드/밸런스 변경에 강건). 결정론이라 flaky 없음.
  const base = mkPlayer('OH');
  base.skSpike = 70; base.potential.skSpike = 84; base.potential.skServe = 84; // 공격 스킬에 성장 여지
  const focus: TrainingFocus = { primary: [4, 5], secondary: [1, 2, 3] }; // 공격코치가 부스트하는 훈련(4·5)
  const none = evolvePlayer(base, focus, 600);
  const mid = evolvePlayer(base, focus, 600, staffEffects([asst('attack', 60)]));
  const high = evolvePlayer(base, focus, 600, staffEffects([asst('attack', 95)]));
  assert.ok(overallRaw(none) < overallRaw(mid), `코치無 ${overallRaw(none).toFixed(2)} < 역량60 ${overallRaw(mid).toFixed(2)}`);
  assert.ok(overallRaw(mid) < overallRaw(high), `역량60 ${overallRaw(mid).toFixed(2)} < 역량95 ${overallRaw(high).toFixed(2)}`);
  // potRaise 산식: round((rating/100)*5) — 60→3, 95→5
  assert.equal(potRaise(60), 3, 'potRaise(60)=3');
  assert.equal(potRaise(95), 5, 'potRaise(95)=5');
});

test('체력코치(노쇠 지연): 나이든 선수 jump 덜 하락', () => {
  const base = mkPlayer('MB'); base.age = 34; base.jump = 80;
  const focus: TrainingFocus = { primary: [1, 8], secondary: [2, 3, 12] };
  const plain = evolvePlayer(base, focus, 300);
  const coached = evolvePlayer(base, focus, 300, staffEffects([asst('stamina', 90)]));
  assert.ok(coached.jump > plain.jump, `체력코치 jump ${coached.jump} > 기본 ${plain.jump}(덜 하락)`);
});

test('코치 효과 없으면(NO_EFFECTS) 성장 불변(결정론)', () => {
  const base = mkPlayer('MB');
  const focus: TrainingFocus = { primary: [8, 1], secondary: [4, 3, 12] };
  const a = evolvePlayer(base, focus, 150);
  const b = evolvePlayer(base, focus, 150, NO_EFFECTS);
  assert.deepEqual(a, b, 'NO_EFFECTS = 기존');
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
