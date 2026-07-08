// _dv_recap — 시즌 결산 상비 가드 (SEASON_SYSTEM §5.5, 2026-07-08).
// 임시 하네스 상설화(TEST_METHODOLOGY — 임시 검증은 상설 가드로 환원).
//
// A. 포스트시즌 결말 파생(myPostseasonOutcome):
//   ① kind 분류 불변식 — champion팀 = integrated(정규1위 직행 우승) | champion(하위시드 우승),
//      결승 패자 = runnerUp(3패), 준PO 탈락 = poOut(2패), 시드 밖 = missed. 분포 정합(시즌당 champ 1 · runnerUp 1 · poOut 1 · missed 4).
//   ② 시리즈 스코어 정합 — outcome.myWins/myLosses == 해당 시리즈를 내 팀 시점으로 독립 재집계한 값(독립 오라클).
//   ③ 결정론 — 같은 시즌 2회 → outcome 완전 동일.
//   ④ A/B 뮤턴트 이빨 — 오염 outcome(kind 뒤섞기·스코어 조작)을 검사기가 잡는지 증명(허위 오라클 방지).
//      _dv_playoffs 선례: 파일 변이 없이 오염 객체 in-memory 주입.
//
// B. "다음 시즌 숙제" 브리핑(recapBriefing) 정합 — 전수조사 표본 대조(I1~I3) 상설화:
//   ⑤ 예측 ⊆ 실제 오프시즌(buildOffseason) — recap이 예측한 FA 자격/만료가 실제 FA 풀 진입자를 빠짐없이 덮는가.
//      · 실제 FA 풀 진입자(pool ∩ 내 최종명단) ⊆ (faSoon ∪ expiring)  [영입 누락·override 무시가 뚫는 지점]
//      · 예측 FA(faSoon) ∩ 실제 잔류(off.rosters[my]) == ∅  [시즌 중 재계약(override) 반영 — 계약 남은 선수를 FA로 오예측 금지]
//   ⑥ 39세(정년) 전원 은퇴 & FA 줄 미등장 — retireSoon ⊆ off.retired, faSoon에 age≥39 없음("39세 정년만 확정 사실").
//   ⑦ A/B 뮤턴트 이빨 — override·시즌중이동 무시 모사(구버전 teamPlayerIds+base 계약) → 검사기가 ⑤⑥ 위반을 잡는가.
//
// 실행: npx tsx tools/_dv_recap.ts [시즌수=50]   (~수초). exit 0/1.

import {
  resetLeagueBase, LEAGUE, currentRosters, commitPlayerBase, commitRosters, getPlayer, teamPlayerIds,
} from '../data/league';
import { setTxContext, seasonTxLog, rosterIdsOnDay, type Tx } from '../data/dynamics';
import { buildOffseason } from '../data/offseason';
import { recapBriefing, type RecapBriefing } from '../data/recapBriefing';
import { willBeFA } from '../engine/faMarket';
import { RETIRE_AGE } from '../engine/retire';
import { SEASON_DAYS } from '../engine/calendar';
import { buildPlayoffs, myPostseasonOutcome, type Playoffs, type PostseasonOutcome, type Matchup } from '../data/playoffs';
import type { Contract, Player } from '../types';

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

// ══════════════════════════════════════════════════════════════════════════
// B. "다음 시즌 숙제" 브리핑 정합 (⑤⑥⑦) — 전수조사 표본 대조 상설화
// ══════════════════════════════════════════════════════════════════════════
console.log('\n[B] 다음 시즌 숙제 브리핑(recapBriefing) 정합');

