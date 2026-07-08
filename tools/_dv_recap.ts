// _dv_recap — 시즌 결산 포스트시즌 결말 파생(myPostseasonOutcome) 상비 가드 (SEASON_SYSTEM §5.5, 2026-07-08).
// 임시 하네스 상설화(TEST_METHODOLOGY — 임시 검증은 상설 가드로 환원).
//
// 검사:
//   ① kind 분류 불변식 — champion팀 = integrated(정규1위 직행 우승) | champion(하위시드 우승),
//      결승 패자 = runnerUp(3패), 준PO 탈락 = poOut(2패), 시드 밖 = missed. 분포 정합(시즌당 champ 1 · runnerUp 1 · poOut 1 · missed 4).
//   ② 시리즈 스코어 정합 — outcome.myWins/myLosses == 해당 시리즈를 내 팀 시점으로 독립 재집계한 값(독립 오라클).
//   ③ 결정론 — 같은 시즌 2회 → outcome 완전 동일.
//   ④ A/B 뮤턴트 이빨 — 오염 outcome(kind 뒤섞기·스코어 조작)을 검사기가 잡는지 증명(허위 오라클 방지).
//      _dv_playoffs 선례: 파일 변이 없이 오염 객체 in-memory 주입.
//
// 실행: npx tsx tools/_dv_recap.ts [시즌수=50]   (~수초). exit 0/1.

import { resetLeagueBase, LEAGUE } from '../data/league';
import { buildPlayoffs, myPostseasonOutcome, type Playoffs, type PostseasonOutcome, type Matchup } from '../data/playoffs';

const N = Math.max(1, Number(process.argv[2]) || 50);

let fails = 0;
const check = (c: boolean, m: string) => { if (!c) { console.log('  ❌ FAIL:', m); fails++; } };
const ok = (m: string) => console.log('  ✅', m);

// ── 독립 오라클: 시리즈를 내 팀 시점으로 재집계(구현과 다른 경로 — games[]에서 직접) ──
function oracleWL(m: Matchup, teamId: string): [number, number] {
  let w = 0, l = 0;
  for (const g of m.series.games) {
    const iAmHi = m.hiId === teamId;
    const won = iAmHi ? g.hiSets > g.loSets : g.loSets > g.hiSets;
    if (won) w++; else l++;
  }
  return [w, l];
}

/** outcome 1건의 위반 목록 — 실데이터 0건 / 오염 객체 ≥1건이 이 검사기의 이빨. */
function violations(p: Playoffs, teamId: string, o: PostseasonOutcome): string[] {
  const v: string[] = [];
  const champ = p.championId;
  const inFinal = !!p.final && (p.final.hiId === teamId || p.final.loId === teamId);
  const inPo = !!p.po && (p.po.hiId === teamId || p.po.loId === teamId);

  if (teamId === champ) {
    const expect = p.seeds[0] === teamId ? 'integrated' : 'champion';
    if (o.kind !== expect) v.push(`champion팀 kind=${o.kind} (기대 ${expect})`);
    if (p.final) {
      const [w, l] = oracleWL(p.final, teamId);
      if (o.myWins !== w || o.myLosses !== l) v.push(`champion 스코어 ${o.myWins}-${o.myLosses} != 오라클 ${w}-${l}`);
      if (o.myWins !== 3) v.push(`champion인데 결승 3승 아님(${o.myWins})`);
      if (o.round !== 'final') v.push(`champion round=${o.round}`);
    }
  } else if (inFinal) {
    if (o.kind !== 'runnerUp') v.push(`결승 패자 kind=${o.kind} (기대 runnerUp)`);
    const [w, l] = oracleWL(p.final!, teamId);
    if (o.myWins !== w || o.myLosses !== l) v.push(`runnerUp 스코어 ${o.myWins}-${o.myLosses} != 오라클 ${w}-${l}`);
    if (o.myLosses !== 3 || o.myWins >= 3) v.push(`runnerUp인데 3패 아님(${o.myWins}-${o.myLosses})`);
  } else if (inPo) {
    if (o.kind !== 'poOut') v.push(`준PO 탈락 kind=${o.kind} (기대 poOut)`);
    const [w, l] = oracleWL(p.po!, teamId);
    if (o.myWins !== w || o.myLosses !== l) v.push(`poOut 스코어 ${o.myWins}-${o.myLosses} != 오라클 ${w}-${l}`);
    if (o.myLosses !== 2 || o.myWins >= 2) v.push(`poOut인데 2패 아님(${o.myWins}-${o.myLosses})`);
  } else {
    if (o.kind !== 'missed') v.push(`시드 밖 kind=${o.kind} (기대 missed)`);
    if (o.myWins !== 0 || o.myLosses !== 0 || o.round !== null) v.push(`missed인데 스코어/라운드 잔존(${o.myWins}-${o.myLosses}·${o.round})`);
  }
  return v;
}

