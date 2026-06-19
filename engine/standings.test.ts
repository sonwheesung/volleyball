// 순위·승점 단위 테스트 (data/standings) — 테스트 러너가 engine/**만 globbing하므로 여기 둔다
// (production.test.ts가 data/league를 import하는 것과 동일한 교차 레이어 패턴).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetLeagueBase, LEAGUE } from '../data/league';
import { matchPoints, computeStandings, type Standing } from '../data/standings';

test('승점(KOVO): 3-0/3-1=3 · 3-2=2 · 2-3=1 · 0-3=0', () => {
  assert.deepEqual(matchPoints(3, 0), [3, 0]);
  assert.deepEqual(matchPoints(3, 1), [3, 0]);
  assert.deepEqual(matchPoints(3, 2), [2, 1]);
});

test('순위표: 승점 내림차순 정렬 + 필드 일관', () => {
  resetLeagueBase();
  const s = computeStandings(Number.MAX_SAFE_INTEGER);
  assert.ok(s.length >= 2, '팀 존재');
  for (let i = 0; i + 1 < s.length; i++) {
    assert.ok(s[i].points >= s[i + 1].points, `승점 내림차순 (${s[i].points} >= ${s[i + 1].points})`);
  }
  for (const t of s) {
    assert.ok(t.points >= 0 && t.points <= 3 * t.played, `승점 0~3×경기 (${t.points}/${t.played})`);
    assert.equal(t.wins + t.losses, t.played, '승+패=경기');
    assert.ok(t.setsWon >= 0 && t.setsLost >= 0 && t.pointsWon >= 0 && t.pointsLost >= 0, '세트·점수 음수 아님');
  }
});

test('시즌 초(0경기/0세트실): 비율 타이브레이크 div-by-zero 없음', () => {
  resetLeagueBase();
  const s0 = computeStandings(0); // 첫 경기일 — 일부 팀 0경기
  assert.equal(s0.length, LEAGUE.teams.length, '전 팀 포함');
  for (const t of s0) {
    assert.ok(Number.isFinite(t.points), `승점 유한(${t.points})`);
    assert.ok(t.played >= 0 && Number.isFinite(t.setsWon / Math.max(1, t.setsLost)), '세트율 계산 안전');
  }
  // 0경기 팀이 존재하면(시즌 초 가능) NaN 없이 정렬 — 순서가 깨지지 않음
  const zeroGame = s0.find((t) => t.played === 0);
  if (zeroGame) assert.equal(zeroGame.points, 0, '0경기 팀 승점 0');
});

test('승점 타이브레이크: 동점 시 승률→세트득실률 순서 보장', () => {
  resetLeagueBase();
  const s = computeStandings(Number.MAX_SAFE_INTEGER);
  const wr = (x: Standing) => (x.played ? x.wins / x.played : 0);
  const sr = (x: Standing) => (x.setsLost ? x.setsWon / x.setsLost : x.setsWon > 0 ? Infinity : 0);
  for (let i = 0; i + 1 < s.length; i++) {
    if (s[i].points !== s[i + 1].points) continue; // 승점 동률 쌍만
    const a = s[i], b = s[i + 1];
    assert.ok(wr(a) > wr(b) || (wr(a) === wr(b) && sr(a) >= sr(b)),
      `동점(${a.points}) 타이브레이크: ${a.teamId}(승률${wr(a).toFixed(2)}·세트율${sr(a).toFixed(2)}) ≥ ${b.teamId}`);
  }
});
