// 리베로 체력 튜닝 상비 가드 (MATCH_SYSTEM §7.1, 2026-07-15 — 검증·실측=Fable 5/구현·문서=Opus)
//
// 배경: 리베로는 공격(1.2)·서브(1.0)·블록(0.4) 같은 큰 소모가 구조적으로 없고(리시브 0.2·디그 0.4만) 체력/체젠
//   스탯이 높은 포지션이라 랠리간 회복이 소모를 거의 항상 이겨 타임아웃 체력이 상시 ~100%였다(실측 L 3세트+ 98.5%·≥99% 55.7%).
//   → rally.ts `LIBERO_DEFENSE_COST`(매 랠리 균일 후위 수비 참여 소모, 양 팀 리베로 대칭)로 리베로만 표적 교정.
//
// 가드(밴드 + A/B):
//   (a) 리베로 3세트+ 평균 ∈ [88,93]% (사용자 합의 밴드)
//   (b) 리베로 전체 최저 < 80% (상시 100% 고정이 아님 — 실제로 지친다)
//   (c) 타 포지션(S/OH/OP/MB) 3세트+ 평균 드리프트 |base−mutant| < 3%p (리베로 표적 — 다른 곡선 불변, ±3%p 여유밴드)
//   (d·A/B) mutant `DV_LIBDEF=0`(=옛 무보정, 소모 상수 0) 하에서 리베로 3세트+ 평균 > 93%(밴드 이탈) —
//           조정 상수가 load-bearing임을 증명(허위 오라클 차단). cp 백업/복원 없이 **env 시임**으로 자식 프로세스 재현.
//
// 사용: npx tsx tools/_dv_liberostam.ts [경기수=500]   (내부에서 자식 1회 spawn → 총 2배 시간)
//       (자식 모드: --child, JSON 출력 — 직접 호출 불필요)
import { LEAGUE, getEvolvedTeamPlayers, coachInfoOf, resetLeagueBase } from '../data/league';
import { simulateMatch } from '../engine/match';
import type { Player } from '../types';
import { execFileSync } from 'node:child_process';

const log = (m: string) => process.stdout.write(m + '\n');
const POS = ['L', 'S', 'OH', 'OP', 'MB'] as const;
type Pos = (typeof POS)[number];
interface Band { n: number; sum: number; lateN: number; lateSum: number; min: number; hi99: number }
type Report = Record<Pos, { avg: number; lateAvg: number; min: number; hi99: number }>;

function measure(N: number): Report {
  resetLeagueBase();
  const ids = LEAGUE.teams.map((t) => t.id);
  const sq: Record<string, Player[]> = {};
  const posOf = new Map<string, string>();
  for (const id of ids) { sq[id] = getEvolvedTeamPlayers(id, 0); for (const p of sq[id]) posOf.set(p.id, p.position); }
  const agg: Record<string, Band> = {};
  const A = (pos: string): Band => (agg[pos] ??= { n: 0, sum: 0, lateN: 0, lateSum: 0, min: 1, hi99: 0 });
  let seed = 550000;
  for (let m = 0; m < N; m++) {
    const hi = ids[m % ids.length], ai = ids[(m * 3 + 1) % ids.length];
    if (hi === ai) continue;
    seed += 17;
    const sim = simulateMatch(seed, sq[hi], sq[ai], { home: coachInfoOf(hi), away: coachInfoOf(ai) });
    for (const t of sim.timeouts ?? []) {
      const late = t.setNo >= 3;
      for (const s of [...t.stamHome, ...t.stamAway]) {
        const a = A(posOf.get(s.id) ?? '?');
        a.n++; a.sum += s.stam; a.min = Math.min(a.min, s.stam);
        if (s.stam >= 0.99) a.hi99++;
        if (late) { a.lateN++; a.lateSum += s.stam; }
      }
    }
  }
  const out = {} as Report;
  for (const pos of POS) {
    const a = agg[pos];
    out[pos] = a
      ? { avg: 100 * a.sum / a.n, lateAvg: a.lateN ? 100 * a.lateSum / a.lateN : 100 * a.sum / a.n, min: 100 * a.min, hi99: 100 * a.hi99 / a.n }
      : { avg: 100, lateAvg: 100, min: 100, hi99: 100 };
  }
  return out;
}

const N = Math.max(1, Number(process.argv.find((x) => /^\d+$/.test(x))) || 500);

// ── 자식 모드: mutant(env DV_LIBDEF=0) 산출만 JSON으로 뱉고 종료 ──
if (process.argv.includes('--child')) {
  process.stdout.write(JSON.stringify(measure(N)));
  process.exit(0);
}

// ── 부모: 베이스라인(프로덕션 0.16, env 미설정) in-process + mutant 자식 spawn ──
if (process.env.DV_LIBDEF != null) { log('⚠ DV_LIBDEF가 부모 env에 설정됨 — 베이스라인이 오염된다. unset 후 재실행.'); process.exit(2); }
const base = measure(N);
const childOut = execFileSync('npx', ['tsx', process.argv[1], '--child', String(N)], {
  env: { ...process.env, DV_LIBDEF: '0' }, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 1 << 20,
});
const mut: Report = JSON.parse(childOut.trim());

log(`리베로 체력 튜닝 가드 — N=${N}경기 (baseline 0.16 vs mutant DV_LIBDEF=0)\n`);
log('포지션 | base 3세트+ | mutant 3세트+ | Δ(%p) | base 최저 | base ≥99%');
for (const pos of POS) {
  log(`${pos.padEnd(3)} | ${base[pos].lateAvg.toFixed(1)}% | ${mut[pos].lateAvg.toFixed(1)}% | ${(base[pos].lateAvg - mut[pos].lateAvg >= 0 ? '+' : '')}${(base[pos].lateAvg - mut[pos].lateAvg).toFixed(1)} | ${base[pos].min.toFixed(1)}% | ${base[pos].hi99.toFixed(1)}%`);
}

let ok = true;
const check = (name: string, pass: boolean, detail: string) => { log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); if (!pass) ok = false; };
log('');
// (a) 리베로 3세트+ 평균 밴드
check('(a) 리베로 3세트+ 평균 ∈ [88,93]%', base.L.lateAvg >= 88 && base.L.lateAvg <= 93, `${base.L.lateAvg.toFixed(1)}%`);
// (b) 리베로 최저 < 80 (지친다)
check('(b) 리베로 전체 최저 < 80%', base.L.min < 80, `${base.L.min.toFixed(1)}%`);
// (c) 타 포지션 드리프트 < 3%p (리베로 표적)
for (const pos of ['S', 'OH', 'OP', 'MB'] as Pos[]) {
  const d = Math.abs(base[pos].lateAvg - mut[pos].lateAvg);
  check(`(c) ${pos} 드리프트 |Δ| < 3%p`, d < 3, `${d.toFixed(2)}%p`);
}
// (d·A/B) mutant 하에서 리베로 밴드 이탈(>93) — 조정 상수 load-bearing
check('(d·A/B) mutant(DV_LIBDEF=0) 리베로 3세트+ > 93% (상수 무효화 → 밴드 FAIL 증명)', mut.L.lateAvg > 93, `mutant ${mut.L.lateAvg.toFixed(1)}% vs base ${base.L.lateAvg.toFixed(1)}%`);

log('');
log(ok ? '✅ PASS — 리베로 체력 튜닝 밴드 + A/B 민감도 통과' : '❌ FAIL — 밴드/드리프트/민감도 위반');
process.exit(ok ? 0 : 1);
