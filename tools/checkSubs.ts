// 작전 교체 연출 로그(subEvents) 검증 + 빈도 측정.
//   npx tsx tools/checkSubs.ts [matches=400]
// 추정 금지: subEvents 가 (1) 일관(슬롯·id·정렬), (2) 재생 시 세트말마다 base 로 원복(net-zero),
//   (3) enter 시점 슬롯 점유자가 inId 와 일치 — 를 실제 시뮬로 확인. 빈도도 측정.
import { LEAGUE, getEvolvedTeamPlayers, coachInfoOf, resetLeagueBase } from '../data/league';
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { applySubsToSix } from '../components/courtDirector';
import type { SubEvent, MatchIntervention } from '../engine/simMatch';
import type { Player, Side } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');

// FIVB 15.6.1(F2, EC-SUB-02) — 나간 선발이 같은 세트 다른 슬롯 IN으로 재진입하면 위반.
//   enter 이벤트의 outId(=코트에서 빠진 선발)를 세트·사이드별로 모으고, 이후 enter의 inId가 그 집합에 있으면 위반(슬롯 무관).
//   부상(injury)은 예외적 교체라 제외. subOut 복원(enter:false)은 합법 복귀라 검사 안 함.
//   ※ 도메인 규칙의 '누가'까지 검사 — 기존 재진입/재이탈 검사는 세트당 '횟수'만 셌다(TEST_METHODOLOGY §4).
function reenterViolations(evs: SubEvent[]): number {
  const pulled = new Map<string, Set<string>>(); // `${setNo}:${side}` → 나간 선발 id
  let bad = 0;
  for (const e of evs) {
    if (e.kind === 'injury') continue;
    if (!e.enter) continue;
    const key = `${e.setNo}:${e.side}`;
    if (pulled.get(key)?.has(e.inId)) bad++; // 이미 이 세트에 나갔던 선발이 IN으로 재등장 = 위반
    if (!pulled.has(key)) pulled.set(key, new Set());
    pulled.get(key)!.add(e.outId);            // 이 enter로 outId 선발이 코트를 떠남 → 재진입 감시 대상
  }
  return bad;
}

resetLeagueBase();
const ids = LEAGUE.teams.map((t) => t.id);
const sq: Record<string, Player[]> = {};
for (const id of ids) sq[id] = getEvolvedTeamPlayers(id, 0);

const N = Math.max(1, Number(process.argv[2]) || 400);

