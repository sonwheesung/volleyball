// 아시아쿼터 장기 지속성 검증 (FOREIGN_SYSTEM 7) — N시즌 진행하며 팀당 아시아쿼터 1명이
// 멸종 없이 유지되는지(외인과 동일 건강성) 확인. 외인 수도 함께 측정(외인 시스템 무회귀 확인).
//   npx tsx tools/simAsianQuota.ts [시즌수=120]
import { resetLeagueBase, currentRosters, getPlayer, LEAGUE } from '../data/league';
import { overall } from '../engine/overall';
import { advanceOffseason } from './simLeague';

const log = (m: string) => process.stdout.write(m + '\n');
const N = Math.max(1, Number(process.argv[2]) || 120);
const T = LEAGUE.teams.length;

resetLeagueBase();
let asianMin = Infinity, asianMax = -Infinity, foreignMin = Infinity, foreignMax = -Infinity;
let asianExtinctSeasons = 0, foreignExtinctSeasons = 0;
const asianPosCount: Record<string, number> = {};

for (let s = 0; s < N; s++) {
  advanceOffseason(s); // 외인 + 아시아쿼터 트라이아웃 실행, 새 시즌(s+1) 커밋
  const rosters = currentRosters();
  let asianTot = 0, foreignTot = 0, asianTeamsWith = 0, foreignTeamsWith = 0;
  for (const tid of Object.keys(rosters)) {
    let a = 0, f = 0;
    for (const id of rosters[tid]) {
      const p = getPlayer(id);
      if (!p) continue;
      if (p.isAsianQuota) { a++; asianTot++; asianPosCount[p.position] = (asianPosCount[p.position] ?? 0) + 1; }
      else if (p.isForeign) { f++; foreignTot++; }
    }
    if (a > 0) asianTeamsWith++;
    if (f > 0) foreignTeamsWith++;
  }
  asianMin = Math.min(asianMin, asianTot); asianMax = Math.max(asianMax, asianTot);
  foreignMin = Math.min(foreignMin, foreignTot); foreignMax = Math.max(foreignMax, foreignTot);
  if (asianTeamsWith < T) asianExtinctSeasons++;
  if (foreignTeamsWith < T) foreignExtinctSeasons++;
}

const finalRosters = currentRosters();
const sample: number[] = [];
for (const tid of Object.keys(finalRosters)) for (const id of finalRosters[tid]) {
  const p = getPlayer(id); if (p?.isAsianQuota) sample.push(overall(p));
}

log(`\n═══ 아시아쿼터 장기 지속성 — ${N}시즌 (${T}팀) ═══`);
log(`▸ 아시아쿼터 수: 시즌당 ${asianMin}~${asianMax}명 (팀당 1 기대 = ${T})  ·  미달(멸종) 시즌 ${asianExtinctSeasons}/${N}  ${asianExtinctSeasons === 0 && asianMin === T ? '✓ 멸종 0' : '⚠️ 멸종 발생'}`);
log(`▸ 외국인 수(무회귀 확인): 시즌당 ${foreignMin}~${foreignMax}명 (팀당 1 = ${T})  ·  멸종 시즌 ${foreignExtinctSeasons}/${N}  ${foreignExtinctSeasons === 0 && foreignMin === T ? '✓' : '⚠️'}`);
if (sample.length) {
  const avg = sample.reduce((a, b) => a + b, 0) / sample.length;
  log(`▸ 아시아쿼터 OVR(최종 시즌): 평균 ${avg.toFixed(1)} (n=${sample.length})`);
}
log(`▸ 아시아쿼터 포지션 분포: ${Object.entries(asianPosCount).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p} ${(100 * n / Object.values(asianPosCount).reduce((a, b) => a + b, 0)).toFixed(0)}%`).join(' · ')}`);
log(asianExtinctSeasons === 0 && foreignExtinctSeasons === 0 ? '\n✅ 아시아쿼터·외국인 모두 멸종 0 — 지속성 건강' : '\n❌ 멸종 발생 — 점검 필요');
