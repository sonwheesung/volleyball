// FIVB 15.6.1 합법 재진입 가드 (MATCH_INTERVENTION_SYSTEM §4.2 정정, 2026-07-30 · EC-SUB-02 확장)
//   나간 선발 A가 자기 슬롯 S로·자기 교체선수 B와 교대로만·세트당 1회·유저 개입(manual)만 재진입할 수 있음을 실측으로 봉인.
//   실행: npx tsx tools/_dv_reentry.ts [aiCorpus=2000]
//
//   검증 축:
//   (a) 합법 재진입 — iv1(A→B) + iv2(B→A, 같은 좌표)가 실제로 A를 자기 슬롯 S로 되돌린다(2회 enter, 예산 2 소비, A 코트 복귀).
//   (b) 불법 시도 차단 — ① 타슬롯 재진입(A를 C 자리로) ② B 재진입(B가 나간 뒤 재투입) ③ A 재이탈(복귀 A를 다시 뺌).
//   (c) AI 격리 — 무개입(AI) 경기 대량 코퍼스에서 재진입(나간 선발이 IN enter로 재등장) 0건 → kind==='manual' 게이트가
//       AI 자동교체(rest 등)를 재진입 경로에서 격리(무개입 바이트 동일의 근거).
//   허위 오라클 방지: 각 시나리오는 iv1(정상 교체)이 실제 발화했음을 먼저 확인한 뒤 재진입 성패를 판정.
import { LEAGUE, getEvolvedTeamPlayers, coachInfoOf, resetLeagueBase } from '../data/league';
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { applySubsToSix } from '../components/courtDirector';
import type { SubEvent, MatchIntervention } from '../engine/simMatch';
import type { Player, Side } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');

// 나간 선발(enter.outId)이 이후 IN enter(inId)로 재등장하면 위반(슬롯 무관). subOut 복원(enter:false)·부상은 제외.
function reenterViolations(evs: SubEvent[]): number {
  const pulled = new Map<string, Set<string>>();
  let bad = 0;
  for (const e of evs) {
    if (e.kind === 'injury' || !e.enter) continue;
    const key = `${e.setNo}:${e.side}`;
    if (pulled.get(key)?.has(e.inId)) bad++;
    if (!pulled.has(key)) pulled.set(key, new Set());
    pulled.get(key)!.add(e.outId);
  }
  return bad;
}

resetLeagueBase();
const ids = LEAGUE.teams.map((t) => t.id);
const sq: Record<string, Player[]> = {};
for (const id of ids) sq[id] = getEvolvedTeamPlayers(id, 0);

// ── 합성 개입 시나리오 표본 구성 ──
//   각 홈 팀에서 비세터·비리베로 선발 A·C, A와 같은 포지션 벤치 B·D를 뽑아 개입을 심는다.
interface Scen {
  hi: string; ai: string; seed: number;
  A: Player; sA: number; B: Player; C: Player; sC: number; D: Player | null;
}
function buildScens(want: number): Scen[] {
  const out: Scen[] = [];
  let seed = 660000;
  for (let m = 0; out.length < want && m < ids.length * 40; m++) {
    const hi = ids[m % ids.length], ai = ids[(m * 7 + 3) % ids.length];
    if (hi === ai) continue;
    const home = sq[hi];
    const lu = buildLineup(home, coachInfoOf(hi)?.dvPhilosophy ?? 0);
    const sixIds = new Set(lu.six.map((p) => p.id));
    const liberoId = lu.libero?.id;
    const starters = lu.six.map((p, i) => ({ p, i })).filter((x) => x.p.position !== 'S' && x.p.position !== 'L');
    if (starters.length < 2) continue;
    const A = starters[0].p, sA = starters[0].i;
    const C = starters[1].p, sC = starters[1].i;
    // 같은 포지션(A) 벤치 2명(B, D) — 재진입 짝 + A 재이탈 시도용
    const benchSamePos = home.filter((p) => p.position === A.position && !sixIds.has(p.id) && p.id !== liberoId);
    if (benchSamePos.length < 1) continue;
    const B = benchSamePos[0];
    const D = benchSamePos[1] ?? home.find((p) => !sixIds.has(p.id) && p.id !== liberoId && p.position !== 'L' && p.id !== B.id) ?? null;
    seed += 13;
    out.push({ hi, ai, seed, A, sA, B, C, sC, D });
  }
  return out;
}

