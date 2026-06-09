import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateMatch } from './match';
import { inHalf } from './court';
import type { RallyEvent } from './events';
import type { Player, Position, Side, TrainableStat } from '../types';
import { TRAINABLE_STATS } from './training';

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
const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');

test('공간 텔레메트리: events ON/OFF 가 경기 결과를 바꾸지 않음(메인 RNG 불간섭)', () => {
  const h = team('H', 72), a = team('A', 68);
  for (let s = 1000; s < 1010; s++) {
    const off = simulateMatch(s, h, a);
    const ev: RallyEvent[] = [];
    const on = simulateMatch(s, h, a, { events: ev });
    assert.deepEqual({ hs: on.homeSets, as: on.awaySets, ss: on.setScores }, { hs: off.homeSets, as: off.awaySets, ss: off.setScores }, `seed ${s} 결과 불변`);
    assert.ok(ev.length > 0, '이벤트가 수집됨');
  }
});

test('공간 텔레메트리: 같은 시드 = 같은 이벤트(결정론)', () => {
  const h = team('H', 70), a = team('A', 70);
  const e1: RallyEvent[] = []; simulateMatch(42, h, a, { events: e1 });
  const e2: RallyEvent[] = []; simulateMatch(42, h, a, { events: e2 });
  assert.deepEqual(e1, e2);
});

test('공간 무결성: 범실=코트밖, 서브 인플레이/토스=코트안, 킬=상대코트안', () => {
  const h = team('H', 71), a = team('A', 69);
  const ev: RallyEvent[] = [];
  for (let s = 2000; s < 2008; s++) simulateMatch(s, h, a, { events: ev });
  assert.ok(ev.length > 500, '충분한 표본');
  for (const e of ev) {
    if (e.t === 'serve') {
      const recv = other(e.side);
      if (e.outcome === 'fault') assert.ok(!inHalf(recv, e.landing), '서브 범실은 코트 밖');
      else assert.ok(inHalf(recv, e.landing), '인플레이/에이스 서브는 리시브 코트 안');
    } else if (e.t === 'set') {
      assert.ok(inHalf(e.side, e.landing), '토스는 자기 코트 안(엉뚱한 곳 금지)');
    } else if (e.t === 'attack') {
      if (e.result === 'kill') assert.ok(inHalf(other(e.side), e.course), '킬 코스는 상대 코트 안');
      if (e.result === 'error') assert.ok(!inHalf(other(e.side), e.course), '공격 범실은 코트 밖');
    } else if (e.t === 'block') {
      assert.ok(e.count >= 1 && e.count <= 3, '블록 인원 1~3');
      assert.ok(!e.positions.includes('L'), '리베로는 블록 불가');
    }
  }
});
