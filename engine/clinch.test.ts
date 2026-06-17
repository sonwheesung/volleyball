import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clinchStatus, type ClinchInput } from './clinch';

const T = (teamId: string, wins: number, remaining: number): ClinchInput => ({ teamId, wins, remaining });
const stateOf = (rs: ReturnType<typeof clinchStatus>, id: string) => rs.find((r) => r.teamId === id)!;

test('확정: 최악에도 상위 3 안이면 clinched (동률 보수 처리)', () => {
  // A 20승 잔여0. 나를 앞지를 수 있는 팀(max>=20)이 2팀뿐 → 3위 밖으로 못 밀림 → 확정
  const teams = [T('A', 20, 0), T('B', 18, 2), T('C', 18, 2), T('D', 10, 2), T('E', 9, 2), T('F', 8, 2), T('G', 5, 2)];
  const rs = clinchStatus(teams, 3);
  assert.equal(stateOf(rs, 'A').state, 'clinched');
  assert.equal(stateOf(rs, 'A').magic, 0);
});

test('탈락: 다 이겨도 확실히 위인 팀이 3 이상이면 eliminated', () => {
  // G 2승 잔여2 → 최대4. 최소승 > 4인 팀(A,B,C,D = 5승 이상)이 4팀 → 탈락
  const teams = [T('A', 12, 0), T('B', 10, 0), T('C', 8, 0), T('D', 5, 0), T('E', 4, 0), T('F', 3, 1), T('G', 2, 2)];
  const rs = clinchStatus(teams, 3);
  assert.equal(stateOf(rs, 'G').state, 'eliminated');
  assert.equal(stateOf(rs, 'G').magic, null);
});

test('경합 + 매직넘버: 자력 확정에 필요한 최소 승수', () => {
  // 모두 비슷한 중위권, 잔여 많음 → contention. 매직넘버는 1 이상.
  const teams = [T('A', 10, 6), T('B', 10, 6), T('C', 9, 6), T('D', 9, 6), T('E', 8, 6), T('F', 8, 6), T('G', 7, 6)];
  const rs = clinchStatus(teams, 3);
  const a = stateOf(rs, 'A');
  assert.equal(a.state, 'contention');
  assert.ok(a.magic !== null && a.magic >= 1 && a.magic <= 6, `magic=${a.magic}`);
});

test('보수성 불변: clinched 팀 수 <= cutoff, eliminated는 상위권에 없음', () => {
  const teams = [T('A', 22, 0), T('B', 20, 0), T('C', 19, 0), T('D', 12, 2), T('E', 10, 2), T('F', 6, 2), T('G', 3, 2)];
  const rs = clinchStatus(teams, 3);
  const clinched = rs.filter((r) => r.state === 'clinched');
  assert.ok(clinched.length <= 3, `clinched ${clinched.length} > 3`);
  // 확정 팀은 현재 상위 3위 안
  for (const c of clinched) assert.ok(c.rank <= 3, `${c.teamId} clinched but rank ${c.rank}`);
});

test('시즌 종료(잔여0): 상위 cutoff는 clinched, 나머지는 eliminated', () => {
  const teams = [T('A', 22, 0), T('B', 20, 0), T('C', 18, 0), T('D', 16, 0), T('E', 14, 0), T('F', 12, 0), T('G', 10, 0)];
  const rs = clinchStatus(teams, 3);
  assert.equal(stateOf(rs, 'A').state, 'clinched');
  assert.equal(stateOf(rs, 'B').state, 'clinched');
  assert.equal(stateOf(rs, 'C').state, 'clinched');
  assert.equal(stateOf(rs, 'D').state, 'eliminated');
  assert.equal(stateOf(rs, 'G').state, 'eliminated');
});