const scens = buildScens(60);

const set1Last = (points: { setNo: number }[]): number => {
  let last = -1;
  for (let i = 0; i < points.length; i++) if (points[i].setNo === 1) last = i;
  return last;
};
const sixAt = (base: Player[], side: Side, evs: SubEvent[], upto: number, byId: Map<string, Player>) =>
  applySubsToSix(base, side, evs, upto, byId);

function runOne(sc: Scen, interventions: MatchIntervention[]) {
  const home = sq[sc.hi], away = sq[sc.ai];
  const sim = simulateMatch(sc.seed, home, away, { home: coachInfoOf(sc.hi), away: coachInfoOf(sc.ai), interventions });
  const byId = new Map<string, Player>();
  for (const p of home) byId.set(p.id, p);
  for (const p of away) byId.set(p.id, p);
  const baseSix = buildLineup(home, coachInfoOf(sc.hi)?.dvPhilosophy ?? 0).six;
  const evs = (sim.subEvents ?? []).filter((e) => e.side === 'home' && e.setNo === 1 && e.kind !== 'injury');
  return { sim, byId, baseSix, evs };
}

// ── (a) 합법 재진입 ──
let aTot = 0, aIv1 = 0, aReentered = 0, aBudget2 = 0, aOnCourt = 0, aBGone = 0;
for (const sc of scens) {
  const ivs: MatchIntervention[] = [
    { at: { setNo: 1, h: 0, a: 0 }, side: 'home', kind: 'sub', outId: sc.A.id, inId: sc.B.id }, // A→B
    { at: { setNo: 1, h: 0, a: 0 }, side: 'home', kind: 'sub', outId: sc.B.id, inId: sc.A.id }, // B→A 재진입
  ];
  const { sim, byId, baseSix, evs } = runOne(sc, ivs);
  aTot++;
  const e1 = evs.find((e) => e.enter && e.inId === sc.B.id && e.outId === sc.A.id && e.slot === sc.sA);
  if (e1) aIv1++; else continue; // 허위 오라클 방지: iv1(A→B) 미발화면 이 표본은 판정 불가
  const e2 = evs.find((e) => e.enter && e.inId === sc.A.id && e.outId === sc.B.id && e.slot === sc.sA);
  if (e2) aReentered++;
  // 예산 2 소비 = manual-kind enter 정확히 2건(A→B, B→A 각 subBudget−1). AI 자동교체(rest/pinch/block/def)는 kind가
  //   달라 분리 집계 — manualSide 미지정이라 홈에도 감독 자동교체가 섞일 수 있으므로 manual만 센다.
  const manualEnters = evs.filter((e) => e.kind === 'manual' && e.enter).length;
  if (manualEnters === 2) aBudget2++;
  // A가 세트1 종료 시점 코트 슬롯 sA에 복귀·B는 코트에 없음
  const li = set1Last(sim.points);
  const six = sixAt(baseSix, 'home', sim.subEvents ?? [], li, byId);
  if (six[sc.sA]?.id === sc.A.id) aOnCourt++;
  if (!six.some((p) => p.id === sc.B.id)) aBGone++;
}

// ── (b①) 타슬롯 재진입 차단 ── iv1(A→B) + iv2(A를 C 자리로) → A 재진입 금지
let b1Tot = 0, b1Iv1 = 0, b1Aenter = 0, b1Viol = 0;
for (const sc of scens) {
  const ivs: MatchIntervention[] = [
    { at: { setNo: 1, h: 0, a: 0 }, side: 'home', kind: 'sub', outId: sc.A.id, inId: sc.B.id },
    { at: { setNo: 1, h: 0, a: 0 }, side: 'home', kind: 'sub', outId: sc.C.id, inId: sc.A.id }, // 타슬롯(불법)
  ];
  const { evs } = runOne(sc, ivs);
  b1Tot++;
  if (evs.some((e) => e.enter && e.inId === sc.B.id)) b1Iv1++; else continue;
  if (evs.some((e) => e.enter && e.inId === sc.A.id)) b1Aenter++; // 있으면 안 됨(A가 어디로든 재진입)
  b1Viol += reenterViolations(evs);
}

