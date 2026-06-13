import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalAchievements, achievementSummary, ACHIEVEMENTS, type AchInput } from './achievements';
import type { SeasonAwards } from '../types';

const MY = 'team_a';
const winner = (teamId: string) => ({ playerId: 'p', teamId, value: 1 });
const emptyAwards = (): SeasonAwards => ({
  mvp: null, finalsMvp: null, rookie: null, mostImproved: null,
  titles: { scoring: null, spike: null, block: null, serve: null, dig: null, set: null },
  best7: [], roundMvps: [],
});

const base = (over: Partial<AchInput> = {}): AchInput => ({
  myTeamId: MY, archive: [], hof: [], milestones: [], cash: 50000, fanScore: 50, ...over,
});

const get = (input: AchInput, id: string) => evalAchievements(input).find((s) => s.ach.id === id)!;

test('빈 세이브 — 아무 업적도 달성 안 됨', () => {
  const st = evalAchievements(base());
  assert.equal(achievementSummary(st).done, 0);
  assert.equal(achievementSummary(st).total, ACHIEVEMENTS.length);
});

test('첫 우승 — 내 팀 우승 시 달성', () => {
  const yes = base({ archive: [{ season: 0, championId: MY }] });
  assert.equal(get(yes, 'first_title').unlocked, true);
  const no = base({ archive: [{ season: 0, championId: 'other' }] });
  assert.equal(get(no, 'first_title').unlocked, false);
});

test('연패 — 3연속만 왕조, 비연속은 미달성', () => {
  const consec = base({ archive: [0, 1, 2].map((s) => ({ season: s, championId: MY })) });
  assert.equal(get(consec, 'back_to_back').unlocked, true);
  assert.equal(get(consec, 'three_peat').unlocked, true);
  const gap = base({ archive: [{ season: 0, championId: MY }, { season: 1, championId: 'x' }, { season: 2, championId: MY }] });
  assert.equal(get(gap, 'three_peat').unlocked, false);
  assert.equal(get(gap, 'back_to_back').unlocked, false);
});

test('통산 우승 진행치 — 미달성도 cur 누적', () => {
  const three = base({ archive: [0, 1, 2].map((s) => ({ season: s, championId: MY })) });
  const t5 = get(three, 'titles_5');
  assert.equal(t5.cur, 3);
  assert.equal(t5.unlocked, false);
});

test('베스트7 3인 — 한 시즌 동시 3명', () => {
  const a = emptyAwards();
  a.best7 = [
    { pos: 'S', winner: winner(MY) }, { pos: 'OH', winner: winner(MY) },
    { pos: 'OP', winner: winner(MY) }, { pos: 'MB', winner: winner('x') },
  ];
  const yes = base({ archive: [{ season: 0, championId: 'x', awards: a }] });
  assert.equal(get(yes, 'best7_trio').unlocked, true);
  assert.equal(get(yes, 'best7_trio').cur, 3);
});

test('기록왕 5회 — 여러 시즌·부문 누적', () => {
  const mk = (season: number) => {
    const a = emptyAwards();
    a.titles.scoring = winner(MY);
    a.titles.block = winner(MY);
    return { season, championId: 'x', awards: a };
  };
  const input = base({ archive: [mk(0), mk(1), mk(2)] }); // 2부문 × 3시즌 = 6
  assert.equal(get(input, 'title_kings_5').cur, 5); // target에서 클램프
  assert.equal(get(input, 'title_kings_5').unlocked, true);
});

test('레전드/HOF — 영구결번과 5명 배출', () => {
  const hof = (legend: boolean, teamId = MY) => ({ id: 'h', name: 'n', position: 'OH' as const, teamId, seasons: 12, points: 9999, blocks: 0, digs: 0, retiredSeason: 5, legend });
  const legendInput = base({ hof: [hof(true)] });
  assert.equal(get(legendInput, 'make_legend').unlocked, true);
  assert.equal(get(legendInput, 'first_hof').unlocked, true);
  const five = base({ hof: [hof(false), hof(false), hof(false), hof(false), hof(false), hof(false, 'other')] });
  assert.equal(get(five, 'hof_5').cur, 5);
  assert.equal(get(five, 'hof_5').unlocked, true);
});

test('운영 — 자금·팬심·시즌수 임계', () => {
  assert.equal(get(base({ cash: 200000 }), 'cash_200k').unlocked, true);
  assert.equal(get(base({ cash: 199999 }), 'cash_200k').unlocked, false);
  assert.equal(get(base({ fanScore: 90 }), 'fan_90').unlocked, true);
  assert.equal(get(base({ archive: Array.from({ length: 50 }, (_, s) => ({ season: s, championId: 'x' })) }), 'seasons_50').unlocked, true);
});

