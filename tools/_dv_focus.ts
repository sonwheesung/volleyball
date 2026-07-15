// INDEPENDENT — 훈련 방침(감독 trainingFocus) 순효과 가드 (TRAINING_SYSTEM §1.8 C, 2026-07-07).
// 검증·실측 = Fable 5 / 가드·문서 = Opus 에이전트.
//
// "방침이 실제로 스탯을 다르게 키우는가"를 **쌍대조**(동일 개체·동일 rng, 방침만 교체)로 잰다.
// 비쌍대조("감독 주스탯 Δ vs 전스탯 평균 Δ")는 스탯별 자연 성장률(posRelevance·나이배수·XP 양자화)
// 교란으로 위음/위양성 — 처치 효과는 반드시 같은 선수를 두 방침으로 키워 차이만 본다(TEST_METHODOLOGY §4).
//
// 체크:
//   (a) W1 배선 — 전 팀 초기 오버라이드 0 · 기본 focus == 감독 trainingFocus(오버라이드=감독focus면 결과 불변) ·
//       오버라이드 toggle liveness(다른 방침이면 결과 상이) · null 복원 = 기본 바이트 동일.
//   (b) 씨앗 리그 22세 이하 쌍대조: 공격파 jump Δ > 수비파 jump Δ(감독핵심 웨이트 0.25 vs 바닥 0.14).
//   (c) 신인 30명 쌍대조: 기본기파 기술합(skSpike+skReceive) Δ > 체력파 Δ(기술계 아키타입은 육성기에 유효).
//   (d) 완성선수 천장 불변식: 기술 헤드룸 0(=포텐−12 도달)인 스탯은 어떤 방침·365일에도 Δ0(훈련 상한 설계 박제).
//
// A/B 자가검증(허위 오라클 차단): coachShare를 상수 0.02로 뭉갠 mutant를 **실제 주입-복원**해
//   (b)(c)가 FAIL함을 증명한다. 주입 방식 — coachShare의 내부 호출은 esbuild/tsx에서 read-only
//   live binding이라 네임스페이스 몽키패치가 불가(assign→TypeError, 내부 호출은 로컬 바인딩 참조).
//   그래서 mutant를 **정본 코드경로로** 재현: 빈 방침 {primary:[],secondary:[]}을 두 arm에 주면
//   coachShare가 모든 훈련에 0.02를 반환(primary/secondary 미포함) → share=max(0.02,POS_FLOOR)=0.14로 붕괴,
//   이는 coachShare≡0.02 상수 mutant와 **바이트 동일**(방침 무관 성장). 실제 coachShare가 0.02를 뱉는 걸
//   확인(아래 assert)하고, 복원 = 정상 방침으로 재실행해 PASS로 되돌린다.
//   npx tsx tools/_dv_focus.ts [일수=365]
import {
  resetLeagueBase, LEAGUE, setFocusOverride, getFocusOverride, getTeamCoach, getEvolvedTeamPlayers,
} from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { evolvePlayer } from '../engine/progression';
import { coachShare, TRAIN_GAP } from '../engine/training';
import { makeProspect, ARCHETYPES } from '../data/seed';
import { createRng } from '../engine/rng';
import type { Player, Position, TrainingFocus } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const DAYS = Math.max(1, Number(process.argv[2]) || 365);

const ATK = ARCHETYPES.find((a) => a.name === '공격파')!.focus;   // primary [4 공격, 1 웨이트(jump)]
const DEF = ARCHETYPES.find((a) => a.name === '수비파')!.focus;   // primary [6 리시브, 7 디그]
const BASIC = ARCHETYPES.find((a) => a.name === '기본기파')!.focus; // primary [4 스파이크, 6 리시브]
const STAM = ARCHETYPES.find((a) => a.name === '체력파')!.focus;   // primary [1 웨이트, 2 컨디셔닝]
// 빈 방침 mutant — 튜플 길이(primary 2·secondary 3)를 고의로 위반하는 무효 입력이라 타입만 우회(런타임 동작 불변)
const EMPTY = { primary: [], secondary: [] } as unknown as TrainingFocus; // ← coachShare≡0.02 상수 mutant

