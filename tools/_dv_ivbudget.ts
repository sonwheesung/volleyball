// 개입 시트 표시 산출 가드 (MATCH_INTERVENTION_SYSTEM §4, 스테일 카운트 버그 2026-07-21) — 순수 셀렉터
// data/matchInterventionView를 **실제 엔진(simulateMatch)을 오라클로** 구동해 검증한다(허위 오라클 방지).
//   (a) 같은 데드볼 N연속 교체 → 잔여 예산 즉시 −1씩(스테일 아님)
//   (b) 재생 진행 후 이중 카운트 없음(합계 불변)
//   (c) 방금 나간 선수/투입 선수가 후보에서 즉시 제외 = 엔진이 그 재교체를 실제 거절(no-op)
//   (d) 소진 경계: subLeft>=2(버튼 활성) ⇔ 엔진 실제 수락 (표시상 여유인데 엔진 거절 케이스 소멸)
//   (e) 개입 없는(감독 자동) 경기 표시 = 구 산식과 바이트 동일(무회귀)
//   + A/B 민감도: 버그 재주입(pending 무시, 구 point<=ptIdx-only 산식) 시 (a)/(c) 검사가 반드시 FAIL.
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { applySubsToSix } from '../components/courtDirector';
import { ivBudget as selIvBudget, ivExclusions, benchCandidates, outCandidates } from '../data/matchInterventionView';
import type { IvCoord } from '../data/matchInterventionView';
import type { MatchIntervention, SimResult, SubEvent } from '../engine/simMatch';
import type { Player, Side } from '../types';
import { LEAGUE, getEvolvedTeamPlayers, coachInfoOf, resetLeagueBase } from '../data/league';

resetLeagueBase();
const teams = LEAGUE.teams;
const SUBS = 6;

let fail = 0;
const failMsgs: string[] = [];
function check(cond: boolean, msg: string) { if (!cond) { fail++; failMsgs.push(msg); } }

// 구(버그) 산식 — pending 항 없이 point<=ptIdx만. A/B 민감도용.
function buggySubLeft(sim: SimResult, side: Side, cur: IvCoord): number {
  const used = (sim.subEvents ?? []).filter((e) => e.side === side && e.setNo === cur.setNo && e.kind !== 'injury' && e.point <= cur.ptIdx).length;
  return Math.max(0, SUBS - used);
}
const applied = (sim: SimResult, ptIdx: number, kind: string, inId: string): boolean =>
  (sim.subEvents ?? []).some((e) => e.enter && e.point === ptIdx + 1 && e.kind === kind && e.inId === inId);

interface Scenario {
  seed: number; H: Player[]; A: Player[]; opts: any; base: SimResult; cur: IvCoord; baseSix: Player[]; byId: Map<string, Player>; manualSide?: Side;
}
function buildScenario(i: number, manualSide?: Side): Scenario | null {
  const seed = (i * 2654435761) >>> 0;
  const hId = teams[i % teams.length].id, aId = teams[(i + 1) % teams.length].id;
  const H = getEvolvedTeamPlayers(hId, 0), A = getEvolvedTeamPlayers(aId, 0);
  const opts: any = { home: coachInfoOf(hId), away: coachInfoOf(aId), ...(manualSide ? { manualSide } : {}) };
  const base = simulateMatch(seed, H, A, opts);
  if (base.points.length < 12) return null;
  const midPt = base.points.find((p) => p.setNo === 1 && p.home + p.away >= 6);
  if (!midPt) return null;
  const ptIdx = base.points.findIndex((p) => p.setNo === 1 && p.home === midPt.home && p.away === midPt.away);
  const byId = new Map<string, Player>([...H, ...A].map((p) => [p.id, p] as const));
  // 시뮬과 동일 육성철학으로 라인업 — dv 생략 시 근소차 슬롯(OP U23 등)이 어긋나 실제 코트와 불일치(board도 동일하게 dv 전달).
  const baseSix = buildLineup(H, (coachInfoOf(hId) as any).dvPhilosophy ?? 0).six;
  if (!baseSix.length) return null;
  return { seed, H, A, opts, base, cur: { setNo: 1, h: midPt.home, a: midPt.away, ptIdx }, baseSix, byId, manualSide };
}

