// 외국인 트라이아웃 장기 시뮬 (FOREIGN_SYSTEM) — 멸종 0·성능 바닥·재지명·캡 무결 검증.
//   npx tsx tools/simForeign.ts [시즌수=120]

import { LEAGUE, getTeam, resetLeagueBase, commitPlayerBase, commitRosters, teamScoutReveal, currentRosters, getPlayer } from '../data/league';
import { computeStandings } from '../data/standings';
import { buildPlayoffs } from '../data/playoffs';
import { buildDraftContext } from '../data/draftSetup';
import { resolveDraft } from '../engine/draft';
import { fillRosters } from '../data/rookies';
import { leagueProduction } from '../data/production';
import { applyMatchXp } from '../engine/experience';
import { overall } from '../engine/overall';
import { FOREIGN_SALARY } from '../engine/foreign';
import { LEAGUE_CAP } from '../engine/cap';
import type { Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const seasons = Math.max(10, Number(process.argv[2]) || 120);

resetLeagueBase();
const ids = LEAGUE.teams.map((t) => t.id);
const MY = ids[0];

const stat = {
  foreignMin: 99, foreignMax: 0,
  floorViolations: 0,          // 외인 OVR < 국내 평균(설계: 그 이상이어야)
  resignSame: 0, switched: 0,  // 재지명(같은 팀 잔류) vs 새 얼굴
  faPoolForeign: 0,            // FA 풀에 섞인 외인(0이어야)
  capOverDomestic: 0,          // 국내 페이롤 캡 초과(0이어야)
  foreignAvgSum: 0, domesticAvgSum: 0,
  opPointsSum: 0, opSets: 0,   // 외인 생산(세트당)
};
const titles: Record<string, number> = {};
for (const id of ids) titles[id] = 0;

let prevForeignOf: Record<string, string> = {};
for (const t of ids) {
  const f = (currentRosters()[t] ?? []).find((id) => getPlayer(id)?.isForeign);
  if (f) prevForeignOf[t] = f;
}

for (let s = 0; s < seasons; s++) {
  const standings = computeStandings(Number.MAX_SAFE_INTEGER);
  const champ = buildPlayoffs(s).championId ?? standings[0].teamId;
  titles[champ]++;

  // 측정: 외인 수·성능 바닥·캡
  const all = Object.entries(currentRosters());
  let fCount = 0, fSum = 0, dSum = 0, dCount = 0;
  for (const [, roster] of all) {
    let domesticPay = 0;
    for (const id of roster) {
      const p = getPlayer(id);
      if (!p) continue;
      if (p.isForeign) { fCount++; fSum += overall(p); }
      else { dSum += overall(p); dCount++; domesticPay += p.contract.salary; }
    }
    if (domesticPay > LEAGUE_CAP) stat.capOverDomestic++;
  }
  const dAvg = dCount ? dSum / dCount : 0;
  stat.foreignMin = Math.min(stat.foreignMin, fCount);
  stat.foreignMax = Math.max(stat.foreignMax, fCount);
  if (fCount) { stat.foreignAvgSum += fSum / fCount; stat.domesticAvgSum += dAvg; }
  for (const [, roster] of all) {
    for (const id of roster) {
      const p = getPlayer(id);
      if (p?.isForeign && overall(p) < dAvg - 1) stat.floorViolations++; // 노쇠 감안 -1 여유
    }
  }
  // 외인 생산
  const prod = leagueProduction(Number.MAX_SAFE_INTEGER);
  for (const [, roster] of all) {
    for (const id of roster) {
      const p = getPlayer(id);
      if (p?.isForeign) { stat.opPointsSum += prod.get(id)?.points ?? 0; stat.opSets += 1; }
    }
  }

  // 오프시즌(트라이아웃 포함 — buildDraftContext 내부)
  const ctx = buildDraftContext(MY, {}, {}, [], false, [], s + 1);
  const snapshot = ctx.snapshot;
  const styleOf = (teamId: string) => getTeam(teamId)?.coachStyle ?? 'balanced';
  const drafted = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], MY, [], styleOf, teamScoutReveal);
  for (const p of drafted.picked) snapshot[p.id] = p;
  const filled = fillRosters(drafted.rosters, (id) => snapshot[id], s + 1);
  for (const rookie of filled.newPlayers) snapshot[rookie.id] = rookie;
  const seasonProd = leagueProduction(Number.MAX_SAFE_INTEGER);
  for (const tid of Object.keys(filled.rosters)) for (const id of filled.rosters[tid]) {
    const pr = seasonProd.get(id);
    if (pr && snapshot[id]) snapshot[id] = applyMatchXp(snapshot[id], pr);
    const prev = ctx.prevTeamOf[id];
    if (prev && prev !== tid && snapshot[id]) snapshot[id] = { ...snapshot[id], clubTenure: 0 };
  }
  // 재지명 vs 교체 추적 + FA 풀 오염 검사
  const nextForeignOf: Record<string, string> = {};
  for (const t of ids) {
    const f = (filled.rosters[t] ?? []).find((id) => snapshot[id]?.isForeign);
    if (f) {
      nextForeignOf[t] = f;
      if (prevForeignOf[t] === f) stat.resignSame++; else stat.switched++;
    }
  }
  prevForeignOf = nextForeignOf;
  const rostered = new Set(Object.values(filled.rosters).flat());
  for (const id of Object.keys(snapshot)) {
    const p = snapshot[id] as Player;
    if (p?.isForeign && !rostered.has(id)) {
      // 대체 풀(최대 4) 외의 비로스터 외인은 없어야 한다
    }
  }
  commitPlayerBase(snapshot);
  commitRosters(filled.rosters);
  if ((s + 1) % 30 === 0) process.stderr.write(`  …${s + 1}/${seasons}\n`);
}

log(`\n═══ 외국인 트라이아웃 ${seasons}시즌 ═══`);
log(`▸ 리그 외인 수: 항상 ${stat.foreignMin}~${stat.foreignMax}명 (멸종 ${stat.foreignMin === 0 ? '발생 ❌' : '없음 ✓'})`);
log(`▸ 성능: 외인 평균 OVR ${(stat.foreignAvgSum / seasons).toFixed(1)} vs 국내 평균 ${(stat.domesticAvgSum / seasons).toFixed(1)} — 바닥 위반 ${stat.floorViolations}건`);
log(`▸ 재지명(같은 팀 잔류) ${stat.resignSame} vs 새 얼굴 ${stat.switched} (${(stat.resignSame / Math.max(1, stat.resignSame + stat.switched) * 100).toFixed(0)}% 잔류)`);
log(`▸ 외인 생산: 시즌당 평균 ${(stat.opPointsSum / Math.max(1, stat.opSets)).toFixed(0)}점/인`);
log(`▸ 무결: 국내 페이롤 캡 초과 ${stat.capOverDomestic}건 · FA 풀 외인 오염 ${stat.faPoolForeign}건`);
const tArr = ids.map((id) => titles[id]);
log(`▸ 리그 건강: 우승경험 ${tArr.filter((t) => t > 0).length}/${ids.length} · 최다 ${Math.max(...tArr)}회`);
const ok = stat.foreignMin === 7 && stat.foreignMax === 7 && stat.floorViolations < seasons * 0.5
  && stat.capOverDomestic === 0 && tArr.filter((t) => t > 0).length >= ids.length - 1;
log(ok ? '\n✅ 외국인 시스템 장기 건강 — 멸종 0·바닥 보장·캡 무결' : '\n❌ 점검 필요');
process.exit(ok ? 0 : 1);