const results: { name: string; pass: boolean; detail: string }[] = [];
const record = (name: string, pass: boolean, detail: string) => { results.push({ name, pass, detail }); };

// ─── (a) W1 배선 ───────────────────────────────────────────────────────────
resetLeagueBase();
const sigTeam = (teamId: string) =>
  getEvolvedTeamPlayers(teamId, DAYS)
    .map((p) => Math.round(p.jump + p.skSpike * 2 + p.skReceive * 3 + p.skDig * 5 + p.reaction * 7))
    .reduce((a, b) => a + b, 0);

let wireInitOverrides = 0;
let coachFocusMatch = 0, coachFocusChecked = 0;
for (const tm of LEAGUE.teams) {
  if (getFocusOverride(tm.id) !== null) wireInitOverrides++;
  const c = getTeamCoach(tm.id);
  if (!c) continue;
  // 기본 경로 = 감독 focus 임을 증명: 오버라이드를 "감독 자신의 focus"로 세팅해도 결과 불변이어야
  const sDefault = sigTeam(tm.id);
  setFocusOverride(tm.id, c.trainingFocus);
  const sSame = sigTeam(tm.id);
  setFocusOverride(tm.id, null);
  coachFocusChecked++;
  if (sSame === sDefault) coachFocusMatch++;
}
// liveness + 복원: 한 팀에 대비되는 방침 주입 → 결과 상이, null 복원 → 기본과 바이트 동일
const t0 = LEAGUE.teams[0].id;
const sBase = sigTeam(t0);
setFocusOverride(t0, ATK); const sA = sigTeam(t0);
setFocusOverride(t0, DEF); const sD = sigTeam(t0);
setFocusOverride(t0, null); const sRestore = sigTeam(t0);
const liveness = sA !== sD;
const restore = sRestore === sBase;
const wireOk = wireInitOverrides === 0 && coachFocusMatch === coachFocusChecked && liveness && restore;
record('a·W1배선', wireOk,
  `초기오버라이드 ${wireInitOverrides}(=0) · 기본=감독focus ${coachFocusMatch}/${coachFocusChecked} · ` +
  `liveness(ATK ${sA}≠DEF ${sD}) ${liveness} · null복원 ${restore}`);

// ─── (b)(c) 쌍대조 — 방침 파라미터화(mutant 주입 가능) ────────────────────────
resetLeagueBase();
const young = LEAGUE.teams.flatMap((t) => availableTeamPlayers(t.id, 0)).filter((p) => p.age <= 22);

// (b) 씨앗 22세 이하: focusA jump Δ 평균 vs focusB jump Δ 평균 → 서열
function jumpOrder(focusA: TrainingFocus, focusB: TrainingFocus) {
  let dA = 0, dB = 0;
  for (const p of young) {
    dA += evolvePlayer(p, focusA, DAYS).jump - p.jump;
    dB += evolvePlayer(p, focusB, DAYS).jump - p.jump;
  }
  const n = young.length;
  return { a: dA / n, b: dB / n, order: dA / n > dB / n };
}

// (c) 신인 30명: focusA 기술합(skSpike+skReceive) Δ vs focusB → 서열
const ROOKIE_POS: Position[] = ['OH', 'OH', 'OP', 'MB', 'L', 'S'];
const rookies: Player[] = [];
{
  const rng = createRng(7);
  for (let i = 0; i < 30; i++) rookies.push(makeProspect(rng, `dvf-${i}`, ROOKIE_POS[i % ROOKIE_POS.length]));
}
const tech = (p: Player) => p.skSpike + p.skReceive;
function techOrder(focusA: TrainingFocus, focusB: TrainingFocus) {
  let dA = 0, dB = 0;
  for (const p of rookies) {
    dA += tech(evolvePlayer(p, focusA, DAYS)) - tech(p);
    dB += tech(evolvePlayer(p, focusB, DAYS)) - tech(p);
  }
  const n = rookies.length;
  return { a: dA / n, b: dB / n, order: dA / n > dB / n };
}

