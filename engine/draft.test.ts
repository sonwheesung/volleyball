import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from './rng';
import { lotteryRound1, neededPositions, aiDraftPick, resolveDraft, buildDraftOrder } from './draft';
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
    career: { seasons: 0, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0, assists: 0 },
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
  const needs = neededPositions(['s1'], (id) => snap[id]);
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
  const pick = aiDraftPick([lowS, hiS, oh], [], (id) => snap[id], 'balanced');
  assert.ok(pick && (pick.id === 'hiS' || pick.id === 'oh'));
});

test('aiDraftPick: 부족 포지션 우선(비특급은 OVR 높아도 양보) + 특급은 BPA 예외', () => {
  const snap: Record<string, Player> = {};
  // 로스터에 OH 이미 5명(이상치) → OH 잉여, S 0명 → S 절실
  const roster: string[] = [];
  for (let i = 0; i < 5; i++) {
    const oh = mk(`oh${i}`, 'OH', 70, 80);
    snap[oh.id] = oh;
    roster.push(oh.id);
  }
  // (1) 비특급(pot<88) OH는 OVR 높아도 절실한 S에 양보 → needS
  const surplusOH = mk('surplusOH', 'OH', 75, 82); // 잉여 포지션·비특급(pot 82)
  const needS = mk('needS', 'S', 58, 80);          // 절실 포지션, 낮은 OVR
  [surplusOH, needS].forEach((p) => (snap[p.id] = p));
  const p1 = aiDraftPick([surplusOH, needS], roster, (id) => snap[id], 'balanced');
  assert.equal(p1?.id, 'needS', '비특급 잉여(OVR 높아도) → 부족 포지션(S) 우선');
  // (2) 특급(pot≥88) OH는 잉여 포지션이어도 무조건 BPA → star (FA_SYSTEM 3.1 슈퍼 예외)
  const star = mk('star', 'OH', 75, 95); // 잉여 포지션이지만 특급(pot 95)
  snap[star.id] = star;
  const p2 = aiDraftPick([star, needS], roster, (id) => snap[id], 'balanced');
  assert.equal(p2?.id, 'star', '특급 유망주는 포지션 잉여여도 BPA로 잡음');
});

test('resolveDraft: 내 위시리스트 우선, 순번 존중', () => {
  const A = mk('A', 'OH', 60, 95); // 최고 가치 → AI가 먼저
  const B = mk('B', 'OH', 55, 90);
  const C = mk('C', 'S', 45, 70);  // 낮은 가치(세터)
  const cls = [A, B, C];
  const rosters = { me: [] as string[], ai: [] as string[] };
  // ai 먼저, 그다음 나
  const style = () => 'balanced' as const;
  const r1 = resolveDraft(['ai', 'me'], cls, rosters, () => undefined, 'me', ['C'], style);
  assert.deepEqual(r1.rosters.ai, ['A'], 'AI는 최고가치 A');
  assert.deepEqual(r1.rosters.me, ['C'], '나는 위시 C');

  // 위시 없으면 가치순 자동
  const r2 = resolveDraft(['ai', 'me'], cls, rosters, () => undefined, 'me', [], style);
  assert.deepEqual(r2.rosters.ai, ['A']);
  assert.deepEqual(r2.rosters.me, ['B'], '위시 없으면 다음 가치 B');
});

test('buildDraftOrder: 1R 순번 × rounds 라운드(KOVO 4라운드제)', () => {
  const order = buildDraftOrder(['a', 'b', 'c'], 4);
  assert.equal(order.length, 12, '3팀 × 4라운드 = 12슬롯');
  assert.equal(order.filter((x) => x === 'a').length, 4, '전 팀 4라운드 균일 등장');
  assert.deepEqual(order.slice(0, 3), ['a', 'b', 'c'], '1라운드는 순번대로');
  assert.deepEqual(order.slice(3, 6), ['a', 'b', 'c'], '2라운드도 같은 순번');
  // 기본 rounds = DRAFT_ROUNDS(4)
  assert.equal(buildDraftOrder(['a', 'b']).length, 8, '기본 4라운드');
});

test('resolveDraft: 같은 신인은 한 팀만(중복 지명 불가) + 팀별 슬롯 한도 준수', () => {
  const cls = [
    mk('p0', 'OH', 70, 95), mk('p1', 'MB', 68, 92), mk('p2', 'S', 60, 88),
    mk('p3', 'OP', 66, 90), mk('p4', 'L', 58, 80), mk('p5', 'OH', 64, 85),
    mk('p6', 'MB', 62, 84), mk('p7', 'S', 55, 78),
  ];
  const order = ['a', 'b', 'c', 'a', 'b']; // a2·b2·c1 (명시 순번 — 1R 전원 + 2R a·b)
  const r = resolveDraft(order, cls, { a: [], b: [], c: [] }, () => undefined, '', [], () => 'balanced');
  const ids = r.picked.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'picked에 중복 신인 없음');
  // 전역 유일: 각 신인은 한 팀에만
  const all = [...r.rosters.a, ...r.rosters.b, ...r.rosters.c];
  assert.equal(new Set(all).size, all.length, '한 신인이 두 팀에 가지 않음');
  // 로스터가 비어(니즈 다수) 5슬롯 전부 지명(1R·2R 모두 needCount>0·comfort 미만 → 패스 없음)
  assert.equal(r.rosters.a.length, 2, 'a 슬롯=2');
  assert.equal(r.rosters.b.length, 2, 'b 슬롯=2');
  assert.equal(r.rosters.c.length, 1, 'c 슬롯=1');
});

test('resolveDraft: 위시리스트 우선순위 순서를 지킴', () => {
  const A = mk('A', 'OH', 60, 95); // 최고 가치
  const B = mk('B', 'OH', 55, 90);
  const C = mk('C', 'S', 45, 70);
  // 내가 먼저 픽, 위시 [C, B] 둘 다 가용 → 1순위 C
  const r1 = resolveDraft(['me'], [A, B, C], { me: [] }, () => undefined, 'me', ['C', 'B'], () => 'balanced');
  assert.deepEqual(r1.rosters.me, ['C'], '위시 1순위 C');
  // 1순위 A가 앞 순번 AI에 뽑히면 → 2순위 B
  const r2 = resolveDraft(['ai', 'me'], [A, B, C], { ai: [], me: [] }, () => undefined, 'me', ['A', 'B'], () => 'balanced');
  assert.deepEqual(r2.rosters.ai, ['A'], 'AI가 A 선점');
  assert.deepEqual(r2.rosters.me, ['B'], '내 위시 1순위 없으니 2순위 B');
});
