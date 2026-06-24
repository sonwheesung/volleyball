// 독립 검증(코드 모드) — 순수 함수 경계/적대 입력.
// 대상: rng.int 역범위, isSetOver/targetPoints 음수·NaN·>5, applyAgingDay 극단 나이/스탯,
//   finance settleSeason teamCount=0, turnoutRate 극단, rotate 음수.

import { createRng } from '../engine/rng';
import { isSetOver, targetPoints } from '../engine/match';
import { rotate, frontRow, backRow, serverIndex } from '../engine/rotation';
import { applyAgingDay } from '../engine/aging';
import { settleSeason, applyNet, turnoutRate, sponsorBonus } from '../engine/finance';
import { generateLeague } from '../data/seed';
import type { Player } from '../types';

let bad = 0;
const check = (label: string, cond: boolean, detail = '') => {
  if (!cond) { bad++; console.log(`  FAIL ${label} ${detail}`); }
  else console.log(`  ok   ${label} ${detail}`);
};

console.log('=== rng.int 역범위/동일 ===');
{
  const r = createRng(1);
  const a = r.int(5, 2); // min>max
  console.log('    int(5,2) =', a, '(역범위 — 음수 폭이면 floor 가 엉뚱)');
  const b = r.int(3, 3);
  check('int(3,3)==3', b === 3, `got ${b}`);
  // 거대 범위 정수 안전성
  const c = r.int(0, Number.MAX_SAFE_INTEGER);
  check('int(0,MAX) 유한·정수', Number.isFinite(c) && Number.isInteger(c), `got ${c}`);
}

console.log('\n=== isSetOver / targetPoints 적대 입력 ===');
check('targetPoints(6)=15', targetPoints(6) === 15, `got ${targetPoints(6)}`);
check('targetPoints(0)=25', targetPoints(0) === 25, `got ${targetPoints(0)}`);
check('targetPoints(-1)=25', targetPoints(-1) === 25, `got ${targetPoints(-1)}`);
check('isSetOver(NaN,NaN) 미종료', isSetOver(NaN, NaN, 1) === false, `got ${isSetOver(NaN, NaN, 1)}`);
check('isSetOver(-5,-9) 미종료', isSetOver(-5, -9, 1) === false, `got ${isSetOver(-5, -9, 1)}`);
check('isSetOver(99,0) 종료', isSetOver(99, 0, 1) === true);
console.log('    isSetOver(Infinity,0)=', isSetOver(Infinity, 0, 1));

console.log('\n=== rotation 음수/거대 ===');
console.log('    rotate(-1)=', rotate(-1), '(JS % 는 음수 보존 → -? )');
console.log('    serverIndex(-1)=', serverIndex(-1));
console.log('    frontRow(-1)=', frontRow(-1));
console.log('    rotate(NaN)=', rotate(NaN));
check('rotate(5)==0', rotate(5) === 0);

console.log('\n=== applyAgingDay 극단 ===');
const lg = generateLeague(1);
const p0 = lg.players[0] as Player;
{
  const old = { ...p0, age: 999 };
  const r = createRng(1);
  const next = applyAgingDay(old, r);
  const decayed = ['jump', 'agility', 'staminaMax', 'staminaRegen'].map((k) => (next as any)[k]);
  check('age=999 노쇠 유한', decayed.every((v) => Number.isFinite(v) && v >= 25), `vals ${decayed}`);
  const neg = { ...p0, age: -50 };
  const next2 = applyAgingDay(neg, createRng(1));
  check('age=-50 무변(rate<=0)', next2 === neg, 'returns same obj when rate<=0');
  const nanAge = { ...p0, age: NaN };
  const next3 = applyAgingDay(nanAge, createRng(1));
  console.log('    age=NaN → 반환 동일?', next3 === nanAge, '(decayRate(NaN) 분기 결과)');
}

console.log('\n=== finance 적대 입력 ===');
check('sponsorBonus teamCount=0 유한', Number.isFinite(sponsorBonus(100000, 1, 0, false, false)), `got ${sponsorBonus(100000, 1, 0, false, false)}`);
check('sponsorBonus teamCount=1 유한', Number.isFinite(sponsorBonus(100000, 1, 1, true, false)));
check('turnoutRate(NaN,NaN) clamp', turnoutRate(NaN, NaN) >= 0.04 || Number.isNaN(turnoutRate(NaN, NaN)), `got ${turnoutRate(NaN, NaN)}`);
console.log('    turnoutRate(NaN,NaN)=', turnoutRate(NaN, NaN), '(NaN 이면 max/min 통과 → 오염)');
{
  const f = settleSeason({ teamId: 't0', rank: 1, teamCount: 0, champion: false, runnerUp: false, winRate: 0.5, fan: 50, fanTotal: 1000, playerFansTotal: 100, payroll: 1000, staff: 100, cashBefore: 100000 });
  check('settleSeason teamCount=0 net 유한', Number.isFinite(f.net), `net ${f.net} bonus ${f.bonus}`);
}
check('applyNet(-Inf) bailout', applyNet(0, -Infinity).bailout === true);
console.log('    applyNet(NaN,5)=', JSON.stringify(applyNet(NaN, 5)), '(NaN<0=false → cash=NaN 전파)');

console.log(`\n=== 요약: FAIL ${bad}건 ===`);
