import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEAGUE } from '../data/league';
import { teamOverall } from './overall';
import { simulateMatchSimple } from './simMatch';
import { attributeProduction, mergeProd, emptyProd, accrueCareer, appendSeasonLine, type ProdLine } from './production';
import type { Player } from '../types';

const home = LEAGUE.teams[0].players.map((id) => LEAGUE.players.find((p) => p.id === id)!) as Player[];
const away = LEAGUE.teams[1].players.map((id) => LEAGUE.players.find((p) => p.id === id)!) as Player[];
const SEED = 12345;

function run(): Map<string, ProdLine> {
  const sim = simulateMatchSimple(SEED, teamOverall(home), teamOverall(away));
  return attributeProduction(sim, home, away, SEED);
}

function sumBy(map: Map<string, ProdLine>, players: Player[], key: keyof ProdLine, pos?: string): number {
  return players
    .filter((p) => !pos || p.position === pos)
    .reduce((s, p) => s + (map.get(p.id)?.[key] ?? 0), 0);
}

test('결정론: 같은 시드/로스터 = 같은 귀속', () => {
  const a = run();
  const b = run();
  for (const [id, l] of a) assert.deepEqual(b.get(id), l);
});

test('공격수(OP/OH)가 미들보다, 미들이 리베로보다 많이 득점', () => {
  const m = run();
  const ohop = sumBy(m, home, 'points', 'OH') + sumBy(m, home, 'points', 'OP');
  const mb = sumBy(m, home, 'points', 'MB');
  const libero = sumBy(m, home, 'points', 'L');
  assert.ok(ohop > mb, `OHOP=${ohop} MB=${mb}`);
  assert.ok(mb >= libero, `MB=${mb} L=${libero}`);
  assert.ok(libero <= 2, `리베로 득점은 거의 없음 L=${libero}`);
});

test('세터는 세트(assist)를 쌓고, 리베로는 디그를 쌓는다', () => {
  const m = run();
  const setterAssists = sumBy(m, home, 'assists', 'S');
  const liberoDigs = sumBy(m, home, 'digs', 'L');
  assert.ok(setterAssists > 0, `세터 세트=${setterAssists}`);
  assert.ok(liberoDigs > 0, `리베로 디그=${liberoDigs}`);
});

test('귀속된 총 득점이 0보다 크고 합산 일관', () => {
  const m = run();
  const totalPoints = [...home, ...away].reduce((s, p) => s + (m.get(p.id)?.points ?? 0), 0);
  assert.ok(totalPoints > 50, `총 득점=${totalPoints}`);
});

test('mergeProd 합산이 올바르다', () => {
  const a: ProdLine = { matches: 1, points: 10, spikes: 8, blocks: 1, aces: 1, assists: 5, digs: 3 };
  const merged = mergeProd(mergeProd(emptyProd(), a), a);
  assert.equal(merged.points, 20);
  assert.equal(merged.matches, 2);
  assert.equal(merged.digs, 6);
});

test('accrueCareer + appendSeasonLine: 통산·시즌 라인 적립(구세이브 assists 미존재 허용)', () => {
  const pr: ProdLine = { matches: 30, points: 400, spikes: 350, blocks: 30, aces: 20, assists: 120, digs: 80 };
  const base = { ...home[0], career: { ...home[0].career } };
  delete (base.career as Partial<typeof base.career>).assists; // 구세이브 모사
  const after = appendSeasonLine(accrueCareer(base, pr), 3, 't1', pr);
  assert.equal(after.career.assists, 120);
  assert.equal(after.career.points, base.career.points + 400);
  assert.equal(after.seasonLines?.length, 1);
  assert.deepEqual(after.seasonLines?.[0], { season: 3, teamId: 't1', matches: 30, points: 400, spikes: 350, blocks: 30, aces: 20, assists: 120, digs: 80 });
  // 같은 시즌 재호출은 덮어쓰기(중복 라인 금지), 다른 시즌은 누적
  const again = appendSeasonLine(appendSeasonLine(after, 3, 't1', pr), 4, 't2', pr);
  assert.equal(again.seasonLines?.length, 2);
  assert.equal(again.seasonLines?.[1].teamId, 't2');
  // 출전 없으면 라인 없음
  assert.equal(appendSeasonLine(base, 5, 't1', undefined).seasonLines, undefined);
});
