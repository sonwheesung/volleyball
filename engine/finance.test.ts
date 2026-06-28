import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sponsorBase, sponsorBonus, turnoutRate, gateRevenue, merchRevenue, settleSeason, applyNet, sponsorThrift } from './finance';

test('모기업 베이스: 팀별 차등 24.3~32.3억, 결정론', () => {
  const a = sponsorBase('t1');
  assert.ok(a >= 243000 && a <= 323000); // 2026-06-28 FINANCE 2.0 Stage1: v2 체력 재조율(250000→243000)

  assert.equal(sponsorBase('t1'), a);
  assert.notEqual(sponsorBase('t1'), sponsorBase('t2')); // 모기업이 다르면 지갑도 다르다(높은 확률)
});

test('성적 보너스: "정규 2위에 플옵 준우승이라 모기업이 더 쏜다"', () => {
  const base = 240000;
  const champFirst = sponsorBonus(base, 1, 7, true, false);
  const runner2nd = sponsorBonus(base, 2, 7, false, true);
  const just2nd = sponsorBonus(base, 2, 7, false, false);
  const last = sponsorBonus(base, 7, 7, false, false);
  assert.ok(champFirst > runner2nd && runner2nd > just2nd && just2nd > last);
  assert.equal(last, 0);
});

test('직관율: 팬은 남아도 발길이 끊긴다 — 성적이 팬심보다 민감', () => {
  const winSwing = turnoutRate(0.8, 50) - turnoutRate(0.2, 50);   // 성적 ±
  const fanSwing = turnoutRate(0.5, 100) - turnoutRate(0.5, 0);   // 팬심 ±
  assert.ok(winSwing > fanSwing, `성적 효과 ${winSwing} > 팬심 효과 ${fanSwing}`);
  assert.ok(turnoutRate(0, 0) >= 0.04 && turnoutRate(1, 100) <= 0.16);
});

test('정산: 수입 분해 합산 + 순익 + 보전', () => {
  const f = settleSeason({
    teamId: 't1', rank: 2, teamCount: 7, champion: false, runnerUp: true,
    winRate: 0.65, fan: 60, fanTotal: 50000, playerFansTotal: 60000,
    payroll: 300000, staff: 6000, cashBefore: 0,
  });
  assert.equal(f.income, f.sponsor + f.bonus + f.gate + f.merch);
  assert.equal(f.net, f.income - f.expense);
  assert.equal(f.gate, gateRevenue(f.attendance));
  assert.equal(f.merch, merchRevenue(60000));
  assert.ok(f.attendance > 2000 && f.attendance < 8000, `평균 관중 ${f.attendance}`);
  assert.deepEqual(applyNet(10000, -50000), { cash: 0, bailout: true });  // 모기업 보전
  assert.deepEqual(applyNet(10000, 5000), { cash: 15000, bailout: false });
});

test('sponsorThrift: 잔고 적을수록 전액 지원(<15억=1·<50억=0.85·이상=0.7)', () => {
  assert.equal(sponsorThrift(100000), 1);    // 15억 미만 — 전액 지원
  assert.equal(sponsorThrift(200000), 0.85); // 50억 미만 — 약간 긴축
  assert.equal(sponsorThrift(600000), 0.7);  // 그 이상 — 긴축
});
