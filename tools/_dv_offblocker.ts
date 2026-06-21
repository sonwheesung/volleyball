// INDEPENDENT — 룰48 오프블로커 팁 시프트가 toss 프레임에서 일어나고, spike 프레임엔 안 일어나는가
// (courtDirector 자체점검: spike까지 확장하면 수비홀 9건 회귀 → toss 한정). 둘 다 측정해 대조.
//   npx tsx tools/_dv_offblocker.ts [경기수=12]

import { resetLeagueBase, getEvolvedTeamPlayers, coachInfoOf, LEAGUE } from '../data/league';
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { ballPath, type Lineups, type WP } from '../components/courtPath';
import { segmentTargets, reconstructRallies } from '../components/courtDirector';
import { lineupIdxAt, switchedSpots } from '../components/courtLayout';
import type { Side } from '../types';

const W = 360, H = 500, SERVE_OUT = 22, NET_Y = 0.5 * H, M_PER_PX = 9 / W;
const log = (m: string) => process.stdout.write(m + '\n');
const nMatches = Math.max(1, Number(process.argv[2]) || 12);
type Px = { x: number; y: number };

resetLeagueBase();
const teams = LEAGUE.teams.map((t) => t.id);

// 오프블로커(블록 안 뛰는 전위)를 식별해 → 블록뒤 팁존((ax, 3m선))까지 거리 측정.
// 비교: toss 프레임(시프트 기대) vs spike 프레임(풀오프 유지 — 시프트 해제 기대).
const tossTip: number[] = [], spikeTip: number[] = [];

for (let m = 0; m < nMatches; m++) {
  const hId = teams[m % teams.length], aId = teams[(m + 1) % teams.length];
  const hPs = getEvolvedTeamPlayers(hId, 0), aPs = getEvolvedTeamPlayers(aId, 0);
  const L: Lineups = { home: buildLineup(hPs), away: buildLineup(aPs) };
  const seed = 313131 + m * 4099;
  const sim = simulateMatch(seed, hPs, aPs, { home: coachInfoOf(hId), away: coachInfoOf(aId) });
  const rallies = reconstructRallies(sim);
  let prevLast: Px | undefined;
  const lastTargets: Record<string, Px> = {};

  for (let ri = 0; ri < rallies.length; ri++) {
    const r = rallies[ri];
    const path = ballPath(r, seed, L, W, H, SERVE_OUT, prevLast);
    prevLast = path.length ? { x: path[path.length - 1].x, y: path[path.length - 1].y } : prevLast;
    const stage = { serving: r.serving, homeRot: r.homeRot, awayRot: r.awayRot };

    for (let k = 0; k + 1 < path.length; k++) {
      const seg = { from: path[k], to: path[k + 1] as WP };
      const tg = segmentTargets(seg, stage, L, W, H, SERVE_OUT, lastTargets);
      for (const key of Object.keys(tg)) lastTargets[key] = tg[key];

      const kind = seg.to.kind;
      if (kind !== 'toss' && kind !== 'spike') continue;
      const attSide: Side = kind === 'toss' ? seg.to.side : seg.from.side;
      const ax = kind === 'toss' ? seg.to.x : seg.from.x;
      const dSide: Side = attSide === 'home' ? 'away' : 'home';
      const dRot = dSide === 'home' ? r.homeRot : r.awayRot;
      const dLu = dSide === 'home' ? L.home : L.away;
      const front = [2, 3, 4].map((z) => lineupIdxAt(dRot, z));
      const dSw = switchedSpots(dSide, dLu, dRot, false, W, H);
      const blk = (kind === 'toss' ? seg.to.blk : undefined) ?? 2;
      // 블록 정면에서 가장 먼 전위 = 오프블로커(시프트 측정 대상)
      const sortedByDist = front.slice().sort((a, b) => Math.abs(dSw.pos[a].x - ax) - Math.abs(dSw.pos[b].x - ax));
      const offBlockers = sortedByDist.slice(blk); // 블록 가담 제외
      const tipY = (dSide === 'home' ? 0.66 : 0.34) * H;
      for (const ob of offBlockers) {
        const p = tg[`${dSide}-${ob}`];
        if (!p) continue;
        const d = Math.hypot(p.x - ax, p.y - tipY) * M_PER_PX;
        (kind === 'toss' ? tossTip : spikeTip).push(d);
      }
    }
  }
}

const med = (a: number[]) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
log(`═══ 룰48 오프블로커 팁 시프트 (${nMatches}경기) ═══`);
log(`toss 프레임 오프블로커→팁존: 중앙값 ${med(tossTip).toFixed(2)}m · 평균 ${avg(tossTip).toFixed(2)}m (n=${tossTip.length}) — 시프트로 작아져야(문서 3.56m)`);
log(`spike 프레임 오프블로커→팁존: 중앙값 ${med(spikeTip).toFixed(2)}m · 평균 ${avg(spikeTip).toFixed(2)}m (n=${spikeTip.length}) — 시프트 해제(풀오프 베이스)`);
log(`\n해석: toss에서 팁존에 가깝고 spike에서 멀어지면 = 문서대로 toss 한정 시프트(spike 확장 시 수비홀 회귀를 피함).`);
