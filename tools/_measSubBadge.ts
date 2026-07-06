// 동시 교체 배지 실측 — 같은 랠리(point)에 몇 건의 subEvent가 배지로 뜨는지 분포.
//   보드 subEvsNow 필터 재현: e.point===idx && (e.enter || e.setNo===그 point의 setNo)
//   → 배지 행 수(동시 이벤트) 분포와, 사유(kind) 2종 이상 섞인 케이스, side 혼합 케이스를 측정.
//   npx tsx tools/_measSubBadge.ts [matches=500]
import { LEAGUE, getEvolvedTeamPlayers, coachInfoOf, resetLeagueBase } from '../data/league';
import { simulateMatch } from '../engine/match';
import type { Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');

resetLeagueBase();
const ids = LEAGUE.teams.map((t) => t.id);
const sq: Record<string, Player[]> = {};
for (const id of ids) sq[id] = getEvolvedTeamPlayers(id, 0);

const N = Math.max(1, Number(process.argv[2]) || 500);

// 각 point의 setNo — points 배열에서 파생(reconstruct 없이 subEvents.setNo로 curSet 근사).
// 보드 curSet = rallies[idx].setNo. subEvent.setNo == 그 교체가 반영되는 point의 세트라 동일.
const histRows: Record<number, number> = {};   // 배지 행 수 → 발생 횟수
let maxRows = 0, mixedKind = 0, mixedSide = 0, groups = 0, groupsGe2 = 0, groupsGe3 = 0;
let seed = 990000;
const exemplars: string[] = [];

for (let m = 0; m < N; m++) {
  const hi = ids[m % ids.length], ai = ids[(m * 3 + 1) % ids.length];
  if (hi === ai) continue;
  seed += 13;
  const sim = simulateMatch(seed, sq[hi], sq[ai], { home: coachInfoOf(hi), away: coachInfoOf(ai) });
  const evs = sim.subEvents ?? [];
  if (evs.length === 0) continue;

  // point별 그룹(보드는 idx==point 진입 시 그 point의 모든 evs를 subEvsNow로).
  const byPoint = new Map<number, typeof evs>();
  for (const e of evs) {
    const arr = byPoint.get(e.point) ?? [];
    arr.push(e);
    byPoint.set(e.point, arr);
  }
  for (const [pt, arr] of byPoint) {
    // 보드 필터: 그 point의 setNo(그 그룹 이벤트의 setNo — 같은 point면 동일 세트) 로 (enter || setNo===curSet)
    const curSet = arr[0].setNo;
    const shown = arr.filter((e) => e.enter || e.setNo === curSet);
    if (shown.length === 0) continue;
    groups++;
    histRows[shown.length] = (histRows[shown.length] ?? 0) + 1;
    if (shown.length > maxRows) maxRows = shown.length;
    if (shown.length >= 2) groupsGe2++;
    if (shown.length >= 3) groupsGe3++;
    const kinds = new Set(shown.map((e) => `${e.enter ? 'in' : 'out'}:${e.kind}`));
    const sides = new Set(shown.map((e) => e.side));
    if (kinds.size >= 2) {
      mixedKind++;
      if (exemplars.length < 8) exemplars.push(`seed=${seed} pt=${pt} rows=${shown.length} kinds=${[...kinds].join(',')} sides=${[...sides].join(',')}`);
    }
    if (sides.size >= 2) mixedSide++;
  }
}

log(`\n경기 ${N} · 배지 그룹(동시 표시 랠리) ${groups}`);
log(`행 수 분포:`);
for (const k of Object.keys(histRows).map(Number).sort((a, b) => a - b)) {
  log(`  ${k}행: ${histRows[k]} (${(100 * histRows[k] / groups).toFixed(1)}%)`);
}
log(`최대 동시 표시 행 수: ${maxRows}`);
log(`2행 이상 그룹: ${groupsGe2} (${(100 * groupsGe2 / groups).toFixed(1)}%)`);
log(`3행 이상 그룹: ${groupsGe3} (${(100 * groupsGe3 / groups).toFixed(1)}%)`);
log(`사유(kind/enter) 2종 이상 섞인 그룹: ${mixedKind} (${(100 * mixedKind / groups).toFixed(1)}%) — 헤더 단수 버그로 정보 소실되던 케이스`);
log(`side(home/away) 2종 섞인 그룹: ${mixedSide} (${(100 * mixedSide / groups).toFixed(1)}%)`);
if (exemplars.length) { log(`\n혼합 사유 예시:`); for (const e of exemplars) log(`  ${e}`); }