let matches = 0, withSubs = 0, totalEvents = 0, totalEnters = 0;
let failConsistency = 0, failNetZero = 0, failOccupant = 0, failOrder = 0, failReentry = 0, failReout = 0, failReenterSlot = 0;
const kindCount: Record<string, number> = { pinch: 0, block: 0, def: 0, injury: 0, rest: 0 };
let injuryEnters = 0; // 경기 내 부상 교체(1.3d) — 영구 스왑(net-zero·재진입 규칙 면제 대상)

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
    if (e.enter) { totalEnters++; kindCount[e.kind] = (kindCount[e.kind] ?? 0) + 1; if (e.kind === 'injury') injuryEnters++; }
  }

  // (2) net-zero: 전체 재생 후 base 로 원복(세트말 원복이 모두 기록됐는지).
  //   부상 교체(kind:'injury', 1.3d)는 **영구(비원복)** — 기대 최종 = base에 부상 스왑만 적용(작전 교체는 여전히 net-zero여야 통과).
  for (const side of ['home', 'away'] as Side[]) {
    const final = applySubsToSix(baseSix[side], side, evs, sim.points.length, byId);
    const expected = baseSix[side].slice();
    for (const e of evs) if (e.side === side && e.kind === 'injury' && e.enter) { const p = byId.get(e.inId); if (p) expected[e.slot] = p; }
    const same = final.length === expected.length && final.every((p, i) => p.id === expected[i].id);
    if (!same) failNetZero++;
  }

  // (3) enter 점유자 일치: enter 직후(그 point) 재생하면 그 슬롯에 inId 가 있어야
  for (const e of evs) {
    if (!e.enter) continue;
    const six = applySubsToSix(baseSix[e.side], e.side, evs, e.point, byId);
    if (six[e.slot]?.id !== e.inId) failOccupant++;
  }

  // (4) FIVB 교체 규칙 — 교체선수는 세트당 1회만 진입(재진입 금지)·선발은 세트당 1왕복(재이탈 금지).
  //   구조·net-zero·점유자 검사는 핑퐁(in-out-in)도 통과시킴(연출 충실도만 봄) → 규칙 합법성을 별도 검사.
  //   2026-07-01 도입 전 200경기에 재진입 1316건 검출됐던 도메인-규칙 사각(TEST_METHODOLOGY §4).
  const enterCnt = new Map<string, number>(); // `${setNo}:${side}:${inId}`
  const outCnt = new Map<string, number>();    // `${setNo}:${side}:${outId}`(선발 아웃)
  for (const e of evs) {
    if (e.kind === 'injury') continue; // 부상 교체는 FIVB 예외적 교체 — 세트당1회·1왕복 규칙 밖(면제)
    const k = `${e.setNo}:${e.side}:${e.enter ? e.inId : e.outId}`;
    if (e.enter) enterCnt.set(k, (enterCnt.get(k) ?? 0) + 1);
    else outCnt.set(k, (outCnt.get(k) ?? 0) + 1);
  }
  for (const c of enterCnt.values()) if (c > 1) failReentry++;
  for (const c of outCnt.values()) if (c > 1) failReout++;

  // (5) F2 타슬롯 재진입(EC-SUB-02) — AI 자연 우주에서도 0이어야(피로 교체 rest 스캔 이론상 노출).
  failReenterSlot += reenterViolations(evs);
}

// ── 개입 주입 묶음(F2 A/B) — 규칙 위반을 시도하는 개입을 심어 봉인 확인 ──
//   iv1: 홈 비세터 선발 X를 벤치 Y로 교체(세트1 0:0) / iv2: 다른 선발 C 자리에 나간 X를 IN 지정(타슬롯 재진입 시도).
//   같은 좌표(1,0,0)에 배열 순서로 처리 → iv1 적용 후 iv2. 수정 후: iv2는 subIn 재진입 가드로 no-op(X 미진입) → 재진입 위반 0.
//   수정 전(guard 제거 변이): iv2 적용 → X가 C 슬롯 IN enter → reenterViolations>0 (민감도 A/B, cp 백업 복원으로 실증).
let injBundle = 0, injFired = 0, injReenter = 0, injXEntered = 0;
{
  let iseed = 770000;
  const INJ = Math.max(200, Number(process.argv[3]) || 300);
  for (let m = 0; m < INJ * 2 && injBundle < INJ; m++) {
    const hi = ids[m % ids.length], ai = ids[(m * 7 + 3) % ids.length];
    if (hi === ai) continue;
    const home = sq[hi], away = sq[ai];
    const lu = buildLineup(home);
    const sixIds = new Set(lu.six.map((p) => p.id));
    const liberoId = lu.libero?.id;
    const starters = lu.six.filter((p) => p.position !== 'S' && p.position !== 'L');
    if (starters.length < 2) continue;
    const X = starters[0], C = starters[1];
    const Y = home.find((p) => !sixIds.has(p.id) && p.id !== liberoId && p.position !== 'L');
    if (!Y) continue;
    iseed += 13;
    const interventions: MatchIntervention[] = [
      { at: { setNo: 1, h: 0, a: 0 }, side: 'home', kind: 'sub', outId: X.id, inId: Y.id },
      { at: { setNo: 1, h: 0, a: 0 }, side: 'home', kind: 'sub', outId: C.id, inId: X.id }, // 타슬롯 재진입 시도(불법)
    ];
    const sim = simulateMatch(iseed, home, away, { home: coachInfoOf(hi), away: coachInfoOf(ai), interventions });
    const evs = sim.subEvents ?? [];
    injBundle++;
    // iv1 발화 확인(허위 오라클 방지): Y가 이 경기에 IN enter로 들어갔나.
    if (evs.some((e) => e.enter && e.inId === Y.id)) injFired++;
    // 봉인 확인: 나간 선발 X가 IN enter로 재등장하면 안 됨(수정 후 0).
    if (evs.some((e) => e.enter && e.inId === X.id)) injXEntered++;
    injReenter += reenterViolations(evs);
  }
}

