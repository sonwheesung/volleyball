import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSeasonAwards, impactScore, type AwardsInput } from './awards';
import type { Player, Position } from '../types';
import type { ProdLine } from './production';

const L = (o: Partial<ProdLine>): ProdLine =>
  ({ matches: 1, points: 0, spikes: 0, backSpikes: 0, blocks: 0, aces: 0, assists: 0, digs: 0, receives: 0, ...o });

// position 만 필요 — 나머지는 더미
const P = (pos: Position): Player => ({
  id: '', name: '', age: 25, position: pos, isForeign: false, height: 180,
  jump: 60, agility: 60, staminaMax: 60, staminaRegen: 60, reaction: 60, positioning: 60, focus: 60, consistency: 60, vq: 60,
  skSpike: 50, skBlock: 50, skDig: 50, skReceive: 50, skSet: 50, skServe: 50,
  xp: {}, potential: {} as Player['potential'], talentBase: 1, catTalent: { physical: 1, skill: 1, mental: 1 },
  contract: { salary: 0, years: 1, remaining: 1, signedAtAge: 25 }, clubTenure: 1, peakAge: 28,
  career: { seasons: 1, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0, assists: 0 },
});

function build(
  rows: { id: string; pos: Position; team: string; line: ProdLine }[],
  opts: Partial<AwardsInput> = {},
): AwardsInput {
  const prod = new Map(rows.map((r) => [r.id, r.line]));
  const pos = new Map(rows.map((r) => [r.id, r.pos]));
  const team = new Map(rows.map((r) => [r.id, r.team]));
  return {
    prod,
    player: (id) => (pos.has(id) ? P(pos.get(id)!) : undefined),
    teamOf: (id) => team.get(id),
    teamRank: opts.teamRank ?? new Map([['T1', 0], ['T2', 1]]),
    teamCount: opts.teamCount ?? 2,
    rookies: opts.rookies ?? new Set(),
    priorImpact: opts.priorImpact ?? new Map(),
    mostImprovedReady: opts.mostImprovedReady ?? true,
    championId: opts.championId ?? null,
    legProd: opts.legProd ?? [],
  };
}

test('MVP: 팀 성적 가중 — 약체팀 최다득점보다 강팀 에이스', () => {
  // 약체(꼴찌) 에이스 500점 vs 강팀(1위) 에이스 420점
  const input = build([
    { id: 'weak', pos: 'OP', team: 'T2', line: L({ points: 500 }) },
    { id: 'strong', pos: 'OP', team: 'T1', line: L({ points: 420 }) },
  ]);
  const a = computeSeasonAwards(input);
  // weak: 500×0.5=250, strong: 420×1.0=420 → strong MVP
  assert.equal(a.mvp?.playerId, 'strong', '강팀 에이스가 MVP');
  // 득점왕은 순수 1위 → weak
  assert.equal(a.titles.scoring?.playerId, 'weak', '득점왕은 약체팀 최다득점');
});

test('부문 기록왕: 순수 1위(팀 무관)', () => {
  const a = computeSeasonAwards(build([
    { id: 'b', pos: 'MB', team: 'T2', line: L({ points: 100, blocks: 90 }) },
    { id: 's', pos: 'L', team: 'T1', line: L({ digs: 300 }) },
    { id: 'srv', pos: 'OH', team: 'T2', line: L({ points: 80, aces: 40 }) },
  ]));
  assert.equal(a.titles.block?.playerId, 'b');
  assert.equal(a.titles.dig?.playerId, 's');
  assert.equal(a.titles.serve?.playerId, 'srv');
});

test('신인상/기량발전상: 신인 풀·생산 Δ 기준(비신인·전시즌 라인 필수)', () => {
  const a = computeSeasonAwards(build(
    [
      { id: 'rook', pos: 'OH', team: 'T1', line: L({ matches: 30, points: 200 }) },
      { id: 'vet', pos: 'OP', team: 'T1', line: L({ matches: 30, points: 400 }) },
    ],
    {
      rookies: new Set(['rook']),
      priorImpact: new Map([['vet', 100], ['rook', 50]]), // vet 전시즌 임팩트 100 → Δ=300
      mostImprovedReady: true,
    },
  ));
  assert.equal(a.rookie?.playerId, 'rook', '신인상=신인 중 최고');
  assert.equal(a.mostImproved?.playerId, 'vet', '기량발전상은 신인 제외 → vet');
  assert.equal(a.mostImproved?.value, 300, 'value = 올시즌 생산 임팩트 − 전시즌 임팩트(Δ)');
});

