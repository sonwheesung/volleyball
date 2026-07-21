// FIVB 세트당 교체 ≤6 오라클 가드 (감사A P0) — 엔진 subIn 예산 예약 회계 봉인.
//   npx tsx tools/_dv_setsubs.ts [aiN=1800] [injN=3000]
// 버그(수정 전): subIn 게이트 `subBudget<2`가 이 IN의 복원분 1건만 예약 → 복원형(pinch/block/def) 2+ 활성 창에
//   (개입) 수동 IN이 끼면 이후 자동 복원 OUT(무조건 −1)들이 예산을 음수로 몰아 세트 7교체(FIVB 15.2.1 위반).
// 오라클: consumed(예산 소비) = subIn(비injury) + **미드셋** subOut. 미드셋 판별 = points[e.point]?.setNo === e.setNo
//   (복원 루프는 랠리 직전 top에서 호출 → 같은 세트 랠리가 그 인덱스에 push됨 / 세트말 원복은 다음 세트 인덱스라 구별). consumed≤6.
// A/B 민감도: 게이트 수정을 되돌리면(구 `<2`) 아래 [inject] 배터리(복원형 2+ 활성 좌표에 수동 IN 2개 주입)가 consumed=7을
//   내 FAIL한다(감사A 실측 재현 — cp 백업 복원으로 실증). hotPts>0가 위험창을 실제로 구동함을 보장(허위 초록 방지).
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { LEAGUE, getEvolvedTeamPlayers, coachInfoOf, resetLeagueBase } from '../data/league';
import type { MatchIntervention, SimResult } from '../engine/simMatch';
import type { Side } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();
const teams = LEAGUE.teams;

function consumedPerSet(sim: SimResult): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of sim.subEvents ?? []) {
    if (e.kind === 'injury') continue;
    const key = `${e.setNo}:${e.side}`;
    if (e.enter) m.set(key, (m.get(key) ?? 0) + 1);
    else if (sim.points[e.point]?.setNo === e.setNo) m.set(key, (m.get(key) ?? 0) + 1); // 미드셋 subOut만
  }
  return m;
}
function activeRestorableAt(sim: SimResult, side: Side, ptIdx: number): Set<number> {
  const active = new Set<number>();
  for (const e of sim.subEvents ?? []) {
    if (e.side !== side) continue;
    if (e.point > ptIdx) break; // 오름차순
    if (e.kind === 'pinch' || e.kind === 'block' || e.kind === 'def') { if (e.enter) active.add(e.slot); else active.delete(e.slot); }
  }
  return active;
}

const AI_N = Math.max(500, Number(process.argv[2]) || 1800);
const INJ_N = Math.max(1000, Number(process.argv[3]) || 3000);

// ── (1) AI-only 바닥 — 무개입 경기는 어떤 세트도 6 초과 금지 ──
let aiMax = 0, aiViol = 0, aiSets = 0;
let seed = 100000;
for (let i = 0; i < AI_N; i++) {
  const hi = teams[i % teams.length].id, ai = teams[(i * 3 + 1) % teams.length].id;
  if (hi === ai) continue;
  seed += 13;
  const H = getEvolvedTeamPlayers(hi, 0), A = getEvolvedTeamPlayers(ai, 0);
  const sim = simulateMatch(seed, H, A, { home: coachInfoOf(hi), away: coachInfoOf(ai) });
  for (const [, c] of consumedPerSet(sim)) { aiSets++; if (c > aiMax) aiMax = c; if (c > 6) aiViol++; }
}

// ── (2) 개입 겹침창 — 복원형 2+ 활성 좌표에 수동 IN 2개 주입(감사A 재현 시나리오) ──
let injMax = 0, injViol = 0, hotPts = 0, injScenarios = 0;
const repros: string[] = [];
seed = 700000;
for (let i = 0; i < INJ_N; i++) {
  const hi = teams[i % teams.length].id, ai = teams[(i * 7 + 3) % teams.length].id;
  if (hi === ai) continue;
  seed += 13;
  const H = getEvolvedTeamPlayers(hi, 0), A = getEvolvedTeamPlayers(ai, 0);
  const opts = { home: coachInfoOf(hi), away: coachInfoOf(ai) };
  const base = simulateMatch(seed, H, A, opts);
  const baseSix = buildLineup(H, coachInfoOf(hi)?.dvPhilosophy ?? 0).six;
  for (let idx = 0; idx < base.points.length; idx++) {
    const act = activeRestorableAt(base, 'home', idx);
    if (act.size < 2) continue;
    hotPts++;
    const p = base.points[idx];
    const onCourt = new Set(baseSix.map((q) => q.id));
    const victims = baseSix.filter((q, s) => q.position !== 'S' && q.position !== 'L' && !act.has(s));
    const ivs: MatchIntervention[] = [];
    const takenIn = new Set<string>();
    for (const v of victims) {
      const b = H.find((q) => q.position === v.position && !onCourt.has(q.id) && !takenIn.has(q.id));
      if (b) { ivs.push({ at: { setNo: p.setNo, h: p.home, a: p.away }, side: 'home', kind: 'sub', outId: v.id, inId: b.id, subKind: 'manual' }); takenIn.add(b.id); }
      if (ivs.length >= 2) break;
    }
    if (!ivs.length) continue;
    injScenarios++;
    const sim = simulateMatch(seed, H, A, { ...opts, interventions: ivs });
    const c = consumedPerSet(sim).get(`${p.setNo}:home`) ?? 0;
    if (c > injMax) injMax = c;
    if (c > 6) { injViol++; if (repros.length < 6) repros.push(`seed=${seed} set=${p.setNo} coord=${p.home}:${p.away} activeRest=${act.size} consumed=${c}`); }
    break; // 경기당 첫 hot 좌표만
  }
}

log(`[AI-only] sets=${aiSets} maxConsumed=${aiMax} violations(>6)=${aiViol}`);
log(`[inject]  scenarios=${injScenarios} hotPts=${hotPts} maxConsumed=${injMax} violations(>6)=${injViol}`);
for (const r of repros) log('  VIOL ' + r);

log('\n검증:');
const assert = (c: boolean, label: string, detail = '') => log(`  ${c ? 'PASS' : 'FAIL ❌'} — ${label}${detail}`);
assert(aiViol === 0, 'AI-only: 모든 세트 교체 ≤6', aiViol ? ` (위반 ${aiViol}·max ${aiMax})` : ` (max ${aiMax})`);
assert(injViol === 0, '개입 겹침창: 모든 세트 교체 ≤6(예산 예약 봉인)', injViol ? ` (위반 ${injViol}·max ${injMax})` : ` (max ${injMax})`);
assert(hotPts >= 50, '위험창(복원형 2+ 활성) 실제 구동 — A/B 비-공허(되돌리면 FAIL)', ` (hotPts ${hotPts})`);
assert(injScenarios >= 30, '개입 시나리오 표본 충분', ` (${injScenarios})`);

const pass = aiViol === 0 && injViol === 0 && hotPts >= 50 && injScenarios >= 30;
log(pass ? '\nPASS — 세트당 교체 ≤6 봉인(AI·개입 전건), 위험창 구동으로 A/B 민감.' : '\nFAIL');
process.exit(pass ? 0 : 1);
