// INDEPENDENT — miscErr(볼핸들링 범실) 보드 연출 검사(사용자 보고 2026-06-21·2026-07-28).
//   핸들링 범실 = 세트 더블컨택·캐치·네트터치(세트 반칙) → 스파이크가 없어야 한다.
//   ballPath 세그먼트에 'spike'가 끼면 버그(엔진은 공격 전에 종료, 보드만 spike 합성).
//   (2026-07-28 사각 봉인) 스파이크 없음만 봐선 **공이 세터에게 죽는(자기 토스처럼 보이는)** 재발을 못 잡았다
//   (사용자 재보고). 그래서 두 번째 불변식 추가: **종결 fault 직전 WP는 `toss`여야** 한다 — 세터가 공격수에게
//   올리려다(toss) 반칙낸 것으로 보여야지, 토스 없이(=자기 자리 passSpot) 그냥 죽으면 안 된다. 구 417경로(passSpot
//   즉사 return)는 toss가 없어 이 검사에 걸린다(수정 전 A/B로 FAIL 재현).
//   A/B: kill 랠리는 spike가 *있어야* + toss가 *있어야* (검사 신뢰). Usage: npx tsx tools/_dv_mischandle.ts [경기=30]
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

let miscErr = 0, miscErrSpike = 0, miscErrNoToss = 0, kill = 0, killSpike = 0, killToss = 0;
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
    if (r.how === 'miscErr') {
      miscErr++;
      if (beforeTerm === 'spike') miscErrSpike++;
      if (beforeTerm !== 'toss') miscErrNoToss++; // 종결 fault 직전이 toss가 아니면 = 세터가 안 올리고 죽음(자기토스처럼 보임)
    }
    if (r.how === 'kill') { kill++; if (path.some((p) => p.kind === 'spike')) killSpike++; if (path.some((p) => p.kind === 'toss')) killToss++; }
  }
}
log('═══ miscErr(핸들링 범실) 보드 연출 검사 ═══');
log(`핸들링 범실 랠리 ${miscErr}건`);
log(`  · spike 그린 것 **${miscErrSpike}건** (0이어야 — 세트 반칙엔 스파이크 없음)`);
log(`  · 종결 직전이 toss 아님 **${miscErrNoToss}건** (0이어야 — 세터가 공격수에게 올리려다 반칙, 자기 자리서 죽으면 안 됨)`);
log(`[A/B] kill ${kill}건 중 spike ${killSpike}건·toss ${killToss}건 (둘 다 100%여야 = spike/toss 검출 신뢰)`);
const ok = miscErrSpike === 0 && miscErrNoToss === 0 && kill > 0 && killSpike === kill && killToss === kill;
log(`\nMISCHANDLE OK = ${ok}`);
process.exit(ok ? 0 : 2);
