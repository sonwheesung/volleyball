// 검증 — 신인 등용(ROTATION_MORALE F): PO 탈락 확정 팀이 잔여 경기에 신인(career.seasons===0)을 선발 승격.
//   ① 3경로 동일 승격 집합(순위 재시뮬 allResults ↔ 보드 재구성 = 동일 결과 · promotedOnDay ↔ 러닝 pickPromote)
//   ② 승격 신인이 six[](또는 리베로)에 실제 포함
//   ③ 비발동(clinched/contention/non-fire) 경기 바이트 동일(force 빈 셋 == force 미주입)
//   ④ 상한: rest+promote ≤3 · promote ≤2 · 승격 후 라인업 성립(6+리베로, throw 0)
//   ⑤ A/B teeth: (a) eliminated 게이트 — 비탈락 팀 승격 0 (b) force가 실제로 결과를 바꾼다(승격 vs 빈셋 결과 차이 >0)
//   ⑥ 결정론: 같은 (teamId·day) promotedOnDay/pickPromote 재호출 동일
//   Usage: npx tsx tools/_dv_promote.ts
import { resetLeagueBase, SEASON, LEAGUE, getTeam, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { restedOnDay, promotedOnDay } from '../data/rotation';
import { seasonResults } from '../data/standings';
import { teamClinch } from '../data/clinch';
import { buildLineup, pickRest, pickPromote, PROMOTE_MAX_SEASONS } from '../engine/lineup';
import { simulateMatch } from '../engine/match';

const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();

const EMPTY = new Set<string>();
const simKey = (s: ReturnType<typeof simulateMatch>): string =>
  `${s.homeSets}-${s.awaySets}|${s.points.length}|${s.setScores.map((x) => `${x.home}:${x.away}`).join(',')}|${s.points.map((p) => (p.scorer === 'home' ? 'H' : 'A')).join('')}`;

// 순위 재시뮬(allResults) 확정 — 이 안에서 러닝 clinch 인라인 pickPromote가 돈다.
const allRows = seasonResults(Number.MAX_SAFE_INTEGER);

let firedFixtures = 0, promotedTotal = 0;      // 발동 통계
let sixMiss = 0;                                // ② 승격 신인이 six/libero에 없음
let mismatch = 0, mismatchSample = '';         // ① 보드 재구성 vs allResults 행 불일치
let capViol = 0, lineupBad = 0;                // ④ 상한·라인업
let nonElimForce = 0;                          // ⑤a 비탈락 팀 승격(있으면 게이트 버그)
let abChanged = 0, abTotal = 0;                // ⑤b force teeth(승격 vs 빈셋 결과 차이)
let detViol = 0;                               // ⑥ 결정론
let byteIdent = 0, byteViol = 0;               // ③ 비발동 바이트 동일
let sample = '';

// dvPhilosophy 획득(보드/순위 simulateMatch 내부와 동일 인자)
const dvOf = (tid: string, d: number) => coachInfoOf(tid, d)?.dvPhilosophy ?? 0;

for (const f of SEASON) {
  const d = f.dayIndex;
  const home = f.homeTeamId, away = f.awayTeamId;

  // 게이트: 비탈락 팀은 promotedOnDay 빈 셋이어야(⑤a)
  for (const tid of [home, away]) {
    const c = teamClinch(tid, d - 1);
    const p = promotedOnDay(tid, d);
    if ((!c || c.state !== 'eliminated') && p.size) nonElimForce++;
  }

  const hp = promotedOnDay(home, d), ap = promotedOnDay(away, d);

  // 명단(휴식 제외) — 보드/순위와 동일 규칙
  const hAvail = availableTeamPlayers(home, d), aAvail = availableTeamPlayers(away, d);
  const hRest = restedOnDay(home, d), aRest = restedOnDay(away, d);
  const hs = hRest.size ? hAvail.filter((p) => !hRest.has(p.id)) : hAvail;
  const as = aRest.size ? aAvail.filter((p) => !aRest.has(p.id)) : aAvail;
  const base = { home: coachInfoOf(home, d), away: coachInfoOf(away, d) };

  if (!hp.size && !ap.size) {
    // ③ 비발동 경기: force 빈 셋 명시 == force 미주입 (바이트 동일). 표본 일부만(성능)
    if (byteIdent < 40) {
      const withEmpty = simulateMatch(f.seed, hs, as, { ...base, homeForce: EMPTY, awayForce: EMPTY });
      const without = simulateMatch(f.seed, hs, as, { ...base });
      if (simKey(withEmpty) !== simKey(without)) byteViol++;
      byteIdent++;
    }
    continue;
  }

  firedFixtures++;
  promotedTotal += hp.size + ap.size;

  // ② 승격 신인이 six/libero에 포함 + ④ 라인업 성립
  for (const [tid, pset, squad] of [[home, hp, hs], [away, ap, as]] as [string, Set<string>, typeof hs][]) {
    if (!pset.size) continue;
    const lu = buildLineup(squad, dvOf(tid, d), pset);
    const onCourt = new Set([...lu.six.map((p) => p.id), ...(lu.libero ? [lu.libero.id] : [])]);
    for (const id of pset) if (!onCourt.has(id)) sixMiss++;
    // 라인업 성립(6인 채워짐·L 후보 있으면 리베로 존재)
    if (lu.six.length !== 6 || lu.six.some((p) => !p)) lineupBad++;
    if (squad.some((p) => p.position === 'L') && !lu.libero) lineupBad++;
    // ④ 상한: rest+promote ≤3 · promote ≤2 · 승격 신인은 전부 진짜 신인(정의)
    const restN = (tid === home ? hRest : aRest).size;
    if (pset.size > 2 || restN + pset.size > 3) capViol++;
    for (const id of pset) { const pl = squad.find((p) => p.id === id); if (!pl || pl.career.seasons > PROMOTE_MAX_SEASONS) capViol++; }
    if (!sample) {
      const names = [...pset].map((id) => { const pl = squad.find((p) => p.id === id)!; return `${pl.name}(${pl.position}·${pl.career.seasons}시즌·OVR후보)`; });
      const c = teamClinch(tid, d - 1);
      sample = `${getTeam(tid)?.name} day${d}(${c?.state}) 승격: ${names.join(', ')} (rest ${restN}명)`;
    }
  }

  // ① 보드 재구성(force=promotedOnDay) == allResults 행(러닝 clinch 인라인 pickPromote)
  const sim = simulateMatch(f.seed, hs, as, { ...base, homeForce: hp, awayForce: ap });
  const row = allRows.find((r) => r.fixtureId === f.id);
  if (!row || sim.homeSets !== row.homeSets || sim.awaySets !== row.awaySets) {
    mismatch++;
    if (!mismatchSample) mismatchSample = `${f.id} board ${sim.homeSets}-${sim.awaySets} vs row ${row?.homeSets}-${row?.awaySets}`;
  }

  // ⑤b A/B teeth: force(승격) vs 빈 셋 → 결과가 달라지는 경기가 존재해야(force가 실제 작동)
  abTotal++;
  const noForce = simulateMatch(f.seed, hs, as, { ...base, homeForce: EMPTY, awayForce: EMPTY });
  if (simKey(noForce) !== simKey(sim)) abChanged++;

  // ⑥ 결정론
  const hp2 = promotedOnDay(home, d);
  if ([...hp].sort().join(',') !== [...hp2].sort().join(',')) detViol++;
  const rp1 = [...pickPromote(hs, home, d, hRest.size)].sort().join(',');
  const rp2 = [...pickPromote(hs, home, d, hRest.size)].sort().join(',');
  if (rp1 !== rp2) detViol++;
}

log('═══ 신인 등용(ROTATION_MORALE F) 검증 ═══');
log(`발동: ${firedFixtures} 경기 · 승격 연인원 ${promotedTotal}명  (예: ${sample || '없음'})`);
log(`① 3경로 결과 불일치(보드 재구성 vs allResults, 발동 ${firedFixtures}건): ${mismatch}${mismatchSample ? '  ['+mismatchSample+']' : ''}`);
log(`② 승격 신인 six/libero 누락: ${sixMiss}`);
log(`③ 비발동 바이트 동일 위반(표본 ${byteIdent}): ${byteViol}`);
log(`④ 상한(rest+promote≤3·≤2·신인정의) 위반: ${capViol} · 라인업 붕괴: ${lineupBad}`);
log(`⑤a 비탈락 팀 승격(게이트 버그): ${nonElimForce}`);
log(`⑤b force teeth — 승격이 결과를 바꾼 경기: ${abChanged}/${abTotal} (>0이어야 = A/B 민감도)`);
log(`⑥ 결정론 위반(재호출 불일치): ${detViol}`);

const ok = firedFixtures > 0 && mismatch === 0 && sixMiss === 0 && byteViol === 0
  && capViol === 0 && lineupBad === 0 && nonElimForce === 0 && abChanged > 0 && detViol === 0;
log(`\nPROMOTE OK = ${ok}`);
process.exit(ok ? 0 : 2);