// ── (b②) B 재진입 차단 ── iv1(A→B) + iv2(B→A 합법) + iv3(B를 C 자리로) → B 재투입 금지
let b2Tot = 0, b2Iv1 = 0, b2Bcount2 = 0;
for (const sc of scens) {
  const ivs: MatchIntervention[] = [
    { at: { setNo: 1, h: 0, a: 0 }, side: 'home', kind: 'sub', outId: sc.A.id, inId: sc.B.id },
    { at: { setNo: 1, h: 0, a: 0 }, side: 'home', kind: 'sub', outId: sc.B.id, inId: sc.A.id }, // 합법 재진입(B 나감)
    { at: { setNo: 1, h: 0, a: 0 }, side: 'home', kind: 'sub', outId: sc.C.id, inId: sc.B.id }, // B 재투입 시도(불법)
  ];
  const { evs } = runOne(sc, ivs);
  b2Tot++;
  if (evs.some((e) => e.enter && e.inId === sc.B.id)) b2Iv1++; else continue;
  const bEnters = evs.filter((e) => e.enter && e.inId === sc.B.id).length;
  if (bEnters === 1) b2Bcount2++; // B는 딱 1번만 진입(iv3 무시)
}

// ── (b③) A 재이탈 차단 ── iv1(A→B) + iv2(B→A 합법) + iv3(복귀 A를 D로 다시 뺌) → A 재이탈 금지
let b3Tot = 0, b3Iv1 = 0, b3Aheld = 0, b3Dgone = 0;
for (const sc of scens) {
  if (!sc.D) continue;
  const ivs: MatchIntervention[] = [
    { at: { setNo: 1, h: 0, a: 0 }, side: 'home', kind: 'sub', outId: sc.A.id, inId: sc.B.id },
    { at: { setNo: 1, h: 0, a: 0 }, side: 'home', kind: 'sub', outId: sc.B.id, inId: sc.A.id }, // 합법 재진입(A 복귀)
    { at: { setNo: 1, h: 0, a: 0 }, side: 'home', kind: 'sub', outId: sc.A.id, inId: sc.D.id }, // A 재이탈 시도(불법)
  ];
  const { sim, byId, baseSix, evs } = runOne(sc, ivs);
  b3Tot++;
  if (evs.some((e) => e.enter && e.inId === sc.B.id)) b3Iv1++; else continue;
  const li = set1Last(sim.points);
  const six = sixAt(baseSix, 'home', sim.subEvents ?? [], li, byId);
  if (six[sc.sA]?.id === sc.A.id) b3Aheld++;                 // A는 계속 코트에
  if (!six.some((p) => p.id === sc.D!.id)) b3Dgone++;        // D는 못 들어옴
}

// ── (c) AI 격리 — 무개입 코퍼스 재진입 0 ──
const AI = Math.max(1, Number(process.argv[2]) || 2000);
let aiGames = 0, aiViol = 0, aiWithSubs = 0;
let aseed = 300000;
for (let m = 0; m < AI; m++) {
  const hi = ids[m % ids.length], ai = ids[(m * 3 + 1) % ids.length];
  if (hi === ai) continue;
  aseed += 13;
  const sim = simulateMatch(aseed, sq[hi], sq[ai], { home: coachInfoOf(hi), away: coachInfoOf(ai) });
  aiGames++;
  const evs = sim.subEvents ?? [];
  if (evs.length) aiWithSubs++;
  aiViol += reenterViolations(evs);
}