// 현재 sim/directives에서 home 코트 6인
function courtOf(s: Scenario, sim: SimResult): Player[] {
  return applySubsToSix(s.baseSix, 'home', sim.subEvents, s.cur.ptIdx + 1, s.byId);
}
// 데드볼 연속 교체용 (out,in) 쌍 — **원선발 코트(base)에서 1회 사전 산출**(각 원선발 슬롯 1개씩·distinct 벤치).
//   원선발을 타겟하므로 개입이 순서대로 주입돼도 각자 자기 슬롯에서 유효(교체 후 코트 변화 무관). 최대 5쌍(비세터 슬롯).
function basePairs(s: Scenario): Array<{ outId: string; inId: string }> {
  const court = courtOf(s, s.base);
  const onCourt = new Set(court.map((p) => p.id));
  // 부상 교체가 걸린 선수(부상당해 나간 원선발·부상 교체로 들어온 잠금 슬롯 점유자)는 개입 out 대상에서 제외 —
  //   엔진이 그 슬롯을 거부해 게이트 오라클(구조상 유효 쌍만 시도)을 오염시킨다. injury는 유저 개입 무관 축.
  const injuryLock = new Set<string>();
  for (const e of s.base.subEvents ?? []) {
    if (e.kind === 'injury' && e.side === 'home' && e.point <= s.cur.ptIdx + 1) { injuryLock.add(e.inId); injuryLock.add(e.outId); }
  }
  const pairs: Array<{ outId: string; inId: string }> = [];
  const takenIn = new Set<string>();
  for (const x of court) {
    if (x.position === 'S' || x.position === 'L' || injuryLock.has(x.id)) continue;
    const b = s.H.find((p) => p.position === x.position && !onCourt.has(p.id) && !takenIn.has(p.id) && !injuryLock.has(p.id));
    if (b) { pairs.push({ outId: x.id, inId: b.id }); takenIn.add(b.id); }
  }
  return pairs;
}

// ── (a)+(d) 결정론 감소 + 게이트 오라클: budgetFn으로 잔여를 산출하며 데드볼 연속 교체.
//    correct(selIvBudget)면 매 수락마다 −1이고 subLeft>=2 ⇔ 엔진 수락. 반환: 검사 통과 여부. ──
function runDecrementGate(s: Scenario, pairs: Array<{ outId: string; inId: string }>, budgetFn: (sim: SimResult, cur: IvCoord, dir: MatchIntervention[]) => number): { ok: boolean; appliedCount: number } {
  let directives: MatchIntervention[] = [];
  let sim = s.base;
  let appliedCount = 0;
  let ok = true;
  for (const { outId, inId } of pairs) {
    const before = budgetFn(sim, s.cur, directives);
    const iv: MatchIntervention = { at: { setNo: s.cur.setNo, h: s.cur.h, a: s.cur.a }, side: 'home', kind: 'sub', outId, inId, subKind: 'manual' };
    const trySim = simulateMatch(s.seed, s.H, s.A, { ...s.opts, interventions: [...directives, iv] });
    const didApply = applied(trySim, s.cur.ptIdx, 'manual', inId);
    // 게이트 오라클: 구조상 유효한 쌍이므로 (before>=2) ⇔ didApply 이어야 함
    if ((before >= 2) !== didApply) { ok = false; break; }
    if (!didApply) break; // 예산 소진(정상 종료) — 여기서 게이트 일치 확인 끝
    directives = [...directives, iv]; sim = trySim; appliedCount++;
    const after = budgetFn(sim, s.cur, directives);
    if (after !== before - 1) { ok = false; break; } // −1 감소(스테일 아님)
  }
  return { ok, appliedCount };
}

const correctFn = (sim: SimResult, cur: IvCoord, dir: MatchIntervention[]) => selIvBudget(sim, 'home', cur, dir).subLeft;
const buggyFn = (sim: SimResult, cur: IvCoord, _dir: MatchIntervention[]) => buggySubLeft(sim, 'home', cur);

// ── 메인 배터리 (manualSide='home' 격리 + 기본 감독자동 혼재) ──
let scDecrement = 0, scMultiSub = 0, abBuggyDetected = 0, abTotal = 0;
let regressionChecked = 0;

