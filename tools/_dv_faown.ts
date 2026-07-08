// 이음매 상설 가드 — 내 원소속 FA 재영입은 보상 없음(FA_SYSTEM §2.2). 검증=Fable / 구현·문서=Opus (2026-07-08).
//   npx tsx tools/_dv_faown.ts   (exit 0/1)
//
// 불변식(동일 입력, prevTeamOf[target]만 플립하는 순수 A/B):
//   · 자기 FA 재영입(prevTeamOf===myTeam) → compCash == 0 (보상금·차감·게이트 모두)
//   · 타 구단 FA 영입(prevTeamOf!==myTeam) → compCash == compensationMoney(등급, 직전연봉) > 0 (가드 이빨)
// resetLeagueBase 로 스토어 컨텍스트(archive/bonds/scandal 기본값) 확보 후 resolveFAMarket 직접 구동.
import './_gt_mock';

import { resetLeagueBase } from '../data/league';
import { resolveFAMarket } from '../data/offseason';
import { setSalaryEra } from '../data/awardSalary';
import { assignFAGrades } from '../engine/faMarket';
import { compensationMoney } from '../engine/compensation';
import type { Player, Position, TrainableStat } from '../types';
import { TRAINABLE_STATS } from '../engine/training';

const BIG_CASH = 99_999_999;
let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

function mk(id: string, pos: Position, salary: number, v = 76): Player {
  const potential = {} as Record<TrainableStat, number>;
  for (const s of TRAINABLE_STATS) potential[s] = 88;
  return {
    id, name: id, age: 29, position: pos, isForeign: false, height: 182,
    jump: v, agility: v, staminaMax: v, staminaRegen: v, reaction: v, positioning: v,
    focus: v, consistency: v, vq: v, skSpike: v, skBlock: v, skDig: v, skReceive: v, skSet: v, skServe: v,
    xp: {}, potential, talentBase: 1, catTalent: { physical: 1, skill: 1, mental: 1 },
    contract: { salary, years: 1, remaining: 0, signedAtAge: 28 }, clubTenure: 8, peakAge: 28,
    career: { seasons: 8, matches: 100, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0, assists: 0 },
  };
}

/** 합성 오프시즌 상태 — 타깃 OH 1명(고연봉=A) + 필러 3명(풀), t0(내 팀, OH 여유) · t1(OH 만석=미입찰). */
function buildOff() {
  const snapshot: Record<string, Player> = {};
  const target = mk('target', 'OH', 40000);
  const fillers = [mk('f1', 'OH', 30000), mk('f2', 'MB', 20000), mk('f3', 'S', 10000)];
  for (const p of [target, ...fillers]) snapshot[p.id] = p;
  // t0(내 팀): OH 2명(gap>0 — 입찰·영입 여지). t1(타 팀): OH 5명(gap 0 — 타깃 미입찰).
  const t0roster = [mk('t0a', 'OH', 15000), mk('t0b', 'MB', 15000)];
  const t1roster: Player[] = [];
  for (let i = 0; i < 5; i++) t1roster.push(mk(`t1oh${i}`, 'OH', 15000));
  for (const p of [...t0roster, ...t1roster]) snapshot[p.id] = p;
  return {
    snapshot,
    rosters: { t0: t0roster.map((p) => p.id), t1: t1roster.map((p) => p.id) } as Record<string, string[]>,
    pool: [target.id, ...fillers.map((p) => p.id)],
    targetId: target.id, targetSalary: target.contract.salary,
  };
}

function run(prevTeamForTarget: string): { compCash: number; signed: boolean } {
  const off = buildOff();
  const prevTeamOf: Record<string, string> = { [off.targetId]: prevTeamForTarget };
  const res = resolveFAMarket(
    { snapshot: off.snapshot, rosters: off.rosters, pool: off.pool },
    't0', [off.targetId], true, [], prevTeamOf, 1, { t0: 0, t1: 0 }, undefined, BIG_CASH, [],
  );
  return { compCash: res.compCash, signed: res.signedByMe.includes(off.targetId) };
}

resetLeagueBase();
setSalaryEra(66);

// 등급 확인 — 타깃이 A(보상 필요)여야 A/B가 유의미
{
  const off = buildOff();
  const grades = assignFAGrades(off.pool.map((id) => off.snapshot[id]).filter((p): p is Player => !!p));
  console.log(`── 타깃 등급: ${grades.get(off.targetId)} (A/B여야 보상 대상) · 직전연봉 ${off.targetSalary} ──`);
  ok(grades.get(off.targetId) === 'A', '타깃 = A등급(보상 필요)');
}

// ── 자기 FA 재영입: compCash == 0 ──
console.log('── 자기 원소속 FA 재영입(prevTeamOf===myTeam) ──');
const self = run('t0');
ok(self.signed, '타깃이 내 팀에 영입됨(단독 입찰)');
ok(self.compCash === 0, `자기 FA 재영입 보상금 0 (실제 ${self.compCash})`);

// ── A/B: 타 구단 FA 영입: compCash > 0 (== compensationMoney A) ──
console.log('── [A/B] 타 구단 FA 영입(prevTeamOf!==myTeam) ──');
const other = run('t1');
const expected = compensationMoney('A', 40000); // A = 2.0×
ok(other.signed, '타깃이 내 팀에 영입됨(단독 입찰)');
ok(other.compCash === expected, `타 구단 FA 보상금 ${other.compCash} == compensationMoney(A, 40000)=${expected} (>0 — 가드 이빨)`);
ok(other.compCash > self.compCash, `[A/B] 타 구단(${other.compCash}) > 자기 FA(${self.compCash}) — prevTeamOf 게이트가 유효`);

console.log(fail === 0 ? '\n✅ PASS — 자기 FA 재영입 보상 면제 가드 통과' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