resetLeagueBase();

// ── ①+② N시즌 × 전 팀 전수 — 분류 불변식 + 독립 오라클 스코어 정합 ──
const kinds: Record<string, number> = {};
let totalViol = 0;
for (let s = 0; s < N; s++) {
  const p = buildPlayoffs(s);
  let seasonChamp = 0, seasonRunner = 0, seasonPoOut = 0, seasonMissed = 0;
  for (const t of LEAGUE.teams) {
    const o = myPostseasonOutcome(p, t.id);
    kinds[o.kind] = (kinds[o.kind] ?? 0) + 1;
    totalViol += violations(p, t.id, o).length;
    if (o.kind === 'integrated' || o.kind === 'champion') seasonChamp++;
    else if (o.kind === 'runnerUp') seasonRunner++;
    else if (o.kind === 'poOut') seasonPoOut++;
    else seasonMissed++;
  }
  // 분포 정합(팀 7 · 시드 3): 시즌당 champion 1 · runnerUp 1 · poOut 1 · missed = 팀수-3
  check(seasonChamp === 1 && seasonRunner === 1 && seasonPoOut === 1 && seasonMissed === LEAGUE.teams.length - 3,
    `s${s} 분포 ${seasonChamp}/${seasonRunner}/${seasonPoOut}/${seasonMissed}`);
}
check(totalViol === 0, `실데이터 위반 ${totalViol}건`);
if (totalViol === 0) ok(`① kind 분류 불변식 + 시즌당 분포(1·1·1·${LEAGUE.teams.length - 3}) — ${N}시즌 × ${LEAGUE.teams.length}팀 위반 0`);
if (totalViol === 0) ok(`② 시리즈 스코어 == 독립 오라클(games[] 재집계) — 전수 일치`);
console.log('  분포:', JSON.stringify(kinds));

// ── ③ 결정론 — 같은 시즌 2회 → 완전 동일 ──
{
  const s = Math.min(7, N - 1);
  const a = myPostseasonOutcome(buildPlayoffs(s), LEAGUE.teams[0].id);
  const b = myPostseasonOutcome(buildPlayoffs(s), LEAGUE.teams[0].id);
  check(JSON.stringify(a) === JSON.stringify(b), `결정론: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  ok(`③ 결정론 — buildPlayoffs(${s})+outcome 2회 동일`);
}

// ── ④ A/B 뮤턴트 이빨 — 오염 outcome을 검사기가 잡는가(허위 오라클 방지) ──
{
  const p = buildPlayoffs(0);
  const champ = p.championId!;
  const real = myPostseasonOutcome(p, champ);
  // 뮤턴트 1: kind 뒤섞기(champion → missed)
  const m1: PostseasonOutcome = { ...real, kind: 'missed' };
  // 뮤턴트 2: 스코어 조작(myWins-1)
  const m2: PostseasonOutcome = { ...real, myWins: real.myWins - 1 };
  // 뮤턴트 3: 준우승 팀에 champion kind 부여
  const runner = p.final!.hiId === champ ? p.final!.loId : p.final!.hiId;
  const m3: PostseasonOutcome = { ...myPostseasonOutcome(p, runner), kind: 'champion' };
  const v1 = violations(p, champ, m1).length;
  const v2 = violations(p, champ, m2).length;
  const v3 = violations(p, runner, m3).length;
  console.log(`  A/B: 뮤턴트 위반 검출 — kind뒤섞기=${v1}건 · 스코어조작=${v2}건 · 준우승→champion=${v3}건 (실데이터 0건)`);
  check(v1 >= 1 && v2 >= 1 && v3 >= 1, `뮤턴트 미검출(${v1}/${v2}/${v3}) — 검사기 이빨 없음`);
  check(violations(p, champ, real).length === 0, '실데이터를 오검출');
  if (v1 >= 1 && v2 >= 1 && v3 >= 1) ok('④ mutant 감지: 오염 outcome 3종 전부 ≥1건 위반 검출 · 실데이터 0건 (오라클 이빨 증명)');
}

if (fails === 0) {
  console.log(`\nRECAP PASS — kind 분류·분포(N=${N}) · 스코어=독립오라클 · 결정론 · A/B 이빨`);
  process.exit(0);
} else {
  console.log(`\nRECAP FAIL — ${fails}건`);
  process.exit(1);
}
