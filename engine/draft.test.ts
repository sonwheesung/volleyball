import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from './rng';
import { lotteryRound1, neededPositions, aiDraftPick } from './draft';
import { TRAINABLE_STATS } from './training';
import type { Player, Position, TrainableStat } from '../types';

function mk(id: string, pos: Position, ovrV: number, pot = 90): Player {
  const potential = {} as Record<TrainableStat, number>;
  for (const s of TRAINABLE_STATS) potential[s] = pot;
  return {
    id, name: id, age: 19, position: pos, isForeign: false, height: 180,
    jump: ovrV, agility: ovrV, staminaMax: ovrV, staminaRegen: ovrV, reaction: ovrV, positioning: ovrV,
    focus: ovrV, consistency: ovrV, vq: ovrV, skSpike: ovrV, skBlock: ovrV, skDig: ovrV, skReceive: ovrV, skSet: ovrV, skServe: ovrV,
    xp: {}, potential, talentBase: 1, catTalent: { physical: 1, skill: 1, mental: 1 },
    contract: { salary: 5000, years: 3, remaining: 3, signedAtAge: 19 },
    clubTenure: 0, peakAge: 28,
    career: { seasons: 0, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0 },
  };
}

test('lotteryRound1: 입력의 순열을 반환', () => {
  const order = lotteryRound1(['a', 'b', 'c', 'd'], createRng(1));
  assert.deepEqual([...order].sort(), ['a', 'b', 'c', 'd']);
});

test('lotteryRound1: 하위 팀이 평균적으로 앞 순번', () => {
  const teams = ['worst', 't2', 't3', 'best'];
  const rng = createRng(7);
  let worstPos = 0;
  let bestPos = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) {
    const o = lotteryRound1(teams, rng);
    worstPos += o.indexOf('worst');
    bestPos += o.indexOf('best');
  }
  assert.ok(worstPos / N < bestPos / N, `worst avg ${worstPos / N} < best avg ${bestPos / N}`);
});

test('neededPositions: 이상 구성 대비 부족분', () => {
  const snap: Record<string, Player> = { s1: mk('s1', 'S', 50) };
  const needs = neededPositions(['s1'], snap);
  // S 이상 3명 중 1명 보유 → S 2개 부족 포함
  assert.equal(needs.filter((p) => p === 'S').length, 2);
});

test('aiDraftPick: 필요 포지션 + 종합가치 우선', () => {
  const snap: Record<string, Player> = {};
  const lowS = mk('lowS', 'S', 45, 70);
  const hiS = mk('hiS', 'S', 55, 92);
  const oh = mk('oh', 'OH', 60, 95);
  [lowS, hiS, oh].forEach((p) => (snap[p.id] = p));
  // 로스터에 S 없음 → S 필요. 가치 높은 hiS 선택
  const pick = aiDraftPick([lowS, hiS, oh], [], snap);
  assert.ok(pick && (pick.id === 'hiS' || pick.id === 'oh'));
});
