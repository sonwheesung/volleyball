// INDEPENDENT — miscErr(볼핸들링 범실) 보드 연출이 spike를 그리는지 측정(사용자 보고 2026-06-21).
//   핸들링 범실 = 세트 더블컨택·캐치·네트터치(세트 반칙) → 스파이크가 없어야 한다.
//   ballPath 세그먼트에 'spike'가 끼면 버그(엔진은 공격 전에 종료, 보드만 spike 합성).
//   A/B: kill 랠리는 spike가 *있어야* (검사 신뢰). Usage: npx tsx tools/_dv_mischandle.ts [경기=30]
import { resetLeagueBase, getEvolvedTeamPlayers, coachInfoOf, LEAGUE } from '../data/league';
import { buildLineup } from '../engine/lineup';
import { simulateMatch } from '../engine/match';
import { ballPath, type Lineups } from '../components/courtPath';
import { reconstructRallies } from '../components/courtDirector';

const W = 360, H = 500, SERVE_OUT = 22;
const log = (m: string) => process.stdout.write(m + '\n');
const N = Math.max(1, Number(process.argv[2]) || 30);
resetLeagueBase();
const teams = LEAGUE.teams.map((t) => t.id);

let miscErr = 0, miscErrSpike = 0, kill = 0, killSpike = 0;
for (let m = 0; m < N; m++) {
  const hId = teams[m % teams.length], aId = teams[(m + 1) % teams.length];
  const hPs = getEvolvedTeamPlayers(hId, 0), aPs = getEvolvedTeamPlayers(aId, 0);
  const L: Lineups = { home: buildLineup(hPs), away: buildLineup(aPs) };
  const seed = 424242 + m * 7919;
  const sim = simulateMatch(seed, hPs, aPs, { home: coachInfoOf(hId), away: coachInfoOf(aId) });
  let prevLast: { x: number; y: number } | undefined;
  for (const r of reconstructRallies(sim)) {
    const path = ballPath(r, seed, L, W, H, SERVE_OUT, prevLast);
    prevLast = path.length ? { x: path[path.length - 1].x, y: path[path.length - 1].y } : prevLast;
    // 종결 fault(세트 반칙) 직전 세그먼트가 spike면 "스파이크→핸들링범실"(버그). 멀티홉의 *이전* 디그된 spike는 정당(무관).
    let termIdx = -1;
    for (let k = path.length - 1; k >= 0; k--) { if (path[k].kind === 'fault') { termIdx = k; break; } }
    const beforeTerm = termIdx > 0 ? path[termIdx - 1].kind : null;
    if (r.how === 'miscErr') { miscErr++; if (beforeTerm === 'spike') miscErrSpike++; }
    if (r.how === 'kill') { kill++; if (path.some((p) => p.kind === 'spike')) killSpike++; }
  }
}
log('═══ miscErr(핸들링 범실) 보드 연출 — spike 여부 ═══');
log(`핸들링 범실 랠리 ${miscErr}건 중 spike 그린 것 **${miscErrSpike}건** (0이어야 — 세트 반칙엔 스파이크 없음)`);
log(`[A/B] kill 랠리 ${kill}건 중 spike ${killSpike}건 (kill은 100% spike여야 = 검사 신뢰)`);
const ok = miscErrSpike === 0 && kill > 0 && killSpike === kill;
log(`\nMISCHANDLE OK = ${ok}`);
process.exit(ok ? 0 : 2);