test('순위 — 모든 순위 경험·만년 2위·가을 단골', () => {
  // 4시즌: 내 팀 순위 1·2·3·7 (standings = 순위순 teamId)
  const arch = (season: number, order: string[]) => ({ season, championId: 'x', standings: order });
  const ranks = [[MY, 'b', 'c', 'd', 'e', 'f', 'g'], ['b', MY, 'c', 'd', 'e', 'f', 'g'], ['b', 'c', MY, 'd', 'e', 'f', 'g'], ['b', 'c', 'd', 'e', 'f', 'g', MY]];
  const input = base({ archive: ranks.map((o, s) => arch(s, o)) });
  assert.equal(get(input, 'all_ranks').cur, 4); // 1·2·3·7 = 4종
  assert.equal(get(input, 'podium_10').cur, 3); // 1·2·3위 = 3회
  assert.equal(get(input, 'runner_up_3').cur, 1); // 2위 1회
});

test('꼴찌 3연속 — 암흑기', () => {
  const last = (season: number) => ({ season, championId: 'x', standings: ['b', 'c', 'd', 'e', 'f', 'g', MY] });
  const yes = base({ archive: [0, 1, 2].map(last) });
  assert.equal(get(yes, 'last_3peat').unlocked, true);
  const gap = base({ archive: [last(0), { season: 1, championId: 'x', standings: [MY, 'b', 'c', 'd', 'e', 'f', 'g'] }, last(2)] });
  assert.equal(get(gap, 'last_3peat').unlocked, false);
});

test('최하위의 반란 — 꼴찌 이듬해 가을야구', () => {
  const yes = base({ archive: [
    { season: 0, championId: 'x', standings: ['b', 'c', 'd', 'e', 'f', 'g', MY] }, // 꼴찌
    { season: 1, championId: 'x', standings: ['b', 'c', MY, 'd', 'e', 'f', 'g'] }, // 3위
  ] });
  assert.equal(get(yes, 'worst_to_first').unlocked, true);
});

test('연승/연패 — 시즌 최장 스트릭', () => {
  const input = base({ archive: [
    { season: 0, championId: 'x', streaks: { [MY]: [12, 3] } },
    { season: 1, championId: 'x', streaks: { [MY]: [4, 11] } },
  ] });
  assert.equal(get(input, 'win_streak_10').unlocked, true);  // 최장 12연승
  assert.equal(get(input, 'win_streak_15').unlocked, false); // 15엔 못 미침
  assert.equal(get(input, 'lose_streak_10').unlocked, true); // 최장 11연패
});

test('플옵 서사 — 리버스 스윕·스윕·블론', () => {
  const rev = base({ archive: [{ season: 0, championId: MY, series: { [MY]: [['L', 'L', 'W', 'W', 'W']] } }] });
  assert.equal(get(rev, 'reverse_sweep').unlocked, true);
  assert.equal(get(rev, 'blown_lead').unlocked, false);
  const sweep = base({ archive: [{ season: 0, championId: MY, series: { [MY]: [['W', 'W', 'W']] } }] });
  assert.equal(get(sweep, 'sweep_title').unlocked, true);
  const blown = base({ archive: [{ season: 0, championId: 'x', series: { [MY]: [['W', 'W', 'L', 'L', 'L']] } }] });
  assert.equal(get(blown, 'blown_lead').unlocked, true);
  assert.equal(get(blown, 'reverse_sweep').unlocked, false);
});

test('단장 — careerLog 기반 GM 액션', () => {
  const cl = (over: Partial<{ faSigns: number; coachHires: number; staffHires: number; interviews: number }>) =>
    base({ careerLog: { faSigns: 0, coachHires: 0, staffHires: 0, interviews: 0, ...over } });
  assert.equal(get(cl({ faSigns: 1 }), 'first_fa').unlocked, true);
  assert.equal(get(cl({ faSigns: 15 }), 'fa_mogul').unlocked, true);
  assert.equal(get(cl({ coachHires: 1 }), 'first_coach').unlocked, true);
  assert.equal(get(cl({ interviews: 20 }), 'interview_master').unlocked, true);
  assert.equal(get(cl({ interviews: 19 }), 'interview_master').unlocked, false);
  // 드래프트는 시즌수 파생(careerLog 무관)
  assert.equal(get(base({ archive: [{ season: 0, championId: 'x' }] }), 'first_draft').unlocked, true);
  assert.equal(get(base(), 'first_draft').unlocked, false);
});

test('결정론 — 같은 입력 = 같은 결과', () => {
  const input = base({ archive: [{ season: 0, championId: MY }], cash: 123456, fanScore: 77 });
  assert.deepEqual(evalAchievements(input), evalAchievements(input));
});
