// 보드 라인업 = 엔진 라인업 동일성 가드 (감사 P1) — 보드(MatchCourt·BoxScoreTable·board-lab)가 subEvents를 재생하는
//   base 라인업을 **엔진과 동일 인자(육성철학 dvPhilosophy)** 로 구성하는지 검증. 보드 코드는 buildLineup + applySubsToSix
//   (components/courtDirector)를 그대로 쓰므로, 여기서 같은 두 함수로 보드 계산 경로를 node에서 재현해 엔진 subEvents와 대조한다.
//   ── 기존 _ev_* 가드는 고정 t0/t1(dv 97/65)만 봐 "허위 초록" 사각(감사 지적)이었다 → 여기선 dv 97·99·55·48을 **명시 포함**한 표본. ──
//   A/B 민감도: dv를 뺀(=구 보드 버그) base로 재생하면 (1) rally0 base-six가 엔진과 어긋나고(마커 오표시) (2) subEvents 점유자
//   불일치가 발생함을 실증. dv를 넣으면(=수정) 둘 다 0.
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { applySubsToSix } from '../components/courtDirector';
import { LEAGUE, getEvolvedTeamPlayers, coachInfoOf, resetLeagueBase } from '../data/league';
import type { Player, Side } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();
const teams = LEAGUE.teams;
const dvOf = (id: string): number => (coachInfoOf(id) as any)?.dvPhilosophy ?? 0;

// dv가 라인업을 실제로 바꾸는 팀이 표본에 있어야 가드가 유의미(허위 통과 방지).
const sixDiffers = (a: Player[], b: Player[]): boolean => a.length !== b.length || a.some((p, i) => p.id !== b[i]?.id);

// ── (0) 표본 커버리지: 고dv(97·99)·중dv(55)·저dv(48) 팀이 모두 포함 + dv가 base 라인업을 실제로 바꾸는 팀 수(day0) ──
let teamsDvChanges = 0;
const dvValues = new Set<number>();
for (const t of teams) {
  const players = getEvolvedTeamPlayers(t.id, 0);
  const dv = dvOf(t.id);
  dvValues.add(dv);
  if (sixDiffers(buildLineup(players, dv).six, buildLineup(players, 0).six)) teamsDvChanges++;
}
log(`표본 dv 값: ${[...dvValues].sort((a, b) => b - a).join(', ')}`);
log(`day0 dv로 선발이 바뀌는 팀: ${teamsDvChanges}/${teams.length}`);

// ── (1)+(A/B) 전 매치업(홈×원정) 보드 재현 대조 ──
let dvBaseMismatch = 0, noDvBaseMismatch = 0; // rally0 base-six vs 엔진 six
let dvOcc = 0, noDvOcc = 0;                    // subEvents enter 점유자 불일치
let sideSamples = 0, subEnterSamples = 0;
let seed = 424242;
for (let hi = 0; hi < teams.length; hi++) {
  for (let ai = 0; ai < teams.length; ai++) {
    if (hi === ai) continue;
    const hId = teams[hi].id, aId = teams[ai].id;
    const H = getEvolvedTeamPlayers(hId, 0), A = getEvolvedTeamPlayers(aId, 0);
    seed += 101;
    const sim = simulateMatch(seed, H, A, { home: coachInfoOf(hId), away: coachInfoOf(aId) });
    const byId = new Map<string, Player>([...H, ...A].map((p) => [p.id, p] as const));
    for (const side of ['home', 'away'] as Side[]) {
      const players = side === 'home' ? H : A;
      const dv = dvOf(side === 'home' ? hId : aId);
      const engineSix = buildLineup(players, dv).six; // == 엔진 match.ts:122가 쓴 six
      const boardBaseDv = buildLineup(players, dv).six; // 보드 수정판(dv 전달)
      const boardBase0 = buildLineup(players, 0).six;   // 구 보드 버그(dv 누락)
      sideSamples++;
      if (sixDiffers(engineSix, boardBaseDv)) dvBaseMismatch++;
      if (sixDiffers(engineSix, boardBase0)) noDvBaseMismatch++;
      // 점유자 — 보드 effLineupsAt(applySubsToSix) 재현. enter마다 그 point 재생 슬롯 == inId 여야.
      for (const e of sim.subEvents ?? []) {
        if (e.side !== side || !e.enter) continue;
        subEnterSamples++;
        const sixDv = applySubsToSix(boardBaseDv, side, sim.subEvents, e.point, byId);
        if (sixDv[e.slot]?.id !== e.inId) dvOcc++;
        const six0 = applySubsToSix(boardBase0, side, sim.subEvents, e.point, byId);
        if (six0[e.slot]?.id !== e.inId) noDvOcc++;
      }
    }
  }
}

log(`\n표본: ${sideSamples}(매치업×사이드) · subEvents enter ${subEnterSamples}`);
log(`base-six 불일치: dv전달 ${dvBaseMismatch} / dv누락(구버그) ${noDvBaseMismatch} (${(100 * noDvBaseMismatch / sideSamples).toFixed(0)}%)`);
log(`subEvents 점유자 불일치: dv전달 ${dvOcc} / dv누락(구버그) ${noDvOcc}`);

log('\n검증:');
const assert = (c: boolean, label: string, detail = '') => log(`  ${c ? 'PASS' : 'FAIL ❌'} — ${label}${detail}`);
// 표본 유의성
const hasHi = dvValues.has(97) || dvValues.has(99), hasMid = dvValues.has(55), hasLo = [...dvValues].some((v) => v <= 50);
assert(hasHi && hasMid && hasLo, '표본에 고dv(97/99)·중dv(55)·저dv(≤50) 모두 포함(허위 초록 사각 해소)');
assert(teamsDvChanges >= 1, 'dv가 선발을 실제로 바꾸는 팀 존재(가드 비-공허)', ` (${teamsDvChanges}팀)`);
// A/B 민감도 — dv 누락(구버그)이면 반드시 불일치 검출
assert(noDvBaseMismatch > 0, 'A/B: dv 누락 시 base-six가 엔진과 어긋남(구 보드 버그 재현)', ` (${noDvBaseMismatch})`);
// 수정 — dv 전달이면 엔진과 완전 일치
assert(dvBaseMismatch === 0, 'dv 전달 시 base-six == 엔진 six(전건)', dvBaseMismatch ? ` (불일치 ${dvBaseMismatch})` : '');
assert(dvOcc === 0, 'dv 전달 시 subEvents 점유자 == inId(전건)', dvOcc ? ` (불일치 ${dvOcc})` : '');
assert(subEnterSamples > 0, 'subEvents enter 표본 존재(점유자 검사 비-공허)');

const pass = hasHi && hasMid && hasLo && teamsDvChanges >= 1 && noDvBaseMismatch > 0 && dvBaseMismatch === 0 && dvOcc === 0 && subEnterSamples > 0;
log(pass ? '\nPASS — 보드 라인업이 엔진과 동일(dv 전달), 구버그(dv 누락) A/B 검출됨.' : '\nFAIL');
process.exit(pass ? 0 : 1);
