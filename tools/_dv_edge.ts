// INDEPENDENT — 엣지 케이스: 5세트·듀스·작전교체(subEvents 반영 코트)·로테이션 전위만 블록·
// 후위 백어택 타점이 3m선 뒤인가. 실제 경기 재생에서 전 국면 스캔.
//   npx tsx tools/_dv_edge.ts [경기수=20]

import { resetLeagueBase, getEvolvedTeamPlayers, coachInfoOf, LEAGUE } from '../data/league';
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { ballPath, type Lineups, type WP } from '../components/courtPath';
import { segmentTargets, reconstructRallies, applySubsToSix } from '../components/courtDirector';
import { lineupIdxAt, zoneOfIdx } from '../components/courtLayout';
import type { Side, Player } from '../types';

const W = 360, H = 500, SERVE_OUT = 22, NET_Y = 0.5 * H;
const log = (m: string) => process.stdout.write(m + '\n');
const nMatches = Math.max(1, Number(process.argv[2]) || 20);
type Px = { x: number; y: number };

resetLeagueBase();
const teams = LEAGUE.teams.map((t) => t.id);

let fifthSets = 0, deuceRallies = 0, subRallies = 0;
// 블록 벽에 후위 선수가 들어갔는가(전위만 블록 — 룰 위반 카운트)
let blockerBackRow = 0, blockerChecks = 0;
// 작전교체 후 코트 6인이 여전히 1S·2OH·2MB·1OP 구성인가(슬롯 무결성)
let subSlotFail = 0, subChecks = 0;
// 백어택 타점이 자기 3m선 뒤인가(전위 공격은 네트 근처)
let backAtkChecked = 0, backAtkInFront = 0;

for (let m = 0; m < nMatches; m++) {
  const hId = teams[m % teams.length], aId = teams[(m + 1) % teams.length];
  const hPs = getEvolvedTeamPlayers(hId, 0), aPs = getEvolvedTeamPlayers(aId, 0);
  const L: Lineups = { home: buildLineup(hPs), away: buildLineup(aPs) };
  const byId = new Map<string, Player>();
  for (const p of [...hPs, ...aPs]) byId.set(p.id, p);
  const seed = 565656 + m * 8087;
  const sim = simulateMatch(seed, hPs, aPs, { home: coachInfoOf(hId), away: coachInfoOf(aId) });
  const subEv = (sim as { subEvents?: any[] }).subEvents;
  const rallies = reconstructRallies(sim);
  let prevLast: Px | undefined;
  const lastTargets: Record<string, Px> = {};

  for (let ri = 0; ri < rallies.length; ri++) {
    const r = rallies[ri];
    if (r.setNo === 5) fifthSets++;
    if (Math.min(r.home, r.away) >= 24) deuceRallies++;

    // 작전교체 반영 코트 6인 — 슬롯 무결성(룰30)
    if (subEv && subEv.length) {
      for (const side of ['home', 'away'] as Side[]) {
        const base = side === 'home' ? L.home.six : L.away.six;
        const six = applySubsToSix(base, side, subEv as any, ri, byId);
        if (six !== base) {
          subRallies++; subChecks++;
          const cnt: Record<string, number> = {};
          for (const p of six) cnt[p.position] = (cnt[p.position] ?? 0) + 1;
          // 정상 5-1: S1 OH2 MB2 OP1 (교체로 임시 변형 가능하나 6명·중복id 없어야)
          const ids = new Set(six.map((p) => p.id));
          if (ids.size !== 6) subSlotFail++;
        }
      }
    }

    const path = ballPath(r, seed, L, W, H, SERVE_OUT, prevLast);
    prevLast = path.length ? { x: path[path.length - 1].x, y: path[path.length - 1].y } : prevLast;
    const stage = { serving: r.serving, homeRot: r.homeRot, awayRot: r.awayRot };

    for (let k = 0; k + 1 < path.length; k++) {
      const seg = { from: path[k], to: path[k + 1] as WP };
      const tg = segmentTargets(seg, stage, L, W, H, SERVE_OUT, lastTargets);
      for (const key of Object.keys(tg)) lastTargets[key] = tg[key];

      // 블록 벽 구성: toss 때 블로커로 지정된 선수가 전위 존인가
      if (seg.to.kind === 'toss') {
        const attSide = seg.to.side;
        const dSide: Side = attSide === 'home' ? 'away' : 'home';
        const dRot = dSide === 'home' ? r.homeRot : r.awayRot;
        const front = new Set([2, 3, 4].map((z) => lineupIdxAt(dRot, z)));
        // 네트 밴드(NET_SAFE 근처)에 있는 수비팀 선수 = 블로커로 간주
        for (let i = 0; i < 6; i++) {
          const p = tg[`${dSide}-${i}`];
          if (!p) continue;
          const atNet = Math.abs(p.y - NET_Y) < 45; // 네트 밴드(블록벽 y≈0.575H=37.5px from net)
          if (atNet) {
            blockerChecks++;
            if (!front.has(i)) blockerBackRow++;
          }
        }
      }

      // 백어택: spike의 from(타점)이 후위 공격수면 타점 y가 3m선 뒤(자기 코트)인가
      if (seg.to.kind === 'spike') {
        const attSide = seg.from.side;
        const aRot = attSide === 'home' ? r.homeRot : r.awayRot;
        const hitIdx = seg.from.idx;
        if (hitIdx >= 0) {
          const z = zoneOfIdx(aRot, hitIdx);
          const back = z === 1 || z === 5 || z === 6;
          if (back) {
            backAtkChecked++;
            const threeM = (attSide === 'home' ? 0.66 : 0.34) * H;
            // 후위 공격 타점이 3m선보다 네트쪽(앞)이면 위반
            const inFront = attSide === 'home' ? seg.from.y < threeM : seg.from.y > threeM;
            if (inFront) backAtkInFront++;
          }
        }
      }
    }
  }
}

log(`═══ 엣지 케이스 (${nMatches}경기) ═══`);
log(`5세트 도달 랠리: ${fifthSets} · 듀스(양팀≥24) 랠리: ${deuceRallies} · 작전교체 반영 랠리: ${subRallies}`);
log(`[룰30 슬롯] 교체코트 검사 ${subChecks}회: 중복id/6인붕괴 ${subSlotFail} (0기대)`);
log(`[로테이션] 블록벽 후위선수 침입: ${blockerBackRow}/${blockerChecks} (0기대 — 전위만 블록)`);
log(`[백어택] 후위공격 타점 ${backAtkChecked}회: 3m선 앞(위반) ${backAtkInFront} (0기대)`);
