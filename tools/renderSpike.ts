// 스파이크 순간 커버 대형 시각 점검 — ASCII로 공격수(★)·커버(C)·블로커(B)·공(*)·네트(═)를 찍는다.
// 커버 위치가 공격수/리바운드 구역과 맞는지 눈으로 확인(추정 금지).
//   npx tsx tools/renderSpike.ts [경기수=4]
import { resetLeagueBase, getEvolvedTeamPlayers, coachInfoOf, LEAGUE } from '../data/league';
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { ballPath, type Lineups } from '../components/courtPath';
import { segmentTargets, reconstructRallies } from '../components/courtDirector';
import type { Side } from '../types';

const W = 360, H = 500;
const log = (m: string) => process.stdout.write(m + '\n');
const N = Math.max(1, Number(process.argv[2]) || 4);

resetLeagueBase();
const teams = LEAGUE.teams.map((t) => t.id);

function render(title: string, targets: Record<string, { x: number; y: number }>, ball: { x: number; y: number }, atkSide: Side, atkIdx: number, coverIdx: Set<number>, blkIdx: Set<number>): void {
  const COLS = 38, ROWS = 21;
  const g: string[][] = Array.from({ length: ROWS }, () => Array(COLS).fill('·'));
  const netRow = Math.round(0.5 * (ROWS - 1));
  for (let c = 0; c < COLS; c++) g[netRow][c] = '═';
  const put = (x: number, y: number, ch: string) => {
    const c = Math.max(0, Math.min(COLS - 1, Math.round((x / W) * (COLS - 1))));
    const r = Math.max(0, Math.min(ROWS - 1, Math.round((y / H) * (ROWS - 1))));
    if (g[r][c] === '·' || g[r][c] === '═') g[r][c] = ch;
  };
  for (const k of Object.keys(targets)) {
    const [side, iStr] = k.split('-'); const i = Number(iStr);
    const p = targets[k];
    let ch = side === 'home' ? 'o' : 'x';
    if (side === atkSide && i === atkIdx) ch = '★';
    else if (side === atkSide && coverIdx.has(i)) ch = 'C';
    else if (side !== atkSide && blkIdx.has(i)) ch = 'B';
    put(p.x, p.y, ch);
  }
  put(ball.x, ball.y, '*');
  log(`\n  ${title}`);
  for (let r = 0; r < ROWS; r++) log('  ' + g[r].join('') + (r === netRow ? ' ←네트' : ''));
}

let shown = 0;
for (let m = 0; m < N && shown < 6; m++) {
  const hId = teams[m % teams.length], aId = teams[(m + 1) % teams.length];
  const hPs = getEvolvedTeamPlayers(hId, 0), aPs = getEvolvedTeamPlayers(aId, 0);
  const L: Lineups = { home: buildLineup(hPs), away: buildLineup(aPs) };
  const seed = 424242 + m * 7919;
  const sim = simulateMatch(seed, hPs, aPs, { home: coachInfoOf(hId), away: coachInfoOf(aId) });
  const rallies = reconstructRallies(sim);
  let prev: { x: number; y: number } | undefined;
  for (let ri = 0; ri < rallies.length && shown < 6; ri++) {
    const r = rallies[ri];
    const path = ballPath(r, seed, L, W, H, 22, prev);
    prev = path.length ? { x: path[path.length - 1].x, y: path[path.length - 1].y } : prev;
    if (r.how !== 'kill' && r.how !== 'stuff') continue;
    const stage = { serving: r.serving, homeRot: r.homeRot, awayRot: r.awayRot };
    for (let k = 0; k + 1 < path.length; k++) {
      const to = path[k + 1];
      if (to.kind !== 'spike') continue;
      const seg = { from: path[k], to };
      const targets = segmentTargets(seg, stage, L, W, H, 22);
      // 커버 = 이 spike WP의 movers 중 공격측, 블로커 = 토스 WP(이전)의 movers 중 수비측 근사
      const atkSide = path[k].side; // 토스 WP side = 공격팀
      const cover = new Set<number>((to.movers ?? []).filter((mv) => mv.side === atkSide).map((mv) => mv.idx));
      const blk = new Set<number>([0, 1, 2, 3, 4, 5]); // 표시는 생략(근사)
      const atkIdx = path[k].idx;
      render(`경기${m + 1} 랠리${ri + 1} [${r.how}] ★=공격수 C=커버 *=공`, targets, { x: to.x, y: to.y }, atkSide, atkIdx, cover, new Set());
      shown++;
      break;
    }
  }
}
log('');
