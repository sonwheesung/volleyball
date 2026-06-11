import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  discontentOf, meetAccept, persuade, cardMatch, interviewEffects, refuseResignProb,
  benchAccept, popularityOf, benchAngerPenalty, fanScore, fanBudgetFactor, sinkingShipBias,
} from './owner';
import { LEAGUE, getEvolvedTeamPlayers } from '../data/league';
import type { FAPref, Player } from '../types';

const base = getEvolvedTeamPlayers(LEAGUE.teams[0].id, 0)[0];
const withPref = (pref: FAPref): Player => ({ ...base, faPref: pref });
const winnow: FAPref = { archetype: 'winnow', w: { money: 0.1, win: 0.6, loyalty: 0.1, play: 0.1, home: 0.1 } };
const loyal: FAPref = { archetype: 'loyal', w: { money: 0.1, win: 0.1, loyalty: 0.6, play: 0.1, home: 0.1 } };

test('불만 파생: 우승파+하위권=win, 충성파=null, 만족하면 null', () => {
  const ctx = { recentRankAvg: 6, teamCount: 7, playRatio: 1, salaryRatio: 1, myTeamId: 't' };
  assert.equal(discontentOf(withPref(winnow), ctx), 'win');
  assert.equal(discontentOf(withPref(loyal), ctx), null);
  assert.equal(discontentOf(withPref(winnow), { ...ctx, recentRankAvg: 1 }), null); // 우승권이면 만족
});

test('면담 문턱: 들볶을수록 거절 — 결정론 + 비율 단조 증가', () => {
  assert.equal(meetAccept('p1', 3, 0, false), meetAccept('p1', 3, 0, false)); // 결정론
  const rate = (n: number, failed: boolean) => {
    let ok = 0;
    for (let i = 0; i < 600; i++) if (meetAccept(`px${i}`, 1, n, failed)) ok++;
    return ok / 600;
  };
  const fresh = rate(0, false), pestered = rate(2, false), burned = rate(2, true);
  assert.ok(fresh > 0.82, `첫 면담 수락률 ${fresh}`);
  assert.ok(pestered < fresh - 0.3, `3번째 면담 ${pestered}`);
  assert.ok(burned < pestered, `실패 직후 ${burned}`);
});

test('설득: 맞는 카드가 통하고, 누적 실패는 마음을 닫는다', () => {
  assert.equal(cardMatch('reinforce', 'win', base), 1);
  assert.equal(cardMatch('raise', 'win', base), 0);
  const rate = (match: number, fails: number) => {
    let ok = 0;
    for (let i = 0; i < 600; i++) if (persuade(`py${i}`, 1, 0, match, 0.5, fails)) ok++;
    return ok / 600;
  };
  const good = rate(1, 0), wrong = rate(0, 0), burned = rate(1, 2);
  assert.ok(good > 0.7, `맞는 카드 ${good}`);
  assert.ok(wrong < 0.5, `틀린 카드 ${wrong}`);
  assert.ok(burned < good - 0.2, `2회 실패 후 ${burned}`);
});

test('면담 효과: 성공=거부↓·오퍼↑, 실패=역효과(거부↑·오퍼↓)', () => {
  const okFx = interviewEffects([{ playerId: 'a', season: 2, day: 10, topic: 'win', card: 'reinforce', ok: true }], 2);
  const failFx = interviewEffects([{ playerId: 'a', season: 2, day: 10, topic: 'win', card: 'reinforce', ok: false }], 2);
  assert.ok(okFx.refuseBias['a'] < 0 && okFx.offerBias['a'] > 0);
  assert.ok(failFx.refuseBias['a'] > 0 && failFx.offerBias['a'] < 0);
  assert.deepEqual(interviewEffects([{ playerId: 'a', season: 1, day: 10, topic: 'win', card: 'reinforce', ok: true }], 2).refuseBias, {}); // 다른 시즌 로그 무시
});

test('재계약 거부 확률: 만족=0, 불만+실패 면담=상승, clamp', () => {
  assert.equal(refuseResignProb(null, 0.6, 0.5), 0);
  const calm = refuseResignProb('win', 0.5, -0.18);
  const angry = refuseResignProb('win', 0.5, 0.18);
  assert.ok(calm < angry);
  assert.ok(refuseResignProb('win', 1, 1) <= 0.9);
});

test('벤치 건의: 에이스+소신 감독은 거절 우세, 비등 대체자+백업은 수락 우세', () => {
  const rate = (charisma: number, gapT: number, aceRank: number) => {
    let ok = 0;
    for (let i = 0; i < 600; i++) if (benchAccept(`pz${i}`, 1, 40, charisma, gapT, aceRank, 'noResign')) ok++;
    return ok / 600;
  };
  assert.ok(rate(80, 0.2, 0) < 0.35, '에이스+카리스마 감독');
  assert.ok(rate(40, 0.9, 5) > 0.7, '백업+비등 대체자');
});

test('인기·팬심·예산 경계', () => {
  assert.ok(popularityOf(5000, 6, 8, 500) >= 95);
  assert.equal(popularityOf(0, 0, 0, 0), 0);
  assert.equal(benchAngerPenalty(2), 0);
  assert.ok(benchAngerPenalty(12) > benchAngerPenalty(6));
  assert.ok(fanScore(0.8, true, 0) > 80);
  assert.ok(fanScore(0.2, false, 20) < 25);
  assert.ok(Math.abs(fanBudgetFactor(100) - 1.08) < 1e-9);
  assert.ok(Math.abs(fanBudgetFactor(0) - 0.92) < 1e-9);
  assert.equal(sinkingShipBias(60), 0);
  assert.ok(sinkingShipBias(10) > 0);
});