test('기량발전상 자격 게이트(AWARDS_SYSTEM §9)', () => {
  // 전시즌 라인 없음(priorImpact 엔트리 없음) → 후보 배제(신규 외국인/데뷔직후 오수상 봉인)
  const noPrior = computeSeasonAwards(build(
    [{ id: 'imp', pos: 'OP', team: 'T1', line: L({ matches: 30, points: 500 }) }],
    { priorImpact: new Map(), mostImprovedReady: true },
  ));
  assert.equal(noPrior.mostImproved, null, '전시즌 라인 없으면 미수상');

  // matches < MIN_IMPROVE_MATCHES(10) → 후보 배제(핀치서브 프린지)
  const fewMatches = computeSeasonAwards(build(
    [{ id: 'imp', pos: 'OP', team: 'T1', line: L({ matches: 5, points: 500 }) }],
    { priorImpact: new Map([['imp', 0]]), mostImprovedReady: true },
  ));
  assert.equal(fewMatches.mostImproved, null, '최소 출전 미달이면 미수상');

  // Δ<=0(하락/정체) → 후보 배제
  const declined = computeSeasonAwards(build(
    [{ id: 'imp', pos: 'OP', team: 'T1', line: L({ matches: 30, points: 100 }) }],
    { priorImpact: new Map([['imp', 200]]), mostImprovedReady: true },
  ));
  assert.equal(declined.mostImproved, null, 'Δ≤0이면 미수상');

  // 프리뷰 게이트: mostImprovedReady=false(시즌 집계 중) → null
  const preview = computeSeasonAwards(build(
    [{ id: 'imp', pos: 'OP', team: 'T1', line: L({ matches: 30, points: 500 }) }],
    { priorImpact: new Map([['imp', 100]]), mostImprovedReady: false },
  ));
  assert.equal(preview.mostImproved, null, '집계 중(ready=false)엔 null');
});

test('베스트7: 슬롯별 최고, 중복 없음, OH/MB 2명', () => {
  const a = computeSeasonAwards(build([
    { id: 'set', pos: 'S', team: 'T1', line: L({ assists: 500 }) },
    { id: 'oh1', pos: 'OH', team: 'T1', line: L({ points: 300 }) },
    { id: 'oh2', pos: 'OH', team: 'T2', line: L({ points: 250 }) },
    { id: 'oh3', pos: 'OH', team: 'T2', line: L({ points: 100 }) },
    { id: 'op', pos: 'OP', team: 'T1', line: L({ points: 480 }) },
    { id: 'mb1', pos: 'MB', team: 'T1', line: L({ points: 200 }) },
    { id: 'mb2', pos: 'MB', team: 'T2', line: L({ points: 150 }) },
    { id: 'lib', pos: 'L', team: 'T2', line: L({ digs: 400 }) },
  ]));
  const slots = a.best7.map((s) => s.winner?.playerId);
  assert.deepEqual(slots, ['set', 'oh1', 'oh2', 'op', 'mb1', 'mb2', 'lib']);
  assert.equal(new Set(slots).size, 7, '중복 없음');
});

test('라운드 MVP: leg별 최고 임팩트', () => {
  const leg1 = new Map([['x', L({ points: 80 })], ['y', L({ points: 50 })]]);
  const leg2 = new Map([['y', L({ points: 90 })]]);
  const a = computeSeasonAwards(build(
    [{ id: 'x', pos: 'OP', team: 'T1', line: L({ points: 130 }) }, { id: 'y', pos: 'OP', team: 'T2', line: L({ points: 140 }) }],
    { legProd: [leg1, leg2] },
  ));
  assert.equal(a.roundMvps[0]?.playerId, 'x');
  assert.equal(a.roundMvps[1]?.playerId, 'y');
});

test('동률은 id 사전순으로 결정론 해소', () => {
  const a = computeSeasonAwards(build([
    { id: 'bbb', pos: 'OP', team: 'T1', line: L({ points: 300 }) },
    { id: 'aaa', pos: 'OP', team: 'T1', line: L({ points: 300 }) },
  ]));
  assert.equal(a.titles.scoring?.playerId, 'aaa', '동점이면 사전순 앞');
});

test('빈 입력 안전', () => {
  const a = computeSeasonAwards(build([]));
  assert.equal(a.mvp, null);
  assert.equal(a.best7.length, 7);
  assert.ok(a.best7.every((s) => s.winner === null));
});

test('impactScore: 득점 위주 + 어시/디그 가중', () => {
  assert.ok(impactScore(L({ points: 100 })) > impactScore(L({ assists: 100 })));
  assert.ok(impactScore(L({ assists: 100 })) > 0);
});
