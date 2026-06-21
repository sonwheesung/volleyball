// INDEPENDENT — 받는팀 세터 릴리즈가 "컨택 후"인지 검증(룰 45 "시작 합법·릴리즈 후").
// segmentTargets 가 walk(컨택 전) 구간엔 받는팀을 receiveFormation(세터 깊음=합법)으로,
// serve(컨택~비행) 구간엔 세터를 네트로 침투시키는가? walk→serve 전환에서 세터 y가 깊음→네트로 바뀌어야 정상.
//   npx tsx tools/_dv_release.ts [경기수=10]

import { resetLeagueBase, getEvolvedTeamPlayers, coachInfoOf, LEAGUE } from '../data/league';
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { ballPath, type Lineups, type WP } from '../components/courtPath';
import { segmentTargets, reconstructRallies } from '../components/courtDirector';
import { lineupIdxAt } from '../components/courtLayout';
import type { Side } from '../types';

const W = 360, H = 500, SERVE_OUT = 22, NET_Y = 0.5 * H;
const log = (m: string) => process.stdout.write(m + '\n');
const nMatches = Math.max(1, Number(process.argv[2]) || 10);
type Px = { x: number; y: number };

resetLeagueBase();
const teams = LEAGUE.teams.map((t) => t.id);

let backSetterRallies = 0;
let walkLegal = 0, walkChecked = 0;     // walk 구간 세터가 합법(전위 패서보다 깊음)인가
let serveReleased = 0, serveChecked = 0; // serve 구간 세터가 네트로 침투했는가
const walkSetterY: number[] = [], serveSetterY: number[] = [];

for (let m = 0; m < nMatches; m++) {
  const hId = teams[m % teams.length], aId = teams[(m + 1) % teams.length];
  const hPs = getEvolvedTeamPlayers(hId, 0), aPs = getEvolvedTeamPlayers(aId, 0);
  const L: Lineups = { home: buildLineup(hPs), away: buildLineup(aPs) };
  const seed = 717171 + m * 5333;
  const sim = simulateMatch(seed, hPs, aPs, { home: coachInfoOf(hId), away: coachInfoOf(aId) });
  const rallies = reconstructRallies(sim);
  let prevLast: Px | undefined;
  const lastTargets: Record<string, Px> = {};

  for (let ri = 0; ri < rallies.length; ri++) {
    const r = rallies[ri];
    const path = ballPath(r, seed, L, W, H, SERVE_OUT, prevLast);
    prevLast = path.length ? { x: path[path.length - 1].x, y: path[path.length - 1].y } : prevLast;
    const stage = { serving: r.serving, homeRot: r.homeRot, awayRot: r.awayRot };
    const recvSide: Side = r.serving === 'home' ? 'away' : 'home';
    const recvRot = recvSide === 'home' ? r.homeRot : r.awayRot;
    const recvLu = recvSide === 'home' ? L.home : L.away;
    const sIdx = recvLu.six.findIndex((p) => p.position === 'S');
    const sZone = ((sIdx - recvRot) % 6 + 6) % 6 + 1;
    const setterBack = sZone === 1 || sZone === 5 || sZone === 6;
    if (setterBack) backSetterRallies++;
    const s = recvSide === 'home' ? 1 : -1;
    // 같은 열 전위 패서 zone(세터 zone의 전위 짝): 1↔2, 5↔4, 6↔3
    const frontPair = sZone === 1 ? 2 : sZone === 5 ? 4 : sZone === 6 ? 3 : -1;

    for (let k = 0; k + 1 < path.length; k++) {
      const seg = { from: path[k], to: path[k + 1] as WP };
      const tg = segmentTargets(seg, stage, L, W, H, SERVE_OUT, lastTargets);
      for (const key of Object.keys(tg)) lastTargets[key] = tg[key];
      if (!setterBack || frontPair < 0) continue;
      const setP = tg[`${recvSide}-${sIdx}`];
      const frP = tg[`${recvSide}-${lineupIdxAt(recvRot, frontPair)}`];
      if (!setP || !frP) continue;
      if (seg.to.kind === 'walk') {
        walkChecked++; walkSetterY.push((setP.y - NET_Y) * s);
        // 합법 = 세터가 전위 패서보다 네트에서 멀다 → s*(set.y - fr.y) > 0
        if (s * (setP.y - frP.y) > 0) walkLegal++;
      } else if (seg.to.kind === 'serve') {
        serveChecked++; serveSetterY.push((setP.y - NET_Y) * s);
        // 릴리즈 = 세터가 네트 침투(전위 패서보다 앞=네트 가까움) → s*(set.y - fr.y) < 0
        if (s * (setP.y - frP.y) < 0) serveReleased++;
      }
    }
  }
}

const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
log(`═══ 받는팀 후위세터 릴리즈 타이밍 (${nMatches}경기) ═══`);
log(`후위세터 랠리: ${backSetterRallies}`);
log(`[walk=컨택전] 세터 합법(패서보다 깊음): ${walkLegal}/${walkChecked} (${(100 * walkLegal / Math.max(1, walkChecked)).toFixed(0)}%) · 세터 네트거리평균 ${avg(walkSetterY).toFixed(0)}px`);
log(`[serve=컨택~비행] 세터 릴리즈(네트 침투): ${serveReleased}/${serveChecked} (${(100 * serveReleased / Math.max(1, serveChecked)).toFixed(0)}%) · 세터 네트거리평균 ${avg(serveSetterY).toFixed(0)}px`);
log(`\n해석: walk 100% 합법 + serve 100% 침투 = 룰45 "컨택 전 합법, 컨택 후 릴리즈" 정상.`);
log(`주의: auditBoard 룰Q는 serve 프레임을 ready대형으로 재계산해 검사 — 실제 그려지는 serve 프레임 좌표가 아니다.`);
