// 스터프(블록 득점) 중계가 엔진 귀속 블로커(byId)를 이름으로 부르는지 검증.
// 보드 재생(reconstructRallies+ballPath, 교체 반영)으로 stuff 종결 fault 세그먼트에 commentLine을
// 돌려 byId 블로커 이름이 중계에 나오는지. (수정 전 ~40% 우연 → 수정 후 ~100% 기대)
import { resetLeagueBase, LEAGUE, coachInfoOf } from '../data/league';
import { availableTeamPlayers } from '../data/injury';
import { simulateMatch } from '../engine/match';
import { reconstructRallies, applySubsToSix } from '../components/courtDirector';
import { ballPath, type Lineups } from '../components/courtPath';
import { commentLine } from '../components/courtCommentary';
import { buildLineup } from '../engine/lineup';
import type { Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();
const W = 360, H = 500, SO = 22;
const N = parseInt(process.argv[2] || '300', 10);
const t0 = LEAGUE.teams[0].id, t1 = LEAGUE.teams[1].id;
const A = availableTeamPlayers(t0, 0), B = availableTeamPlayers(t1, 0);
const baseL = { home: buildLineup(A), away: buildLineup(B) };
const byIdMap = new Map<string, Player>();
for (const p of [...A, ...B]) byIdMap.set(p.id, p);
const base = { home: coachInfoOf(t0), away: coachInfoOf(t1) } as any;

let stuff = 0, named = 0;
for (let s = 1; s <= N; s++) {
  const sim = simulateMatch(s, A, B, base);
  const rallies = reconstructRallies(sim);
  const effAt = (i: number): Lineups => ({
    home: { ...baseL.home, six: applySubsToSix(baseL.home.six, 'home', sim.subEvents, i, byIdMap) },
    away: { ...baseL.away, six: applySubsToSix(baseL.away.six, 'away', sim.subEvents, i, byIdMap) },
  });
  for (let i = 0; i < rallies.length; i++) {
    const r = rallies[i];
    if (r.how !== 'stuff' || !r.byId) continue;
    stuff++;
    const eff = effAt(i);
    let prevLast: { x: number; y: number } | undefined;
    if (i > 0) { const pp = ballPath(rallies[i - 1], s, effAt(i - 1), W, H, SO); const w = pp[pp.length - 1]; prevLast = { x: w.x, y: w.y }; }
    const path = ballPath(r, s, eff, W, H, SO, prevLast);
    const blkP = (eff.home.six.find((p) => p.id === r.byId) ?? eff.away.six.find((p) => p.id === r.byId));
    const stage = { serving: r.serving, homeRot: r.homeRot, awayRot: r.awayRot };
    // stuff 종결 fault 세그먼트에 중계
    let hit = false;
    for (let k = 0; k + 1 < path.length; k++) {
      if (path[k + 1].kind === 'fault') {
        const line = commentLine({ from: path[k], to: path[k + 1] }, 'stuff', eff, stage, r.byId);
        if (line && blkP && line.includes(blkP.name)) hit = true;
      }
    }
    if (hit) named++;
  }
}
const rate = named / stuff * 100;
log(`스터프 득점 ${stuff}건 (시드 ${N}, 교체 반영)`);
log(`중계가 byId 블로커 이름을 부름: ${named}건 (${rate.toFixed(2)}%)`);
log(`판정: ${rate >= 99 ? '✅ PASS — 블로커 100% 호명(킬 수준 충실)' : '❌ CHECK'}`);
process.exit(rate >= 99 ? 0 : 1); // 배터리 게이트: 판정을 exit code로 배선(로그만이면 영구 허위 초록)