log(`\n경기 ${matches}건 · 교체 있던 경기 ${withSubs} (${(100 * withSubs / matches).toFixed(0)}%)`);
log(`총 교체 이벤트 ${totalEvents} (경기당 ${(totalEvents / matches).toFixed(1)}) · 그중 투입(enter) ${totalEnters}`);
log(`투입 종류: 핀치서버 ${kindCount.pinch} · 블로킹 ${kindCount.block} · 수비 ${kindCount.def} · 부상교체 ${kindCount.injury} (경기당 ${(injuryEnters / matches).toFixed(3)}) · 피로교체 ${kindCount.rest} (경기당 ${(kindCount.rest / matches).toFixed(3)})`);
log('\n검증:');
const assert = (c: boolean, label: string, detail = '') => log(`  ${c ? 'PASS' : 'FAIL ❌'} — ${label}${detail}`);
assert(failOrder === 0, 'subEvents point 오름차순', failOrder ? ` (위반 ${failOrder})` : '');
assert(failConsistency === 0, '슬롯 0..5 · in/out id 소속·point 범위', failConsistency ? ` (위반 ${failConsistency})` : '');
assert(failNetZero === 0, '전체 재생 → base 원복(세트말 net-zero)', failNetZero ? ` (위반 ${failNetZero})` : '');
assert(failOccupant === 0, 'enter 시점 슬롯 점유자 == inId', failOccupant ? ` (위반 ${failOccupant})` : '');
assert(failReentry === 0, 'FIVB: 교체선수 세트당 1회만 진입(재진입 금지)', failReentry ? ` (위반 ${failReentry})` : '');
assert(failReout === 0, 'FIVB: 선발 세트당 1왕복만(재이탈 금지)', failReout ? ` (위반 ${failReout})` : '');
assert(failReenterSlot === 0, 'FIVB 15.6.1(F2): 나간 선발 타슬롯 재진입 금지 — AI 우주', failReenterSlot ? ` (위반 ${failReenterSlot})` : '');
assert(withSubs > 0, '실제 경기에서 교체가 발동함(연출이 켜짐)');
log(`\n개입 주입 묶음(F2 A/B): ${injBundle}경기 · iv1 발화 ${injFired} · X 재진입 enter ${injXEntered} · 재진입 위반 ${injReenter}`);
assert(injBundle >= 200, '개입 묶음 표본 ≥200', injBundle < 200 ? ` (${injBundle})` : '');
assert(injFired === injBundle, '개입 묶음: iv1(정상 교체)이 전 경기 발화(허위 오라클 방지)', injFired !== injBundle ? ` (${injFired}/${injBundle})` : '');
assert(injXEntered === 0, '개입 묶음: 나간 선발 X의 타슬롯 재진입 no-op(봉인)', injXEntered ? ` (X 진입 ${injXEntered})` : '');
assert(injReenter === 0, 'FIVB 15.6.1(F2): 개입 주입 묶음 재진입 위반 0', injReenter ? ` (위반 ${injReenter})` : '');
const pass = failOrder === 0 && failConsistency === 0 && failNetZero === 0 && failOccupant === 0 && failReentry === 0 && failReout === 0
  && failReenterSlot === 0 && withSubs > 0 && injBundle >= 200 && injFired === injBundle && injXEntered === 0 && injReenter === 0;
log('완료.');
process.exit(pass ? 0 : 1);
