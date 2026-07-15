// 완전 수동 사이드 가드 (MATCH_INTERVENTION_SYSTEM §4.1) — 내 팀 정규시즌 "구단주 직접" 설정의 엔진 축·라우팅·정합 검증.
//   (a) opts.manualSide 미지정 = 미포함과 바이트 동일(N≥2,000) — 새 축이 자동 관전을 1비트도 안 흔든다.
//   (b) manualSide 지정 시 그 사이드의 비테크니컬 타임아웃 0·비부상 교체 enter 0, 상대 사이드는 자동 유지(>0), TTO(테크니컬)는 유지(>0).
//       A/B: 미지정으로 되돌리면 그 사이드 자동활동 >0(민감도 — 억제가 실재).
//   (c) 개입 로그와 병행 시 유저 개입 타임아웃/교체는 정상 발화(완전 수동이 억제하는 건 '감독 자동'뿐, 유저 개입 아님).
//   (d) manualSideFor forward-only 라우팅(체인지로그 day=D): dayIndex<D=undefined(자동)·≥D=내팀사이드, 로그 빈값=undefined.
//       그 라우팅을 엔진에 먹여 day<D=자동 baseline 바이트 동일·day≥D=수동 결과 확인.
//   (e) 3경로 정합: matchBox=standings=production 세트스코어 바이트 동일(내 팀+구단주 직접 설정) + 빈 로그 = baseline 복원.
//   npx tsx tools/_dv_manual_side.ts [N=2500]

