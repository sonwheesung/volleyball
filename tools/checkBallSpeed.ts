// 공(볼) 구간 속도 측정 — 추정 금지. 블록아웃 굴절구가 원 스파이크보다 느린지(사용자 보고) 검증.
// ballPath의 각 WP 구간을 거리/지속(px/ms)로 환산. 종류별 중앙값 비교.
//   npx tsx tools/checkBallSpeed.ts [경기수=10]
import { resetLeagueBase, getEvolvedTeamPlayers, coachInfoOf, LEAGUE } from '../data/league';
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { ballPath, SEG_DUR, type Lineups } from '../components/courtPath';
import { reconstructRallies } from '../components/courtDirector';

const W = 360, H = 500, SERVE_OUT = 22, SPEED = 2;
const M_PER_PX = 9 / W;
const log = (m: string) => process.stdout.write(m + '\n');
const N = Math.max(1, Number(process.argv[2]) || 10);

resetLeagueBase();
const teams = LEAGUE.teams.map((t) => t.id);
const speeds: Record<string, number[]> = { 'spike→블록(컨택)': [], '블록아웃 굴절': [], '클린 킬': [], '스터프 낙하': [] };

for (let m = 0; m < N; m++) {
  const hId = teams[m % teams.length], aId = teams[(m + 1) % teams.length];
  const hPs = getEvolvedTeamPlayers(hId, 0), aPs = getEvolvedTeamPlayers(aId, 0);
  const L: Lineups = { home: buildLineup(hPs), away: buildLineup(aPs) };
  const seed = 424242 + m * 7919;
  const sim = simulateMatch(seed, hPs, aPs, { home: coachInfoOf(hId), away: coachInfoOf(aId) });
  const rallies = reconstructRallies(sim);
  let prev: { x: number; y: number } | undefined;
  for (const r of rallies) {
    const path = ballPath(r, seed, L, W, H, SERVE_OUT, prev);
    prev = path.length ? { x: path[path.length - 1].x, y: path[path.length - 1].y } : prev;
    for (let k = 0; k + 1 < path.length; k++) {
      const a = path[k], b = path[k + 1];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const dur = (b.dur ?? SEG_DUR[b.kind]) * SPEED;
      if (dur <= 0) continue;
      const mps = (d / dur) * 1000 * M_PER_PX;
      // 블록아웃: spike(컨택) → fault(굴절). 스터프: spike → fault(낙하). 킬: spike(코트 안 착지).
      if (r.how === 'blockout' && b.kind === 'spike') speeds['spike→블록(컨택)'].push(mps);
      else if (r.how === 'blockout' && b.kind === 'fault') speeds['블록아웃 굴절'].push(mps);
      else if (r.how === 'kill' && b.kind === 'spike') speeds['클린 킬'].push(mps);
      else if (r.how === 'stuff' && b.kind === 'fault') speeds['스터프 낙하'].push(mps);
    }
  }
}

const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
log(`\n═══ 공 구간 속도 (${N}경기, m/s 환산) ═══`);
for (const k of Object.keys(speeds)) {
  const a = speeds[k];
  if (!a.length) { log(`  ${k.padEnd(16)} (표본 없음)`); continue; }
  const s = [...a].sort((x, y) => x - y);
  log(`  ${k.padEnd(16)} 중앙값 ${med(a).toFixed(1)}  범위 ${s[0].toFixed(1)}~${s[s.length - 1].toFixed(1)}  n=${a.length}`);
}
const blkContact = med(speeds['spike→블록(컨택)']);
const deflect = med(speeds['블록아웃 굴절']);
log(`\n  판정: 블록아웃 굴절(${deflect.toFixed(1)}) < 원 스파이크 컨택(${blkContact.toFixed(1)}) ? ${deflect < blkContact ? '✅ 느림(정상)' : '❌ 더 빠름(버그)'}`);
log('');
