// ② 블로커 좌우 교차 — 프레임 정확(실제 애니메이션 위치)으로 검사.
// auditBoard 와 동일한 cur/anim/posAt 모델을 써서, 토스가 시작되는 "그 순간" 블로커들의
// 실제 화면 위치를 보고, 네트 벽으로 이동하는 2명+의 좌우 순서가 출발↔도착에서 뒤집히는지 센다.
//   npx tsx tools/checkBlockerCross.ts [경기수=10]
import { resetLeagueBase, getEvolvedTeamPlayers, coachInfoOf, LEAGUE } from '../data/league';
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { ballPath, SEG_DUR, markerTravelMs, type Lineups } from '../components/courtPath';
import { segmentTargets, reconstructRallies } from '../components/courtDirector';
import { lineupIdxAt } from '../components/courtLayout';
import type { Side } from '../types';

const W = 360, H = 500, SERVE_OUT = 22, SPEED = 2;
const log = (m: string) => process.stdout.write(m + '\n');
const N = Math.max(1, Number(process.argv[2]) || 10);
type Pt = { x: number; y: number };
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const easeOut = (u: number) => 1 - (1 - u) * (1 - u);
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

resetLeagueBase();
const teams = LEAGUE.teams.map((t) => t.id);
let walls = 0, crossings = 0; const examples: string[] = [];

for (let m = 0; m < N; m++) {
  const hId = teams[m % teams.length], aId = teams[(m + 1) % teams.length];
  const hPs = getEvolvedTeamPlayers(hId, 0), aPs = getEvolvedTeamPlayers(aId, 0);
  const L: Lineups = { home: buildLineup(hPs), away: buildLineup(aPs) };
  const seed = 868686 + m * 7919;
  const sim = simulateMatch(seed, hPs, aPs, { home: coachInfoOf(hId), away: coachInfoOf(aId) });
  const rallies = reconstructRallies(sim);

  const cur: Record<string, Pt> = {};
  const anim: Record<string, { from: Pt; to: Pt; t0: number; dur: number }> = {};
  const lastTargets: Record<string, Pt> = {};
  let prevLast: Pt | undefined; let tNow = 0;
  const posAt = (key: string, t: number): Pt => {
    const a = anim[key]; if (!a) return cur[key];
    const u = Math.max(0, Math.min(1, (t - a.t0) / a.dur));
    return lerp(a.from, a.to, easeOut(u));
  };

  for (const r of rallies) {
    const path = ballPath(r, seed, L, W, H, SERVE_OUT, prevLast);
    prevLast = path.length ? { x: path[path.length - 1].x, y: path[path.length - 1].y } : prevLast;
    const stage = { serving: r.serving, homeRot: r.homeRot, awayRot: r.awayRot };
    for (let k = 0; k + 1 < path.length; k++) {
      const seg = { from: path[k], to: path[k + 1] };
      const targets = segmentTargets(seg, stage, L, W, H, SERVE_OUT, lastTargets);

      // 토스 시작 순간(=직전까지의 실제 위치) 블로커 교차 검사
      if (seg.to.kind === 'toss') {
        const att: Side = seg.to.side; const def: Side = att === 'home' ? 'away' : 'home';
        const defRot = def === 'home' ? stage.homeRot : stage.awayRot;
        const netY = 0.5 * H;
        const front = [2, 3, 4].map((z) => lineupIdxAt(defRot, z));
        const wallers = front.filter((i) => { const t = targets[`${def}-${i}`]; return t && Math.abs(t.y - netY) < 0.09 * H; });
        if (wallers.length >= 2) {
          walls++;
          // 실제 현재 위치(애니메이션 반영) = posAt(tNow)
          const fromX = (i: number) => posAt(`${def}-${i}`, tNow)?.x ?? targets[`${def}-${i}`].x;
          const byTo = wallers.slice().sort((a, b) => targets[`${def}-${a}`].x - targets[`${def}-${b}`].x);
          let crossed = false;
          for (let p = 0; p + 1 < byTo.length; p++) if (fromX(byTo[p]) > fromX(byTo[p + 1]) + 2) crossed = true;
          if (crossed) {
            crossings++;
            if (examples.length < 5) examples.push(`경기${m + 1} ${r.setNo}세트 ${r.home}:${r.away} ${def} 출발x[${byTo.map((i) => fromX(i).toFixed(0)).join(',')}] 도착x[${byTo.map((i) => targets[`${def}-${i}`].x.toFixed(0)).join(',')}]`);
          }
        }
      }

      // 애니메이션/프레임 진행(auditBoard 모델과 동일)
      for (const [key, tgt] of Object.entries(targets)) {
        if (!cur[key]) { cur[key] = { ...tgt }; continue; }
        const prevTgt = anim[key]?.to ?? cur[key];
        if (Math.round(prevTgt.x) !== Math.round(tgt.x) || Math.round(prevTgt.y) !== Math.round(tgt.y)) {
          const fromP = posAt(key, tNow);
          anim[key] = { from: fromP, to: { ...tgt }, t0: tNow, dur: markerTravelMs(dist(fromP, tgt)) };
        }
        lastTargets[key] = tgt;
      }
      const segDur = (seg.to.dur ?? SEG_DUR[seg.to.kind]) * SPEED;
      tNow += segDur;
      for (const key of Object.keys(cur)) cur[key] = posAt(key, tNow);
    }
  }
}

log(`\n② 블로커 좌우 교차 (프레임 정확, 블록 벽 ${walls}건)`);
log(`  실제 위치 출발↔도착 순서 뒤집힘(BA 교차): ${crossings}건 (${(100 * crossings / Math.max(1, walls)).toFixed(2)}%)  목표 0`);
for (const e of examples) log('  · ' + e);

// ── 이빨: 프레임 정확 BA 교차는 0이 불변식(룰 35/39 — 서브 직후 수비 베이스 전환이 출발 순서를 벽 순서와 일치). ──
const ok = walls > 0 && crossings === 0;
log('\n검증(임계=BOARD_RULES 룰 35/39):');
log(`  ${ok ? 'PASS' : 'FAIL ❌'} — ② 블로커 BA 교차 0 (프레임 정확) (${crossings}/${walls}건)`);
process.exit(ok ? 0 : 1);