import { LEAGUE, SEASON, resetLeagueBase, coachInfoOf, getEvolvedTeamPlayers } from '../data/league';
import { setCoachModeLog, manualSideFor, setTxContext, setInterventionContext, interventionsFor } from '../data/dynamics';
import { buildMatchBox } from '../data/matchBox';
import { seasonResults, type ResultRow } from '../data/standings';
import { leagueProduction } from '../data/production';
import { simulateMatch, type MatchOpts } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { SEASON_DAYS } from '../engine/calendar';
import type { SimResult, MatchIntervention } from '../engine/simMatch';
import type { Side, Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const fails: string[] = [];
const check = (ok: boolean, label: string, detail = '') => { log(`  ${ok ? 'PASS' : 'FAIL ❌'} — ${label}${detail}`); if (!ok) fails.push(label + detail); };

function ser(r: SimResult): string {
  return JSON.stringify({ homeSets: r.homeSets, awaySets: r.awaySets, setScores: r.setScores, points: r.points, subUse: r.subUse, subEvents: r.subEvents, timeouts: r.timeouts, setFirstServers: r.setFirstServers });
}

resetLeagueBase();
const ids = LEAGUE.teams.map((t) => t.id);
const sq: Record<string, Player[]> = {};
for (const id of ids) sq[id] = getEvolvedTeamPlayers(id, 0);
const nT = ids.length;

// ── (a) 미지정 = 미포함 바이트 동일 ──
{
  const N = Math.max(2000, Number(process.argv[2]) || 2500);
  let mismatch = 0;
  for (let i = 0; i < N; i++) {
    const seed = (i * 2654435761) >>> 0;
    const hi = i % nT, ai = (hi + 1 + (i % (nT - 1))) % nT;
    const coach = { home: coachInfoOf(ids[hi]), away: coachInfoOf(ids[ai]) };
    const rA = simulateMatch(seed, sq[ids[hi]], sq[ids[ai]], { ...coach });
    const rB = simulateMatch(seed, sq[ids[hi]], sq[ids[ai]], { ...coach, manualSide: undefined });
    if (ser(rA) !== ser(rB)) mismatch++;
  }
  check(mismatch === 0, `(a) manualSide 미지정=undefined 바이트 동일 (N=${N})`, mismatch ? ` — 불일치 ${mismatch}` : '');
}

// ── (b) manualSide='home' 억제 + 상대·TTO 유지 + A/B 민감도 ──
{
  const N = 500;
  let homeAutoTO = 0, homeEnter = 0, homeTTO = 0, awayAutoTO = 0, awayEnter = 0;   // manualSide='home'
  let homeAutoTO_off = 0, homeEnter_off = 0;                                        // manualSide 미지정(A/B)
  for (let i = 0; i < N; i++) {
    const seed = (i * 40503 + 7) >>> 0;
    const hi = i % nT, ai = (hi + 3 + (i % (nT - 1))) % nT;
    const coach = { home: coachInfoOf(ids[hi]), away: coachInfoOf(ids[ai]) };
    const on = simulateMatch(seed, sq[ids[hi]], sq[ids[ai]], { ...coach, manualSide: 'home' as Side });
    for (const t of on.timeouts ?? []) { if (t.side === 'home') { if (t.technical) homeTTO++; else homeAutoTO++; } else if (!t.technical) awayAutoTO++; }
    for (const e of on.subEvents ?? []) { if (!e.enter || e.kind === 'injury') continue; if (e.side === 'home') homeEnter++; else awayEnter++; }
    const off = simulateMatch(seed, sq[ids[hi]], sq[ids[ai]], { ...coach });
    for (const t of off.timeouts ?? []) { if (t.side === 'home' && !t.technical) homeAutoTO_off++; }
    for (const e of off.subEvents ?? []) { if (e.enter && e.kind !== 'injury' && e.side === 'home') homeEnter_off++; }
  }
  check(homeAutoTO === 0, '(b) manualSide 사이드 비테크니컬 타임아웃 0', homeAutoTO ? ` — ${homeAutoTO}` : '');
  check(homeEnter === 0, '(b) manualSide 사이드 비부상 교체 enter 0', homeEnter ? ` — ${homeEnter}` : '');
  check(homeTTO > 0, '(b) manualSide 사이드 테크니컬 타임아웃(TTO) 유지 >0', ` (TTO ${homeTTO})`);
  check(awayAutoTO > 0 && awayEnter > 0, '(b) 상대 사이드 자동 타임아웃·교체 유지 >0', ` (TO ${awayAutoTO}·enter ${awayEnter})`);
  check(homeAutoTO_off > 0 && homeEnter_off > 0, '(b) A/B 민감도 — 미지정이면 그 사이드 자동활동 >0', ` (TO ${homeAutoTO_off}·enter ${homeEnter_off})`);
}

// ── (c) 개입 + manualSide 병행: 유저 개입 발화 ──
{
  // 개입이 확실히 도달하도록 세트1 0:0 좌표에 홈 타임아웃 + 홈 교체(비세터 선발→벤치) 주입.
  let firedTO = 0, firedSub = 0, cases = 0;
  for (let i = 0; i < 200; i++) {
    const hi = i % nT, ai = (hi + 5 + (i % (nT - 1))) % nT;
    const home = sq[ids[hi]];
    const lu = buildLineup(home);
    const sixIds = new Set(lu.six.map((p) => p.id));
    const outP = lu.six.find((p) => p.position !== 'S' && p.position !== 'L');
    const inP = home.find((p) => !sixIds.has(p.id) && p.id !== lu.libero?.id && p.position !== 'L');
    if (!outP || !inP) continue;
    cases++;
    const interventions: MatchIntervention[] = [
      { at: { setNo: 1, h: 0, a: 0 }, side: 'home', kind: 'timeout' },
      { at: { setNo: 1, h: 0, a: 0 }, side: 'home', kind: 'sub', outId: outP.id, inId: inP.id },
    ];
    const sim = simulateMatch((i * 991 + 3) >>> 0, home, sq[ids[ai]], { home: coachInfoOf(ids[hi]), away: coachInfoOf(ids[ai]), manualSide: 'home' as Side, interventions });
    if ((sim.timeouts ?? []).some((t) => t.side === 'home' && !t.technical)) firedTO++;
    if ((sim.subEvents ?? []).some((e) => e.enter && e.inId === inP.id)) firedSub++;
  }
  check(cases >= 100, '(c) 개입 병행 표본 확보', ` (${cases})`);
  check(firedTO === cases, '(c) manualSide여도 유저 개입 타임아웃 발화', ` (${firedTO}/${cases})`);
  check(firedSub === cases, '(c) manualSide여도 유저 개입 교체 발화', ` (${firedSub}/${cases})`);
}

// ── (d) manualSideFor forward-only 라우팅 + 엔진 반영 ──
{
  const myTeam = ids[0];
  const other = ids[1];
  setTxContext([], [], myTeam); // myTeamId 설정
  const D = 40;
  // 빈 로그 = 항상 undefined
  setCoachModeLog([]);
  const emptyBefore = manualSideFor(myTeam, other, 0) === undefined && manualSideFor(myTeam, other, D) === undefined && manualSideFor(myTeam, other, 200) === undefined;
  check(emptyBefore, '(d) 빈 설정로그 = 전 날짜 undefined(현행 바이트 동일 기준)');
  // 체인지로그 (day=D, manual on)
  setCoachModeLog([{ day: D, manual: true }]);
  const r1 = manualSideFor(myTeam, other, D - 1); // < D → 자동
  const r2 = manualSideFor(myTeam, other, D);     // ≥ D → 수동(내 팀 = home)
  const r3 = manualSideFor(other, myTeam, D + 10); // 내 팀이 away
  const r4 = manualSideFor(ids[2], ids[3], D + 10); // 내 팀 무관 경기
  check(r1 === undefined, '(d) forward-only: dayIndex<D = undefined(자동 유지)', ` (${String(r1)})`);
  check(r2 === 'home', '(d) forward-only: dayIndex≥D 내팀 홈 = home', ` (${String(r2)})`);
  check(r3 === 'away', '(d) forward-only: 내팀 원정 = away', ` (${String(r3)})`);
  check(r4 === undefined, '(d) 내 팀 무관 경기 = undefined', ` (${String(r4)})`);
  // 라우팅을 엔진에 먹여: 같은 시드/스쿼드로 day<D(자동)==baseline, day≥D(수동)==manual 결과.
  const seed = 123457, home = sq[myTeam], away = sq[other];
  const coach = { home: coachInfoOf(myTeam), away: coachInfoOf(other) };
  const baseline = ser(simulateMatch(seed, home, away, { ...coach }));
  const manual = ser(simulateMatch(seed, home, away, { ...coach, manualSide: 'home' as Side }));
  const dayBefore = ser(simulateMatch(seed, home, away, { ...coach, manualSide: manualSideFor(myTeam, other, D - 1) }));
  const dayAfter = ser(simulateMatch(seed, home, away, { ...coach, manualSide: manualSideFor(myTeam, other, D) }));
  check(dayBefore === baseline, '(d) day<D 라우팅 → 자동 baseline 바이트 동일');
  check(dayAfter === manual, '(d) day≥D 라우팅 → 수동 결과 바이트 동일');
  // manual이 baseline과 실제로 다른지(내 팀 홈 경기에서 감독 자동활동이 있었으면) — 없으면 이 시드에선 무발화(정상), 경고만.
  if (manual === baseline) log('    · 참고: 이 시드 매치업은 감독 자동활동이 없어 manual==baseline(무해 — (b)에서 억제 실증).');
}

// ── (e) 3경로 정합(matchBox=standings=production) + 빈 로그 baseline 복원 ──
{
  const myTeam = ids[0];
  setTxContext([], [], myTeam);
  setInterventionContext({});
  const fixtures = [...SEASON].sort((a, b) => a.dayIndex - b.dayIndex);
  const boxScore = (f: typeof fixtures[number]) => { const { sim } = buildMatchBox(f.homeTeamId, f.awayTeamId, f.dayIndex, f.seed, interventionsFor(f.id)); return { h: sim.homeSets, a: sim.awaySets }; };
  const resMap = (rows: ResultRow[]) => { const m = new Map<string, { h: number; a: number }>(); for (const r of rows) m.set(r.fixtureId, { h: r.homeSets, a: r.awaySets }); return m; };
  const prodSer = () => JSON.stringify([...(leagueProduction(SEASON_DAYS) as Map<string, unknown>).entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));

  // baseline (설정로그 빈값)
  setCoachModeLog([]);
  const baseRes = resMap(seasonResults(SEASON_DAYS));
  const baseProd = prodSer();

  // 구단주 직접(전 시즌 manual on)
  setCoachModeLog([{ day: 0, manual: true }]);
  const mRes = resMap(seasonResults(SEASON_DAYS));
  const mProd = prodSer();
  check(mProd !== baseProd, '(e) 생산 호출부도 manualSide 로드(구단주 직접 시 생산 변동)');
  let mismatch3 = 0, changedMy = 0;
  const myFix = fixtures.filter((f) => f.homeTeamId === myTeam || f.awayTeamId === myTeam);
  for (const f of fixtures) {
    const b = boxScore(f), r = mRes.get(f.id);
    if (!r || b.h !== r.h || b.a !== r.a) { mismatch3++; continue; }
  }
  for (const f of myFix) { const b = baseRes.get(f.id)!, r = mRes.get(f.id)!; if (b.h !== r.h || b.a !== r.a) changedMy++; }
  check(mismatch3 === 0, '(e) 3경로 정합: matchBox == standings (내 팀+구단주 직접)', mismatch3 ? ` — 불일치 ${mismatch3}` : '');
  check(changedMy > 0, '(e) 구단주 직접이 내 팀 경기 결과를 실제로 바꿈(무발화 아님)', ` (변화 ${changedMy}/${myFix.length})`);

  // 빈 로그로 복원 → baseline 바이트 동일
  setCoachModeLog([]);
  const resetRes = resMap(seasonResults(SEASON_DAYS));
  let resetMiss = 0;
  for (const f of fixtures) { const b = baseRes.get(f.id)!, r = resetRes.get(f.id)!; if (b.h !== r.h || b.a !== r.a) resetMiss++; }
  const resetProd = prodSer();
  check(resetMiss === 0, '(e) 빈 로그 복원 = baseline 순위 바이트 동일', resetMiss ? ` — 불일치 ${resetMiss}` : '');
  check(resetProd === baseProd, '(e) 빈 로그 복원 = baseline 생산 바이트 동일');
}

log('\n═══ 완전 수동 사이드 가드(§4.1) ═══');
if (fails.length === 0) { log('  ✓ PASS — (a)미지정불변 (b)억제·상대유지·A/B (c)개입발화 (d)forward-only (e)3경로정합·복원'); process.exit(0); }
else { log(`  ✗ FAIL — ${fails.length}건`); process.exit(1); }
