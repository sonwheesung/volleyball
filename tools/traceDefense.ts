// 블록/아웃볼 때 커버·수비 반응이 실제로 보이는지 측정 — 추정 금지.
// 각 종결(stuff/blockout/recvErr/softblock) 마지막 반응 구간에서 선수가 얼마나 이동하는지(px)와
// 공까지의 최종 거리를 잰다. 이동이 미미하면 "반응이 안 보인다".
//   npx tsx tools/traceDefense.ts [경기수=10]
import { resetLeagueBase, getEvolvedTeamPlayers, coachInfoOf, LEAGUE } from '../data/league';
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { ballPath, SEG_DUR, type Lineups } from '../components/courtPath';
import { segmentTargets, reconstructRallies } from '../components/courtDirector';
import type { Side } from '../types';

const W = 360, H = 500, SERVE_OUT = 22, M_PER_PX = 9 / W;
const log = (m: string) => process.stdout.write(m + '\n');
const N = Math.max(1, Number(process.argv[2]) || 10);

resetLeagueBase();
const teams = LEAGUE.teams.map((t) => t.id);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

// how별: 마지막 fault/pass 구간에서 mover들의 이동량·공까지 거리
const stat: Record<string, { moves: number[]; nearest: number[]; count: number; reacted: number }> = {};
const add = (how: string, moves: number[], nearest: number) => {
  const s = (stat[how] ??= { moves: [], nearest: [], count: 0, reacted: 0 });
  s.count++; s.nearest.push(nearest);
  for (const m of moves) s.moves.push(m);
  if (moves.some((m) => m > 18)) s.reacted++; // 18px(≈0.45m) 넘게 움직이면 "반응 보임"
};

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
    const how = r.how; if (!how || !['stuff', 'blockout', 'recvErr', 'atkErr'].includes(how)) continue;
    const stage = { serving: r.serving, homeRot: r.homeRot, awayRot: r.awayRot };
    // 마지막 'fault' 구간을 찾는다
    let fi = -1;
    for (let k = path.length - 1; k >= 1; k--) if (path[k].kind === 'fault') { fi = k; break; }
    if (fi < 1) continue;
    const seg = { from: path[fi - 1], to: path[fi] };
    const prevSeg = { from: path[Math.max(0, fi - 2)], to: path[fi - 1] };
    const before = segmentTargets(prevSeg, stage, L, W, H, SERVE_OUT);
    const after = segmentTargets(seg, stage, L, W, H, SERVE_OUT, before);
    const ball = { x: path[fi].x, y: path[fi].y };
    const moves: number[] = [];
    let nearest = Infinity;
    for (const mv of seg.to.movers ?? []) {
      const key = `${mv.side}-${mv.idx}`;
      const from = before[key] ?? after[key];
      const to = after[key] ?? { x: mv.x, y: mv.y };
      moves.push(dist(from, to));
      nearest = Math.min(nearest, dist(to, ball) * M_PER_PX);
    }
    if (nearest === Infinity) nearest = dist({ x: before[`${seg.to.side}-0`]?.x ?? 0, y: 0 }, ball) * M_PER_PX;
    add(how, moves, nearest);
  }
}

const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
log(`\n═══ 블록/아웃볼 수비 반응 (${N}경기) ═══\n`);
log(`  ${'종결'.padEnd(10)} 표본   추격자 이동 중앙값  공까지 최종거리  "반응 보임" 비율`);
for (const how of ['stuff', 'blockout', 'recvErr', 'atkErr']) {
  const s = stat[how]; if (!s) { log(`  ${how.padEnd(10)} (없음)`); continue; }
  log(`  ${how.padEnd(10)} ${String(s.count).padStart(4)}   ${med(s.moves).toFixed(0).padStart(6)}px        ${med(s.nearest).toFixed(1)}m          ${(s.reacted / s.count * 100).toFixed(0)}%`);
}
log('');
