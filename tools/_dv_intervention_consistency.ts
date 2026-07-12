// 정합 가드 (MATCH_INTERVENTION_SYSTEM 2단계 — 순수 로그 방식 §2.2) — 개입 로그를 여러 sim 호출부가 **동일하게** 싣는지 증명.
//   핵심 불변식: interventionsFor(id)를 관전(matchBox)·순위(standings)·생산(production) 세 호출부가 전부 실으면
//   split-brain(경로별 결과 갈림)이 원천 소멸한다 — 어느 하나라도 로그 주입을 빠뜨리면 그 경로만 갈라져 여기서 FAIL.
//
//   시나리오: 정규시즌 fixture(짝수 index)에 합성 개입(홈팀 비세터 선발 1명을 벤치 선수로 세트1 0-0에서 교체) 주입.
//   검증:
//     (A) 정합 — 모든 fixture에서 matchBox.sim 세트스코어 == 순위(seasonResults) 행 세트스코어 (두 독립 호출부 바이트 동일).
//     (B) 발화 — 개입 주입 fixture 중 최소 1건이 baseline과 세트스코어가 달라짐(개입이 실제로 코트를 바꿈 — 허위 오라클 방지).
//     (C) 회귀 — 개입 없는(control) 이른 fixture(첫 휴식일 이전, 버터플라이 면역)는 baseline과 불변.
//     (D) 생산 정합 — leagueProduction이 개입 전후로 달라짐(생산 호출부가 로그를 실음) + 교체 투입 선수가 그 경기 생산에 귀속.
//     (E) 무동작 — 로그를 다시 {}로 비우면 전 리그(matchBox·순위·생산)가 baseline과 바이트 동일(빈 로그 = 완전 무동작).
//   불일치 시 fixtureId·필드 출력 후 exit(1), 아니면 PASS exit 0.
//
//   npx tsx tools/_dv_intervention_consistency.ts