log(`\n합성 표본 ${scens.length}건 (A/C 선발 + B/D 벤치)`);
log(`(a) 합법 재진입: 표본 ${aTot} · iv1 발화 ${aIv1} · A 재진입 enter ${aReentered} · 예산=2 ${aBudget2} · A 코트복귀 ${aOnCourt} · B 이탈 ${aBGone}`);
log(`(b①) 타슬롯 재진입: 표본 ${b1Tot} · iv1 발화 ${b1Iv1} · A 재진입 enter ${b1Aenter}(0이어야) · 재진입위반 ${b1Viol}(0이어야)`);
log(`(b②) B 재진입: 표본 ${b2Tot} · iv1 발화 ${b2Iv1} · B 진입 정확히1회 ${b2Bcount2}`);
log(`(b③) A 재이탈: 표본 ${b3Tot} · iv1 발화 ${b3Iv1} · A 코트유지 ${b3Aheld} · D 미진입 ${b3Dgone}`);
log(`(c) AI 격리: 무개입 ${aiGames}경기(교체 ${aiWithSubs}) · 재진입 위반 ${aiViol}(0이어야)`);

log('\n검증:');
const assert = (c: boolean, label: string, detail = '') => log(`  ${c ? 'PASS' : 'FAIL ❌'} — ${label}${detail}`);
assert(aIv1 >= 40, '(허위오라클) 합법 시나리오 iv1 발화 표본 충분', ` (${aIv1})`);
assert(aReentered === aIv1, '(a) 합법 재진입 — 자기 슬롯 A 복귀 전건', ` (${aReentered}/${aIv1})`);
assert(aBudget2 === aIv1, '(a) 재진입 예산 정확히 2 소비(세트말 잉여 복원 없음)', ` (${aBudget2}/${aIv1})`);
assert(aOnCourt === aIv1, '(a) 세트1 종료 시 A가 자기 슬롯 코트 복귀', ` (${aOnCourt}/${aIv1})`);
assert(aBGone === aIv1, '(a) 세트1 종료 시 교체선수 B 코트 이탈', ` (${aBGone}/${aIv1})`);
assert(b1Iv1 >= 40, '(허위오라클) b① iv1 발화 충분', ` (${b1Iv1})`);
assert(b1Aenter === 0, '(b①) 나간 선발 A의 타슬롯 재진입 no-op', ` (A진입 ${b1Aenter})`);
assert(b1Viol === 0, '(b①) 타슬롯 재진입 위반 0', ` (${b1Viol})`);
assert(b2Iv1 >= 40, '(허위오라클) b② iv1 발화 충분', ` (${b2Iv1})`);
assert(b2Bcount2 === b2Iv1, '(b②) 교체선수 B 재투입 차단(진입 정확히 1회)', ` (${b2Bcount2}/${b2Iv1})`);
assert(b3Tot >= 40 && b3Iv1 >= 40, '(허위오라클) b③ iv1 발화 충분', ` (${b3Iv1}/${b3Tot})`);
assert(b3Aheld === b3Iv1, '(b③) 복귀 선발 A 재이탈 차단(코트 유지)', ` (${b3Aheld}/${b3Iv1})`);
assert(b3Dgone === b3Iv1, '(b③) A 재이탈 시도 IN(D) no-op', ` (${b3Dgone}/${b3Iv1})`);
assert(aiWithSubs > 0, '(c) AI 코퍼스에서 교체가 실제 발동(연출 켜짐)');
assert(aiViol === 0, '(c) AI 격리 — 무개입 경기 재진입 위반 0(kind==manual 게이트)', ` (${aiViol})`);

const pass = aIv1 >= 40 && aReentered === aIv1 && aBudget2 === aIv1 && aOnCourt === aIv1 && aBGone === aIv1
  && b1Iv1 >= 40 && b1Aenter === 0 && b1Viol === 0
  && b2Iv1 >= 40 && b2Bcount2 === b2Iv1
  && b3Iv1 >= 40 && b3Aheld === b3Iv1 && b3Dgone === b3Iv1
  && aiWithSubs > 0 && aiViol === 0;
log('완료.');
process.exit(pass ? 0 : 1);
