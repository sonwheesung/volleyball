// 서브 낙구 위치 점검 — 추정 금지. 서브가 전위(네트 앞)에 떨어지는지 측정.
// 낙구 깊이(네트=0 ~ 엔드라인=1 court 분수)와 "전위 존(2/3/4) 선수가 가장 가까운가" 비율.
//   npx tsx tools/traceServe.ts [경기수=10]
import { resetLeagueBase, getEvolvedTeamPlayers, coachInfoOf, LEAGUE } from '../data/league';
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { ballPath, type Lineups } from '../components/courtPath';
import { reconstructRallies, segmentTargets } from '../components/courtDirector';
import { zoneOfIdx } from '../components/courtLayout';
import type { Side } from '../types';

const W = 360, H = 500, SERVE_OUT = 22, NETY = 0.5 * H;
const log = (m: string) => process.stdout.write(m + '\n');
const N = Math.max(1, Number(process.argv[2]) || 10);

resetLeagueBase();
const teams = LEAGUE.teams.map((t) => t.id);
// 깊이: 네트에서 코트 반쪽(0.5H) 대비 분수. 0=네트, 1=엔드라인. 3m라인=0.333, 전위존 마커≈0.16
const depthOf = (recv: Side, y: number) => (recv === 'home' ? (y - NETY) : (NETY - y)) / (0.5 * H);

const depths: number[] = [];
const frontPos: Record<string, number> = {};
let frontReceived = 0, total = 0;
const bins = { '네트~1.5m(<0.17)': 0, '1.5~3m(0.17~0.33)': 0, '3m~중간(0.33~0.6)': 0, '깊음(>0.6)': 0 };

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
    // 정상 리시브 서브 = kind 'serve' 이면서 hold 아님(에이스/범실 제외)
    const k = path.findIndex((w) => w.kind === 'serve' && !w.hold);
    if (k < 0) continue;
    const sv = path[k];
    const recv = sv.side; // 서브 받는 팀
    const d = depthOf(recv, sv.y);
    depths.push(d); total++;
    if (d < 0.17) bins['네트~1.5m(<0.17)']++;
    else if (d < 0.33) bins['1.5~3m(0.17~0.33)']++;
    else if (d < 0.6) bins['3m~중간(0.33~0.6)']++;
    else bins['깊음(>0.6)']++;
    // 낙구점에 가장 가까운 수비팀 선수가 전위(zone 2/3/4)인가
    const stage = { serving: r.serving, homeRot: r.homeRot, awayRot: r.awayRot };
    const seg = { from: path[Math.max(0, k - 1)], to: sv };
    const tg = segmentTargets(seg, stage, L, W, H, SERVE_OUT);
    const rot = recv === 'home' ? r.homeRot : r.awayRot;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < 6; i++) {
      const p = tg[`${recv}-${i}`]; if (!p) continue;
      const dd = (p.x - sv.x) ** 2 + (p.y - sv.y) ** 2;
      if (dd < bestD) { bestD = dd; best = i; }
    }
    if (best >= 0) {
      const z = zoneOfIdx(rot, best);
      if (z === 2 || z === 3 || z === 4) {
        frontReceived++;
        const lu = recv === 'home' ? L.home : L.away;
        const pos = lu.six[best]?.position ?? '?';
        frontPos[pos] = (frontPos[pos] ?? 0) + 1;
      }
    }
  }
}

const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
log(`\n═══ 서브 낙구 위치 (${N}경기, ${total}서브) ═══`);
log(`  낙구 깊이 중앙값: ${med(depths).toFixed(2)} (0=네트·0.33=3m라인·1=엔드라인)`);
log(`  깊이 분포:`);
for (const [k, v] of Object.entries(bins)) log(`    ${k.padEnd(22)} ${(v / total * 100).toFixed(1)}%`);
log(`\n  ★ 전위(존2/3/4) 선수가 낙구에 가장 가까움: ${(frontReceived / total * 100).toFixed(1)}%  (높으면 "전위에 떨어진다" 버그)`);
log(`     그중 포지션: ${Object.entries(frontPos).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p} ${(n / Math.max(1, frontReceived) * 100).toFixed(0)}%`).join(' · ')}`);
log(`     (OH/L=리시버라 정상 · MB/OP/S=비패서가 받으면 어색)`);
log('');
