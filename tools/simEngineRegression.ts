// 경기 엔진 회귀 하네스 — 계수 하나 바꿔도 밸런스가 깨지는지 즉시 본다(A/B 기준).
//   자체완결·결정론(합성 팀, 스토어 무관). 같은 인자 = 같은 숫자 → before/after diff가 곧 변화량.
//   출력 2블록: ① KOVO 분포 비율(공격성공·에이스·스터프·범실·랠리길이) ② ΔdisplayOVR→승률 곡선.
//   사용: npx tsx tools/simEngineRegression.ts [pairs=1200] [matchesPerPair=40]
//   A/B:  변경 전 실행→저장, 변경 후 실행→두 출력 비교(비율·곡선이 유지되면 안전).
import { makePlayer } from '../data/seed';
import { createRng } from '../engine/rng';
import { simulateMatch } from '../engine/match';
import { teamOverallRaw, displayOvr } from '../engine/overall';
import { deriveRatings } from '../engine/ratings';
import { newRallyStats } from '../engine/rally';
import type { Player, Position } from '../types';

const ROSTER: Position[] = ['S', 'S', 'OH', 'OH', 'OH', 'OP', 'OP', 'MB', 'MB', 'MB', 'L', 'L', 'S', 'OH', 'MB'];
const roster = (rng: any, tag: string, bias: number): Player[] =>
  ROSTER.map((pos, i) => makePlayer(rng, `${tag}_${i}`, pos, false, undefined, bias, [22, 30]));
const teamRecv = (ps: Player[]) => { const r = ps.filter((p) => p.position === 'L' || p.position === 'OH').map((p) => deriveRatings(p).receive); return r.reduce((a, b) => a + b, 0) / Math.max(1, r.length); };
const teamSpk = (ps: Player[]) => { const r = ps.filter((p) => p.position === 'OH' || p.position === 'OP' || p.position === 'MB').map((p) => deriveRatings(p).spike); return r.reduce((a, b) => a + b, 0) / Math.max(1, r.length); };

const PAIRS = Number(process.argv[2]) || 1200;
const K = Number(process.argv[3]) || 40;
const gen = createRng(20260701); // 고정 시드 — A/B 결정론
const S = newRallyStats();        // 전 경기 누적(비율 분포)
let totalSets = 0, totalMatches = 0;

const ovrBins: Record<string, { w: number; n: number }> = {};
const binOf = (d: number) => { const a = Math.abs(d); return a < 1 ? '0-1' : a < 3 ? '1-3' : a < 5 ? '3-5' : a < 7 ? '5-7' : a < 9 ? '7-9' : a < 11 ? '9-11' : a < 13 ? '11-13' : a < 16 ? '13-16' : '16+'; };
const eqRecv: Record<string, { w: number; n: number }> = {}; const eqSpk: Record<string, { w: number; n: number }> = {};
const rbin = (d: number) => { const a = Math.abs(d); return a < 2 ? '0-2' : a < 5 ? '2-5' : a < 9 ? '5-9' : '9+'; };

for (let p = 0; p < PAIRS; p++) {
  const bA = gen.range(-9, 9), bB = gen.range(-9, 9);
  const A = roster(gen, `A${p}`, bA), B = roster(gen, `B${p}`, bB);
  const dOvr = displayOvr(teamOverallRaw(B)) - displayOvr(teamOverallRaw(A));
  const dRecv = teamRecv(B) - teamRecv(A), dSpk = teamSpk(B) - teamSpk(A);
  let bWins = 0;
  for (let k = 0; k < K; k++) {
    const r = simulateMatch((p * 1000 + k) >>> 0, A, B, { stats: S }); // 누적 통계 싱크(승패 무관)
    if (r.awaySets > r.homeSets) bWins++;
    totalSets += r.homeSets + r.awaySets; totalMatches++;
  }
  const hi = dOvr >= 0 ? bWins / K : 1 - bWins / K;
  const kb = binOf(dOvr); (ovrBins[kb] ??= { w: 0, n: 0 }); ovrBins[kb].w += hi; ovrBins[kb].n++;
  if (Math.abs(dOvr) < 1.5) {
    const rb = rbin(dRecv); (eqRecv[rb] ??= { w: 0, n: 0 }); eqRecv[rb].w += dRecv >= 0 ? bWins / K : 1 - bWins / K; eqRecv[rb].n++;
    const sb = rbin(dSpk); (eqSpk[sb] ??= { w: 0, n: 0 }); eqSpk[sb].w += dSpk >= 0 ? bWins / K : 1 - bWins / K; eqSpk[sb].n++;
  }
}

const pc = (x: number, d: number) => (d ? (100 * x / d).toFixed(2) : '0') + '%';
console.log(`═══ 경기 엔진 회귀 — ${totalMatches}경기 / ${totalSets}세트 (합성 팀, 결정론 시드) ═══`);
console.log(`  ※ 합성 팀 기준(리그 팀 아님) — 절대값은 simKovo와 다름이 정상. A/B용: SKILL.md 베이스라인과 diff.`);
console.log(`\n[① 분포 비율 — 스케일 무관. 계수 변경 시 여기가 움직인다(before/after diff)]`);
console.log(`  공격성공률(kill/att)     ${pc(S.kills, S.attacks).padStart(7)}`);
console.log(`  블록아웃률(/att)         ${pc(S.blockouts, S.attacks).padStart(7)}`);
console.log(`  스터프률(stuff/att)      ${pc(S.stuffs, S.attacks).padStart(7)}`);
console.log(`  공격범실률(/att)         ${pc(S.attackErrs, S.attacks).padStart(7)}`);
console.log(`  에이스율(ace/serve)      ${pc(S.aces, S.serves).padStart(7)}`);
console.log(`  서브범실률(/serve)       ${pc(S.serveErrs, S.serves).padStart(7)}`);
console.log(`  리시브범실률(/serve)     ${pc(S.recvErrs, S.serves).padStart(7)}`);
console.log(`  디그율(dig/att)          ${pc(S.digs, S.attacks).padStart(7)}`);
console.log(`  평균 랠리 hop(att/rally)  ${(S.attacks / S.rallies).toFixed(3).padStart(6)}`);

console.log(`\n[② ΔdisplayOVR → 상위팀 승률 — parity(OVR 체감) 곡선]`);
for (const k of ['0-1', '1-3', '3-5', '5-7', '7-9', '9-11', '11-13', '13-16', '16+']) if (ovrBins[k]) console.log(`  Δ${k.padEnd(6)} ${(100 * ovrBins[k].w / ovrBins[k].n).toFixed(1).padStart(5)}%  (n=${ovrBins[k].n})`);
console.log(`\n[③ 동률팀(|ΔOVR|<1.5) 단일축 우위 승률 — q 지배 여부(리시브 vs 공격 대칭이어야)]`);
for (const k of ['0-2', '2-5', '5-9', '9+']) if (eqRecv[k]) console.log(`  Δrecv ${k.padEnd(4)} ${(100 * eqRecv[k].w / eqRecv[k].n).toFixed(1).padStart(5)}%  |  Δspk ${k.padEnd(4)} ${eqSpk[k] ? (100 * eqSpk[k].w / eqSpk[k].n).toFixed(1) : '—'}%`);