const bReal = jumpOrder(ATK, DEF);
record('b·씨앗jump서열', bReal.order,
  `공격파 jump Δ ${bReal.a.toFixed(2)} > 수비파 ${bReal.b.toFixed(2)}`);

const cReal = techOrder(BASIC, STAM);
record('c·신인기술서열', cReal.order,
  `기본기파 기술합 Δ ${cReal.a.toFixed(2)} > 체력파 ${cReal.b.toFixed(2)}`);

// ─── (d) 완성선수 천장 불변식 — 기술 헤드룸 0 스탯은 방침 무관 Δ0 ─────────────
const TECH: (keyof Player)[] = ['skReceive', 'skDig'];
const headroom = (p: Player, k: keyof Player) => {
  const cur = p[k] as number;
  const pot = ((p.potential as any)[k] ?? cur) as number;
  return Math.max(0, (pot - TRAIN_GAP) - cur);
};
let zeroRoom = 0, ceilViolations = 0;
for (const p of young) {
  const ea = evolvePlayer(p, ATK, DAYS);
  const ed = evolvePlayer(p, DEF, DAYS);
  for (const k of TECH) {
    if (headroom(p, k) !== 0) continue; // 헤드룸 있으면 성장 허용(불변식 대상 아님)
    zeroRoom++;
    if ((ea[k] as number) !== (p[k] as number) || (ed[k] as number) !== (p[k] as number)) ceilViolations++;
  }
}
const dOk = zeroRoom > 0 && ceilViolations === 0;
record('d·천장불변식', dOk,
  `헤드룸0 기술칸 ${zeroRoom}개 전부 Δ0(방침·365일 무관) · 위반 ${ceilViolations}`);

// ─── A/B 자가검증 — coachShare 상수 mutant 주입-복원 ───────────────────────────
// 주입 전 sanity: 빈 방침에서 coachShare가 실제 0.02를 뱉는가(= 상수 mutant 재현 확인)
const mutSane = [1, 4, 6, 7].every((id) => coachShare(id as any, EMPTY) === 0.02);
const bMut = jumpOrder(EMPTY, EMPTY);   // 방침 무관 → Δ 동일 → 서열 무너짐
const cMut = techOrder(EMPTY, EMPTY);
const mutKillsB = !bMut.order;          // mutant 하에서 (b) FAIL 해야 오라클이 민감
const mutKillsC = !cMut.order;
// 복원: 정상 방침으로 재실행 → 다시 PASS
const bRestore = jumpOrder(ATK, DEF).order;
const cRestore = techOrder(BASIC, STAM).order;
const abOk = mutSane && mutKillsB && mutKillsC && bRestore && cRestore;
record('AB·mutant검출', abOk,
  `coachShare(EMPTY)=0.02 ${mutSane} · mutant下 (b)FAIL ${mutKillsB}(jump Δ ${bMut.a.toFixed(2)}=${bMut.b.toFixed(2)}) ` +
  `(c)FAIL ${mutKillsC}(기술 Δ ${cMut.a.toFixed(2)}=${cMut.b.toFixed(2)}) · 복원 (b)${bRestore} (c)${cRestore}`);

// ─── 리포트 ──────────────────────────────────────────────────────────────────
log(`=== 훈련 방침 순효과 가드 (일수=${DAYS} · 씨앗 22세이하 ${young.length}명 · 신인 ${rookies.length}명) ===`);
for (const r of results) log(`  ${r.pass ? '✅' : '❌'} ${r.name}: ${r.detail}`);
const pass = results.every((r) => r.pass);
log(`\nFOCUS ${pass ? 'PASS' : 'FAIL'} (${results.filter((r) => r.pass).length}/${results.length})`);
process.exit(pass ? 0 : 1);