/** 브리핑 예측 ↔ 실제 오프시즌(off) 불일치 목록. 실브리핑=0건 / 오염(뮤턴트)=≥1건이 이 검사기의 이빨. */
function briefViolations(b: RecapBriefing, off: ReturnType<typeof buildOffseason>, myTeam: string, myFinal: string[]): string[] {
  const v: string[] = [];
  const faSoon = new Set(b.faSoon.map((p) => p.id));
  const predicted = new Set([...b.faSoon, ...b.expiring].map((p) => p.id));
  const kept = new Set(off.rosters[myTeam] ?? []);
  const retired = new Set(off.retired);
  const myFinalSet = new Set(myFinal);
  // ⑤a 실제 FA 풀 진입자(내 최종명단 출신) ⊆ 예측(faSoon∪expiring) — 영입 누락/override 무시면 여기서 샌다
  for (const id of off.pool) {
    if (!myFinalSet.has(id)) continue;         // 내 팀 출신 풀 진입자만
    if (!predicted.has(id)) v.push(`pool 진입 ${id} 예측 밖(faSoon∪expiring)`);
  }
  // ⑤b 예측 FA(faSoon)인데 실제로는 계약 남아 잔류 → override(시즌중 재계약) 무시 오예측
  for (const id of faSoon) if (kept.has(id)) v.push(`faSoon ${id} 실제 잔류(계약 남음) — override 미반영`);
  // ⑥ 39세(정년) 전원 은퇴 & FA 줄 미등장
  for (const p of b.retireSoon) if (!retired.has(p.id)) v.push(`정년 ${p.id} 은퇴 안 함`);
  for (const p of b.faSoon) if (p.age >= RETIRE_AGE - 1) v.push(`faSoon에 정년(${p.age}세) ${p.id} 등장`);
  return v;
}

/** 구버전 버그 모사(뮤턴트): teamPlayerIds(base 시즌초 명단) + base 계약(override 무시) + 정년 미제외. */
function mutantBriefing(myTeam: string): RecapBriefing {
  const roster = teamPlayerIds(myTeam).map(getPlayer).filter((p): p is Player => !!p); // base 명단·base 계약(영입 누락·방출 잔존)
  return {
    faSoon: roster.filter(willBeFA),                                                     // 정년 미제외·override 미반영
    expiring: roster.filter((p) => !p.isForeign && p.contract.remaining <= 1 && !willBeFA(p)),
    retireSoon: roster.filter((p) => !p.isForeign && p.age >= RETIRE_AGE - 1),
  };
}