for (let i = 0; i < 220; i++) {
  const s = buildScenario(i, 'home'); // 격리(자동 교체 off) — 유저 개입 예산 회계 순수 검증
  if (!s) continue;
  const pairs = basePairs(s);

  // (a)+(d) correct
  const cor = runDecrementGate(s, pairs, correctFn);
  check(cor.ok, `[a/d] seed=${s.seed} 결정론 감소/게이트 오라클 실패`);
  if (cor.appliedCount >= 1) scDecrement++;
  if (cor.appliedCount >= 2) scMultiSub++;

  // A/B 민감도: 같은 시나리오에서 buggyFn은 반드시 실패해야(감소 안 함) — 2건 이상 교체 가능할 때만 판정
  if (cor.appliedCount >= 2) {
    abTotal++;
    const bug = runDecrementGate(s, pairs, buggyFn);
    if (!bug.ok) abBuggyDetected++;
  }

  // (b) 이중 카운트 없음 — 커밋 후 ptIdx를 그 세트 뒤 점수로 진행하면 pending→prefix 이동, 합계 불변
  if (cor.appliedCount >= 2) {
    // 커밋된 개입으로 재시뮬(적용된 만큼)
    let directives: MatchIntervention[] = []; let sim = s.base;
    for (let k = 0; k < cor.appliedCount; k++) {
      const pr = pairs[k];
      const iv: MatchIntervention = { at: { setNo: s.cur.setNo, h: s.cur.h, a: s.cur.a }, side: 'home', kind: 'sub', outId: pr.outId, inId: pr.inId, subKind: 'manual' };
      sim = simulateMatch(s.seed, s.H, s.A, { ...s.opts, interventions: [...directives, iv] });
      directives = [...directives, iv];
    }
    const usedAtCoord = SUBS - selIvBudget(sim, 'home', s.cur, directives).subLeft;
    // 같은 세트에서 더 뒤 점수 좌표(재생 진행)로 이동 — 개입 subEvent(point=cur.ptIdx+1)이 prefix로 들어가야 함
    const laterPt = sim.points.findIndex((p, idx) => p.setNo === 1 && idx > s.cur.ptIdx);
    if (laterPt > s.cur.ptIdx) {
      const later: IvCoord = { setNo: 1, h: sim.points[laterPt].home, a: sim.points[laterPt].away, ptIdx: laterPt };
      const usedLater = SUBS - selIvBudget(sim, 'home', later, directives).subLeft;
      check(usedLater === usedAtCoord, `[b] seed=${s.seed} 이중 카운트/소실: at=${usedAtCoord} later=${usedLater}`);
    }

    // (c) 후보 즉시 제외 = 엔진 실제 거절(A/B 오라클): 방금 나간 선수 X는 benchCands에서 빠지고 재투입 시 엔진 no-op,
    //     방금 투입 B는 outCands에서 빠지고 재교체 시 엔진 no-op.
    const cur = s.cur;
    const ex = ivExclusions(sim, 'home', cur, directives);
    const court = courtOf(s, sim);
    const bench = benchCandidates(s.H, court, s.byId, null, ex);
    const outC = outCandidates(court, ex);
    // 커밋된 첫 쌍
    const firstOut = directives[0].outId!, firstIn = directives[0].inId!;
    check(!bench.some((p) => p.id === firstOut), `[c] seed=${s.seed} 나간 선발 ${firstOut}가 benchCands에 잔존`);
    check(!outC.some((p) => p.id === firstIn), `[c] seed=${s.seed} 투입 선수 ${firstIn}가 outCands에 잔존`);
    // 엔진 오라클: 나간 선발 X를 다른 슬롯에 재투입 시도 → 반드시 거절(FIVB 재진입 금지)
    const someSlotOut = court.find((p) => p.position === (s.byId.get(firstOut)?.position) && p.id !== firstIn);
    if (someSlotOut) {
      const reenter: MatchIntervention = { at: { setNo: cur.setNo, h: cur.h, a: cur.a }, side: 'home', kind: 'sub', outId: someSlotOut.id, inId: firstOut, subKind: 'manual' };
      const reSim = simulateMatch(s.seed, s.H, s.A, { ...s.opts, interventions: [...directives, reenter] });
      check(!applied(reSim, cur.ptIdx, 'manual', firstOut), `[c-oracle] seed=${s.seed} 나간 선발 재진입이 엔진에서 수락됨(가드 배제와 불일치)`);
    }
    // 엔진 오라클: 투입 B를 코트에서 다시 빼기 시도(다른 벤치로) → 활성 슬롯이라 거절
    const usedInIds = new Set(directives.map((d) => d.inId));
    const benchForB = s.H.find((p) => p.position === (s.byId.get(firstIn)?.position) && !court.some((c) => c.id === p.id) && !usedInIds.has(p.id));
    if (benchForB) {
      const resub: MatchIntervention = { at: { setNo: cur.setNo, h: cur.h, a: cur.a }, side: 'home', kind: 'sub', outId: firstIn, inId: benchForB.id, subKind: 'manual' };
      const reSim = simulateMatch(s.seed, s.H, s.A, { ...s.opts, interventions: [...directives, resub] });
      check(!applied(reSim, cur.ptIdx, 'manual', benchForB.id), `[c-oracle] seed=${s.seed} 활성 교체 선수 재교체가 엔진에서 수락됨`);
    }
  }
}