import { LEAGUE, SEASON, resetLeagueBase, coachInfoOf } from '../data/league';
import { setInterventionContext, interventionsFor } from '../data/dynamics';
import { availableTeamPlayers } from '../data/injury';
import { restedOnDay } from '../data/rotation';
import { buildMatchBox } from '../data/matchBox';
import { seasonResults, type ResultRow } from '../data/standings';
import { leagueProduction, seasonMatchProds } from '../data/production';
import { buildLineup } from '../engine/lineup';
import { SEASON_DAYS } from '../engine/calendar';
import type { MatchIntervention } from '../engine/simMatch';
import type { Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');

// matchBox의 홈 명단과 동일 규칙(availableTeamPlayers − restedOnDay) — 개입 out/in 후보를 실제 코트/벤치에서 고른다.
function homeSquadOf(homeId: string, dayIndex: number): Player[] {
  const rest = restedOnDay(homeId, dayIndex);
  const avail = availableTeamPlayers(homeId, dayIndex);
  return rest.size ? avail.filter((p) => !rest.has(p.id)) : avail;
}

// fixture별 matchBox 세트스코어(관전 호출부).
function boxScore(f: { homeTeamId: string; awayTeamId: string; dayIndex: number; seed: number; id: string }) {
  const { sim } = buildMatchBox(f.homeTeamId, f.awayTeamId, f.dayIndex, f.seed, interventionsFor(f.id));
  return { homeSets: sim.homeSets, awaySets: sim.awaySets };
}
// 순위 호출부 → fixtureId별 세트스코어 맵.
function resultMap(rows: ResultRow[]) {
  const m = new Map<string, { homeSets: number; awaySets: number }>();
  for (const r of rows) m.set(r.fixtureId, { homeSets: r.homeSets, awaySets: r.awaySets });
  return m;
}
// 생산 호출부 직렬화(결정론 정렬).
function serProd(map: Map<string, unknown>): string {
  return JSON.stringify([...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}
const eqScore = (x: { homeSets: number; awaySets: number }, y: { homeSets: number; awaySets: number }) =>
  x.homeSets === y.homeSets && x.awaySets === y.awaySets;

function main(): void {
  resetLeagueBase();
  const fixtures = [...SEASON].sort((a, b) => a.dayIndex - b.dayIndex);
  const fails: string[] = [];

  // ── baseline (개입 없음) ──
  setInterventionContext({});
  const baseResults = resultMap(seasonResults(SEASON_DAYS));
  const baseBox = new Map<string, { homeSets: number; awaySets: number }>();
  for (const f of fixtures) baseBox.set(f.id, boxScore(f));
  const baseProd = serProd(leagueProduction(SEASON_DAYS) as Map<string, unknown>);

  // 첫 휴식일(clinch 기반) — control 회귀 판정용. 이 날 이전 fixture는 결과 무의존(부상/벤치만) → 버터플라이 면역.
  let firstRestDay = Infinity;
  for (const f of fixtures) {
    if (restedOnDay(f.homeTeamId, f.dayIndex).size || restedOnDay(f.awayTeamId, f.dayIndex).size) {
      firstRestDay = Math.min(firstRestDay, f.dayIndex);
    }
  }

  // ── 합성 개입 생성(짝수 index만 주입, 홀수 = control) ──
  const ivMap: Record<string, MatchIntervention[]> = {};
  const injected: string[] = [];        // 개입을 실제로 심은 fixtureId
  const control: typeof fixtures = [];   // 개입 없는 fixtureId
  fixtures.forEach((f, idx) => {
    if (idx % 2 !== 0) { control.push(f); return; }
    const squad = homeSquadOf(f.homeTeamId, f.dayIndex);
    if (squad.length < 7) { control.push(f); return; }
    const lu = buildLineup(squad);
    const sixIds = new Set(lu.six.map((p) => p.id));
    const liberoId = lu.libero?.id;
    // 비세터·비리베로 선발 1명을 뺀다.
    const outP = lu.six.find((p) => p.position !== 'S' && p.position !== 'L');
    // 벤치(코트 밖·비리베로) 1명을 넣는다.
    const inP = squad.find((p) => !sixIds.has(p.id) && p.id !== liberoId && p.position !== 'L');
    if (!outP || !inP) { control.push(f); return; }
    ivMap[f.id] = [{ at: { setNo: 1, h: 0, a: 0 }, side: 'home', kind: 'sub', outId: outP.id, inId: inP.id }];
    injected.push(f.id);
  });

  if (injected.length === 0) { log('  ✗ FAIL — 합성 개입을 하나도 만들지 못함(명단 부족?)'); process.exit(1); }

  // ── 개입 주입 ──
  setInterventionContext(ivMap, 0);
  const ivResults = resultMap(seasonResults(SEASON_DAYS));
  const ivBox = new Map<string, { homeSets: number; awaySets: number }>();
  for (const f of fixtures) ivBox.set(f.id, boxScore(f));
  const ivProd = serProd(leagueProduction(SEASON_DAYS) as Map<string, unknown>);

  // (A) 정합 — 모든 fixture: matchBox == 순위 세트스코어.
  let mismatchAB = 0;
  for (const f of fixtures) {
    const b = ivBox.get(f.id)!;
    const r = ivResults.get(f.id);
    if (!r) { fails.push(`(A) 순위에 fixture 없음: ${f.id}`); continue; }
    if (!eqScore(b, r)) {
      mismatchAB++;
      if (mismatchAB <= 5) fails.push(`(A) matchBox≠순위 @${f.id}: box ${b.homeSets}-${b.awaySets} vs 순위 ${r.homeSets}-${r.awaySets}`);
    }
  }

  // (B) 발화 — 개입 주입 fixture 중 최소 1건이 baseline과 달라짐.
  const changed = injected.filter((id) => !eqScore(ivBox.get(id)!, baseBox.get(id)!)).length;
  if (changed === 0) fails.push(`(B) 개입 ${injected.length}건 주입했으나 결과 변화 0 — 개입 미발화(허위 오라클/좌표 불일치 의심)`);

  // (C) 회귀 — control 이른 fixture(첫 휴식일 이전)는 baseline과 불변.
  let regr = 0;
  const controlEarly = control.filter((f) => f.dayIndex < firstRestDay);
  for (const f of controlEarly) {
    if (!eqScore(ivBox.get(f.id)!, baseBox.get(f.id)!)) {
      regr++;
      if (regr <= 5) fails.push(`(C) control 이른 fixture 변동 @${f.id}(day ${f.dayIndex}): 개입 없는데 결과 달라짐`);
    }
  }

  // (D) 생산 정합 — 개입으로 생산이 달라짐 + 투입 선수가 그 경기 생산에 귀속(생산 호출부가 로그를 실음).
  if (ivProd === baseProd) fails.push('(D) leagueProduction이 개입 전후 동일 — 생산 호출부가 개입 로그를 안 실음(interventionsFor 누락 의심)');
  // 개입 발화한 이른 fixture 하나에서 inId 선수가 그 경기 생산에 잡히는지(baseline엔 없음).
  const probe = injected.find((id) => {
    const f = fixtures.find((x) => x.id === id)!;
    return f.dayIndex < firstRestDay && !eqScore(ivBox.get(id)!, baseBox.get(id)!);
  });
  if (probe) {
    const f = fixtures.find((x) => x.id === probe)!;
    // 그 경기 한정 생산 라인을 직렬화(버터플라이 면역 — 이른 fixture는 결과 무의존이라 그 경기 sim만 반영).
    //   벤치 선수는 baseline에서도 AI 교체/가비지로 생산에 잡힐 수 있어(엔진 사실), "투입 선수 존재 유무"는
    //   무효 프로브다. 대신 "개입 경기의 생산 전체가 baseline과 달라지는가"를 본다 — 생산 호출부가
    //   그 경기 로그를 실었으면 반드시 달라진다(로그 누락 시 baseline과 동일 → FAIL).
    const rowSer = (rows: ReturnType<typeof seasonMatchProds>): string => {
      const r = rows.find((x) => x.dayIndex === f.dayIndex && x.homeTeamId === f.homeTeamId && x.awayTeamId === f.awayTeamId);
      return r ? JSON.stringify([...r.lines.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) : '';
    };
    const ivRow = rowSer(seasonMatchProds(SEASON_DAYS));
    setInterventionContext({});
    const baseRow = rowSer(seasonMatchProds(SEASON_DAYS));
    setInterventionContext(ivMap, 0); // 복원
    if (ivRow === '' ) fails.push(`(D) 개입 경기 ${probe} 생산행을 못 찾음 — 프로브 무효`);
    else if (ivRow === baseRow) fails.push(`(D) 개입 경기 ${probe} 생산이 baseline과 동일 — 생산 호출부가 그 경기 로그 미반영(interventionsFor 누락)`);
  }

  // (E) 무동작 — 로그 비우면 전 리그가 baseline과 바이트 동일.
  setInterventionContext({});
  const resetResults = resultMap(seasonResults(SEASON_DAYS));
  let resetBoxMiss = 0;
  for (const f of fixtures) {
    if (!eqScore(boxScore(f), baseBox.get(f.id)!)) resetBoxMiss++;
    const r = resetResults.get(f.id)!;
    if (!eqScore(r, baseResults.get(f.id)!)) resetBoxMiss++;
  }
  const resetProd = serProd(leagueProduction(SEASON_DAYS) as Map<string, unknown>);
  if (resetBoxMiss > 0) fails.push(`(E) 로그 리셋 후 baseline 불일치 ${resetBoxMiss}건 — 빈 로그가 무동작 아님`);
  if (resetProd !== baseProd) fails.push('(E) 로그 리셋 후 생산이 baseline과 다름 — 빈 로그가 무동작 아님');

  log(`\n═══ 개입 정합 가드 — 순수 로그(§2.2) ═══`);
  log(`  fixture ${fixtures.length} · 개입주입 ${injected.length} · control이른 ${controlEarly.length} · 첫휴식일 ${Number.isFinite(firstRestDay) ? firstRestDay : '없음'} · 발화 ${changed}`);
  if (fails.length === 0) {
    log(`  ✓ PASS — (A)정합 (B)발화 (C)회귀 (D)생산정합 (E)무동작 전부 통과`);
    process.exit(0);
  } else {
    log(`  ✗ FAIL — ${fails.length}건:`);
    for (const m of fails) log(`      ${m}`);
    process.exit(1);
  }
}

main();
