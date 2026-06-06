import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEAGUE } from '../data/league';
import { teamOverall } from './overall';
import { simulateMatchSimple } from './simMatch';
import { attributeProduction, mergeProd, emptyProd, type ProdLine } from './production';
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