// (e) 무회귀 — 개입 없는 감독 자동 경기에서 selIvBudget == 구 산식(pending=0이라 바이트 동일). 여러 데드볼 대조.
for (let i = 300; i < 420; i++) {
  const s = buildScenario(i); // manualSide 없음(감독 자동)
  if (!s) continue;
  for (const p of s.base.points) {
    if (p.setNo > 2) break;
    const idx = s.base.points.findIndex((q) => q.setNo === p.setNo && q.home === p.home && q.away === p.away);
    const cur: IvCoord = { setNo: p.setNo, h: p.home, a: p.away, ptIdx: idx };
    for (const side of ['home', 'away'] as Side[]) {
      const sel = selIvBudget(s.base, side, cur, []).subLeft;
      const old = buggySubLeft(s.base, side, cur);
      check(sel === old, `[e] seed=${s.seed} ${side} ${p.setNo}세트 ${p.home}:${p.away} 무회귀 불일치 sel=${sel} old=${old}`);
      regressionChecked++;
    }
  }
}

// ── 타임아웃: 유저 타임아웃은 point=ptIdx라 pending 불필요 — 커밋 후 toLeft 감소 + 이중 카운트 없음 검증 ──
let toChecked = 0;
for (let i = 500; i < 560; i++) {
  const s = buildScenario(i, 'home');
  if (!s) continue;
  const before = selIvBudget(s.base, 'home', s.cur, []).toLeft;
  const iv: MatchIntervention = { at: { setNo: s.cur.setNo, h: s.cur.h, a: s.cur.a }, side: 'home', kind: 'timeout' };
  const sim = simulateMatch(s.seed, s.H, s.A, { ...s.opts, interventions: [iv] });
  const to = (sim.timeouts ?? []).some((t) => t.side === 'home' && t.setNo === s.cur.setNo && t.home === s.cur.h && t.away === s.cur.a && !t.technical);
  if (!to) continue; // 세트 타임아웃 한도 소진 등 — 스킵
  const after = selIvBudget(sim, 'home', s.cur, [iv]).toLeft;
  check(after === before - 1, `[to] seed=${s.seed} 타임아웃 후 toLeft 미감소 before=${before} after=${after}`);
  toChecked++;
}

console.log(`scenarios: decrement=${scDecrement} multiSub=${scMultiSub} regressionChecks=${regressionChecked} toChecks=${toChecked}`);
console.log(`A/B sensitivity: buggy-detected ${abBuggyDetected}/${abTotal} (버그 재주입 시 감소 검사 실패 = 오라클 민감)`);

if (scMultiSub < 10) { console.log(`FAIL: 다중 교체 시나리오 부족(${scMultiSub}) — 표본 무효(허위 통과 방지)`); process.exit(1); }
if (abTotal < 5 || abBuggyDetected !== abTotal) { console.log(`FAIL: A/B 민감도 미달 — buggy가 ${abBuggyDetected}/${abTotal}만 검출(전건 검출이어야)`); process.exit(1); }
if (toChecked < 5) { console.log(`FAIL: 타임아웃 검사 표본 부족(${toChecked})`); process.exit(1); }
if (fail) { console.log(`FAIL ${fail}건:`); for (const m of failMsgs.slice(0, 20)) console.log('  ' + m); process.exit(1); }
console.log(`PASS — 결정론 감소·게이트 오라클·이중카운트·후보배제(엔진 오라클)·무회귀·타임아웃 전건 정상, A/B 민감도 ${abBuggyDetected}/${abTotal}`);
