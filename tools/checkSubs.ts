// 작전 교체 연출 로그(subEvents) 검증 + 빈도 측정.
//   npx tsx tools/checkSubs.ts [matches=400]
// 추정 금지: subEvents 가 (1) 일관(슬롯·id·정렬), (2) 재생 시 세트말마다 base 로 원복(net-zero),
//   (3) enter 시점 슬롯 점유자가 inId 와 일치 — 를 실제 시뮬로 확인. 빈도도 측정.
import { LEAGUE, getEvolvedTeamPlayers, coachInfoOf, resetLeagueBase } from '../data/league';
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { applySubsToSix } from '../components/courtDirector';
import type { Player, Side } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');

resetLeagueBase();
const ids = LEAGUE.teams.map((t) => t.id);
const sq: Record<string, Player[]> = {};
for (const id of ids) sq[id] = getEvolvedTeamPlayers(id, 0);

const N = Math.max(1, Number(process.argv[2]) || 400);

let matches = 0, withSubs = 0, totalEvents = 0, totalEnters = 0;
let failConsistency = 0, failNetZero = 0, failOccupant = 0, failOrder = 0;
const kindCount: Record<string, number> = { pinch: 0, block: 0, def: 0 };

let seed = 990000;
for (let m = 0; m < N; m++) {
  const hi = ids[m % ids.length], ai = ids[(m * 3 + 1) % ids.length];
  if (hi === ai) continue;
  seed += 13;
  const home = sq[hi], away = sq[ai];
  const sim = simulateMatch(seed, home, away, { home: coachInfoOf(hi), away: coachInfoOf(ai) });
  matches++;
  const evs = sim.subEvents ?? [];
  if (evs.length > 0) withSubs++;
  totalEvents += evs.length;

  const byId = new Map<string, Player>();
  for (const p of home) byId.set(p.id, p);
  for (const p of away) byId.set(p.id, p);
  const baseSix: Record<Side, Player[]> = { home: buildLineup(home).six, away: buildLineup(away).six };
  const idsOf = (ps: Player[]) => new Set(ps.map((p) => p.id));
  const squadIds: Record<Side, Set<string>> = { home: idsOf(home), away: idsOf(away) };

  // (1) 일관성 + 정렬
  let lastPoint = -1;
  for (const e of evs) {
    if (e.point < lastPoint) failOrder++;
    lastPoint = e.point;
    const ok = e.slot >= 0 && e.slot < 6 && e.point >= 0 && e.point <= sim.points.length
      && squadIds[e.side].has(e.inId) && squadIds[e.side].has(e.outId);
    if (!ok) failConsistency++;
    if (e.enter) { totalEnters++; kindCount[e.kind] = (kindCount[e.kind] ?? 0) + 1; }
  }

  // (2) net-zero: 전체 재생 후 base 로 원복(세트말 원복이 모두 기록됐는지)
  for (const side of ['home', 'away'] as Side[]) {
    const final = applySubsToSix(baseSix[side], side, evs, sim.points.length, byId);
    const same = final.length === baseSix[side].length && final.every((p, i) => p.id === baseSix[side][i].id);
    if (!same) failNetZero++;
  }

  // (3) enter 점유자 일치: enter 직후(그 point) 재생하면 그 슬롯에 inId 가 있어야
  for (const e of evs) {
    if (!e.enter) continue;
    const six = applySubsToSix(baseSix[e.side], e.side, evs, e.point, byId);
    if (six[e.slot]?.id !== e.inId) failOccupant++;
  }
}

log(`\n경기 ${matches}건 · 교체 있던 경기 ${withSubs} (${(100 * withSubs / matches).toFixed(0)}%)`);
log(`총 교체 이벤트 ${totalEvents} (경기당 ${(totalEvents / matches).toFixed(1)}) · 그중 투입(enter) ${totalEnters}`);
log(`투입 종류: 핀치서버 ${kindCount.pinch} · 블로킹 ${kindCount.block} · 수비 ${kindCount.def}`);
log('\n검증:');
const assert = (c: boolean, label: string, detail = '') => log(`  ${c ? 'PASS' : 'FAIL ❌'} — ${label}${detail}`);
assert(failOrder === 0, 'subEvents point 오름차순', failOrder ? ` (위반 ${failOrder})` : '');
assert(failConsistency === 0, '슬롯 0..5 · in/out id 소속·point 범위', failConsistency ? ` (위반 ${failConsistency})` : '');
assert(failNetZero === 0, '전체 재생 → base 원복(세트말 net-zero)', failNetZero ? ` (위반 ${failNetZero})` : '');
assert(failOccupant === 0, 'enter 시점 슬롯 점유자 == inId', failOccupant ? ` (위반 ${failOccupant})` : '');
assert(withSubs > 0, '실제 경기에서 교체가 발동함(연출이 켜짐)');
log('완료.');
