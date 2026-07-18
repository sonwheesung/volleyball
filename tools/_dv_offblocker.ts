// INDEPENDENT — 룰48 방향 반전(R3, #131): toss 프레임 수비 오프블로커(벽 미참여 전위)가
//   **자기 스위칭 레인(자기 사이드 전위 존) 근처**에 머무는가(구 동작: 공격 x쪽 0.35 시프트로 중앙에 끌려옴 = 반려).
// 오라클: 오프블로커 목표 x ↔ 자기 switchedSpots 전위 레인(인셋) x 편차가 작아야(자기 사이드 유지). 팁(페인트) 커버는 후위 몫.
// A/B(오라클 유효 증명): 구 시프트 로직(baseX + (ax-baseX)*0.35)을 같은 프레임에 재계산 → 자기 레인서 크게 벗어남(검출).
//   npx tsx tools/_dv_offblocker.ts [경기수=12]
import { resetLeagueBase, getEvolvedTeamPlayers, coachInfoOf, LEAGUE } from '../data/league';
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { ballPath, type Lineups, type WP } from '../components/courtPath';
import { segmentTargets, reconstructRallies } from '../components/courtDirector';
import { lineupIdxAt, switchedSpots } from '../components/courtLayout';
import { OFFBLOCKER_INSET } from '../components/formationParams';
import type { Side } from '../types';

const W = 360, H = 500, SERVE_OUT = 22;
const log = (m: string) => process.stdout.write(m + '\n');
const nMatches = Math.max(1, Number(process.argv[2]) || 12);
type Px = { x: number; y: number };
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

resetLeagueBase();
const teams = LEAGUE.teams.map((t) => t.id);

const ownDev: number[] = [];   // 오프블로커 목표 x ↔ 자기 레인(인셋) x 편차(분수) — 작아야
const oldDev: number[] = [];   // 구 시프트 로직이었으면의 편차(분수) — 커야(A/B)
let n = 0;

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
      if (seg.to.kind !== 'toss') continue;
      const attSide: Side = seg.to.side;
      const ax = seg.to.x;
      const dSide: Side = attSide === 'home' ? 'away' : 'home';
      const dRot = dSide === 'home' ? r.homeRot : r.awayRot;
      const dLu = dSide === 'home' ? L.home : L.away;
      const front = [2, 3, 4].map((z) => lineupIdxAt(dRot, z));
      const dSw = switchedSpots(dSide, dLu, dRot, false, W, H).pos;
      const blk = seg.to.blk ?? 2;
      // 오프블로커 = 블록 정면서 먼 전위(벽 미참여). courtDirector 선정과 동일하게 블록레디 기준 대신 여기선 실제 목표로 식별.
      const sortedByDist = front.slice().sort((a, b) => Math.abs(dSw[a].x - ax) - Math.abs(dSw[b].x - ax));
      const offBlockers = sortedByDist.slice(blk);
      for (const ob of offBlockers) {
        const p = tg[`${dSide}-${ob}`]; if (!p) continue;
        const laneX = dSw[ob].x;
        const ownLaneInset = clampN(laneX + Math.sign(0.5 * W - laneX) * OFFBLOCKER_INSET * W, 24, W - 24); // courtDirector와 동일
        ownDev.push(Math.abs(p.x - ownLaneInset) / W);
        // A/B: 구 시프트 로직이었으면 목표는 baseX+(ax-baseX)*0.35 → 자기 레인서 얼마나 벗어나나
        const oldShifted = clampN(laneX + (ax - laneX) * 0.35, 24, W - 24);
        oldDev.push(Math.abs(oldShifted - ownLaneInset) / W);
        n++;
      }
    }
  }
}

const med = (a: number[]) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const p90 = (a: number[]) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length * 0.9)]; };
const TH = 0.06; // 자기 레인서 허용 편차(분수) — 인셋+jit 여유
const okOwn = med(ownDev) <= TH;
const abValid = med(oldDev) >= 0.10; // 구 로직은 레인서 크게 벗어나야 오라클 유효
log(`═══ 룰48 반전 — 오프블로커 자기 사이드 유지 (${nMatches}경기 · toss 오프블로커 ${n}건) ═══`);
log(`[신] 오프블로커 목표 ↔ 자기 레인(인셋) 편차: 중앙값 ${med(ownDev).toFixed(3)} · p90 ${p90(ownDev).toFixed(3)}  ${okOwn ? '✅' : '⚠'} (≤${TH})`);
log(`[A/B] 구 시프트(0.35) 로직이면 자기 레인서 편차: 중앙값 ${med(oldDev).toFixed(3)} → ${abValid ? '✅ 오라클 유효(구 로직은 벗어남)' : '⚠ 오라클 둔감'}`);
log(okOwn && abValid ? '\n결론: ✅ 오프블로커 자기 사이드 유지 + 오라클 유효' : '\n결론: ⚠ 점검 필요');
