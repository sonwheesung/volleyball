import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFAEligible, assignFAGrades, askingPrice, listFreeAgents, offerScore, rollFAPref, DEFAULT_FA_WEIGHTS } from './faMarket';
import { createRng } from './rng';
import { TRAINABLE_STATS } from './training';
import type { Player, TrainableStat } from '../types';

function mk(id: string, seasons: number, remaining: number, salary: number): Player {
  const potential = {} as Record<TrainableStat, number>;
  for (const s of TRAINABLE_STATS) potential[s] = 90;
  const v = 70;
  return {
    id, name: id, age: 25, position: 'OH', isForeign: false, height: 180,
    jump: v, agility: v, staminaMax: v, staminaRegen: v, reaction: v, positioning: v,
    focus: v, consistency: v, vq: v, skSpike: v, skBlock: v, skDig: v, skReceive: v, skSet: v, skServe: v,
    xp: {}, potential, talentBase: 1, catTalent: { physical: 1, skill: 1, mental: 1 },
    contract: { salary, years: 3, remaining, signedAtAge: 22 },
    clubTenure: 5,
    peakAge: 28,
    career: { seasons, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0, assists: 0 },
  };
}

test('자격: 6시즌 이상 + 계약 만료 임박', () => {
  assert.equal(isFAEligible(mk('a', 6, 1, 30000)), true);
  assert.equal(isFAEligible(mk('b', 5, 1, 30000)), false, '경력 부족');
  assert.equal(isFAEligible(mk('c', 8, 2, 30000)), false, '계약 잔여');
});

test('등급: 연봉 순위로 A/B/C', () => {
  const pool = [mk('hi', 8, 1, 70000), mk('mid', 8, 1, 40000), mk('lo', 8, 1, 10000)];
  const g = assignFAGrades(pool);
  assert.equal(g.get('hi'), 'A');
  assert.equal(g.get('lo'), 'C');
});

test('요구연봉: 등급 프리미엄 A>B>C', () => {
  assert.ok(askingPrice(40000, 'A') > askingPrice(40000, 'B'));
  assert.ok(askingPrice(40000, 'B') > askingPrice(40000, 'C'));
});

test('offerScore: 연봉↑·전력↑·출전기회↑·충성도↑·우승권↑·선호팀 일수록 선호', () => {
  const base = {
    teamOvr: 70, prestige: 0.3, posGap: 1, isOriginal: false, isFranchise: false,
    isPreferred: false, offerSalary: 40000, asking: 40000, w: DEFAULT_FA_WEIGHTS, rand: 0.5,
  };
  assert.ok(offerScore({ ...base, offerSalary: 50000 }) > offerScore(base), '연봉↑');
  assert.ok(offerScore({ ...base, teamOvr: 80 }) > offerScore(base), '전력↑');
  assert.ok(offerScore({ ...base, prestige: 0.9 }) > offerScore(base), '우승권↑');
  assert.ok(offerScore({ ...base, posGap: 3 }) > offerScore({ ...base, posGap: 0 }), '출전기회↑');
  assert.ok(offerScore({ ...base, isOriginal: true, isFranchise: true }) > offerScore(base), '충성도↑');
  assert.ok(offerScore({ ...base, isPreferred: true }) > offerScore(base), '선호팀');
});

test('offerScore: 성향에 따라 같은 두 오퍼의 선호가 갈린다(머니 vs 윈나우)', () => {
  // A팀: 고연봉·약체(우승권X) / B팀: 저연봉·강호(우승권O)
  const teamA = { teamOvr: 62, prestige: 0.1, offerSalary: 60000 };
  const teamB = { teamOvr: 82, prestige: 0.95, offerSalary: 38000 };
  const common = { posGap: 1, isOriginal: false, isFranchise: false, isPreferred: false, asking: 40000, rand: 0.5 };
  const money = { money: 0.7, win: 0.1, loyalty: 0.05, play: 0.1, home: 0.05 };
  const winnow = { money: 0.1, win: 0.7, loyalty: 0.05, play: 0.1, home: 0.05 };
  const scoreFor = (w: typeof money, t: typeof teamA) => offerScore({ ...common, ...t, w });
  assert.ok(scoreFor(money, teamA) > scoreFor(money, teamB), '머니형은 고연봉 약체 선택');
  assert.ok(scoreFor(winnow, teamB) > scoreFor(winnow, teamA), '윈나우형은 저연봉 강호 선택');
});

test('rollFAPref: 결정론 + 가중치 합≈1 + 선호팀 지정', () => {
  const a = rollFAPref(createRng(12345), 7);
  const b = rollFAPref(createRng(12345), 7);
  assert.deepEqual(a, b, '같은 시드 = 같은 성향');
  const sum = a.w.money + a.w.win + a.w.loyalty + a.w.play + a.w.home + (a.w.rel ?? 0); // rel 포함 정규화(RELATIONSHIP)
  assert.ok(Math.abs(sum - 1) < 1e-9, '가중치 합 1');
  assert.ok(/^t[0-6]$/.test(a.preferredTeamId ?? ''), '선호팀 t0~t6');
});

test('listFreeAgents: 자격자만 + 등급 부여', () => {
  const players = [mk('a', 8, 1, 50000), mk('b', 3, 1, 50000), mk('c', 8, 1, 20000)];
  const fas = listFreeAgents(players);
  assert.equal(fas.length, 2);
  assert.ok(fas.every((f) => f.grade));
});

test('rollFAPref: 동기(archetype) 분포가 다양 — 한쪽 쏠림 아님', () => {
  const seen = new Set<string>();
  for (let s = 0; s < 80; s++) seen.add(rollFAPref(createRng(s + 1), 8).archetype);
  assert.ok(seen.size >= 3, `archetype 종류 ${seen.size} (≥3 — 분포 왜곡 방지)`);
});