{
  resetLeagueBase();
  const my = LEAGUE.teams[0].id;
  const base = [...(currentRosters()[my] ?? [])];
  check(base.length >= 5, `내 팀 시드 로스터 ${base.length}명(≥5 필요)`);

  // ── 결정론 합성 시나리오: 역할별 base 선수 교체 + 시즌 중 영입(E)/방출(F) ──
  const clone = (id: string): Player => JSON.parse(JSON.stringify(getPlayer(id)));
  const mk = (id: string, over: Partial<Player>): Player => {
    const p = clone(id);
    return { ...p, isForeign: false, isAsianQuota: false, ...over, contract: { ...p.contract, ...(over.contract ?? {}) }, career: { ...p.career, ...(over.career ?? {}) } };
  };
  const [idA, idB, idC, idD, idF] = base;
  const salary = 30000;
  const contract = (remaining: number, age: number): Contract => ({ salary, years: Math.max(remaining, 1), remaining, signedAtAge: age });
  const snapshot: Record<string, Player> = {
    [idA]: mk(idA, { age: 30, career: { seasons: 6 } as Player['career'], contract: contract(1, 30) }), // FA 자격 → 풀
    [idB]: mk(idB, { age: 30, career: { seasons: 6 } as Player['career'], contract: contract(1, 30) }), // base=FA자격이나 시즌중 3년 재계약(override)
    [idC]: mk(idC, { age: 39, career: { seasons: 6 } as Player['career'], contract: contract(1, 39) }), // 정년 임박(FA 자격이나 정년 줄에만)
    [idD]: mk(idD, { age: 23, career: { seasons: 2 } as Player['career'], contract: contract(1, 23) }), // 어린 만료(자동연장 — expiring 워치)
    [idF]: mk(idF, { age: 24, career: { seasons: 2 } as Player['career'], contract: contract(2, 24) }), // 시즌 중 방출 대상(비FA)
  };
  const idE = `${my}-synthFA`; // 시즌 중 영입될 새 국내 FA(경력6·잔여1 → FA 자격)
  snapshot[idE] = mk(idA, { id: idE, name: '영입선수E', age: 28, career: { seasons: 6 } as Player['career'], contract: contract(1, 28) });
  commitPlayerBase(snapshot);

  // 시즌 중 이동: E 영입 + F 방출(중반). setTxContext → rosterIdsOnDay/seasonTxLog가 인지.
  const tx: Tx[] = [
    { day: 40, teamId: my, playerId: idE, kind: 'sign' },
    { day: 40, teamId: my, playerId: idF, kind: 'release' },
  ];
  setTxContext(tx, [idE], my, 0);

  const overrides: Record<string, Contract> = { [idB]: contract(3, 30) }; // B 시즌 중 3년 재계약
  const day = SEASON_DAYS;

  // ── 예측(결산 화면과 동일 경로) + 뮤턴트(구버전 버그) 둘 다 commit 전에 산출(구 recap은 endSeason 전 실행) ──
  const real = recapBriefing(my, day, overrides, [idF]);
  const mutant = mutantBriefing(my);

  const rf = new Set(real.faSoon.map((p) => p.id));
  const re = new Set(real.expiring.map((p) => p.id));
  const rr = new Set(real.retireSoon.map((p) => p.id));
  // 개별 표본 대조(I1~I3): 영입 포함·방출 제외·override·정년
  check(rf.has(idA), `A(FA자격) faSoon 포함`);
  check(rf.has(idE), `E(시즌중 영입) faSoon 포함 — 영입 누락 아님(#1)`);
  check(!rf.has(idB), `B(시즌중 3년 재계약) faSoon 제외 — override 반영(#1)`);
  check(re.has(idD), `D(어린 만료) expiring 포함`);
  check(rr.has(idC) && !rf.has(idC), `C(39세) 정년 줄에만·FA 줄 미등장(#2)`);
  check(![...rf, ...re, ...rr].includes(idF), `F(시즌중 방출) 숙제 명단 전무 — 방출 제외(#1)`);

  // ── endSeason 미러: 시즌 중 이동을 명단에 커밋 후 실제 오프시즌 산출 ──
  const finalR: Record<string, string[]> = {};
  const cur = currentRosters();
  for (const tid of Object.keys(cur)) finalR[tid] = [...cur[tid]];
  for (const t of seasonTxLog()) {
    const arr = finalR[t.teamId] ?? [];
    if (t.kind === 'release') finalR[t.teamId] = arr.filter((id) => id !== t.playerId);
    else if (!arr.includes(t.playerId)) finalR[t.teamId] = [...arr, t.playerId];
  }
  commitRosters(finalR);
  const myFinal = finalR[my] ?? [];
  check(myFinal.includes(idE) && !myFinal.includes(idF), `최종 명단 = 영입 반영·방출 제외(E∈·F∉)`);

  // resignDecisions: 예측 FA는 전부 포기(false) → 풀로 내보내 subset·잔류 검사를 깨끗이(A/E→pool, B는 계약남아 잔류)
  const resignDecisions: Record<string, boolean> = {};
  for (const p of real.faSoon) resignDecisions[p.id] = false;
  const off = buildOffseason(my, resignDecisions, overrides, 1);

  // ⑤⑥ 실브리핑 위반 0
  const realViol = briefViolations(real, off, my, myFinal);
  check(realViol.length === 0, `실브리핑 위반 ${realViol.length}건: ${realViol.join(' / ')}`);
  // 실제 오프시즌 관측(사실 확인): B 잔류·C 은퇴·E 풀
  check((off.rosters[my] ?? []).includes(idB), `실제: B 잔류(override 계약 남음)`);
  check(off.retired.includes(idC), `실제: C(정년) 은퇴`);
  check(off.pool.includes(idE), `실제: E FA 풀 진입(포기)`);
  if (realViol.length === 0) ok('⑤⑥ recapBriefing 예측 ⊆ 실제 buildOffseason(영입·방출·override·정년 전부 정합)');

  // ⑦ A/B 뮤턴트 이빨 — 구버전(base 명단·계약) 예측을 같은 검사기로 → ⑤⑥ 위반 검출
  const mutViol = briefViolations(mutant, off, my, myFinal);
  console.log(`  A/B: 뮤턴트(override·시즌이동 무시) 위반 ${mutViol.length}건 — ${mutViol.join(' / ') || '없음'}`);
  check(mutViol.length >= 1, `뮤턴트 미검출 — 검사기 이빨 없음(허위 오라클)`);
  if (mutViol.length >= 1 && realViol.length === 0) ok('⑦ mutant 감지: 구버전 예측이 ⑤⑥ 위반 ≥1건 · 실브리핑 0건 (오라클 이빨 증명)');
}

if (fails === 0) {
  console.log(`\nRECAP PASS — [A] kind 분류·분포(N=${N})·스코어=독립오라클·결정론·이빨 · [B] 숙제 브리핑 ⊆ 오프시즌·정년·override·A/B 이빨`);
  process.exit(0);
} else {
  console.log(`\nRECAP FAIL — ${fails}건`);
  process.exit(1);
}
