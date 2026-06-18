// 경기 보드 수정 타깃 측정 — "회귀 0"이 아니라 "의도대로 바뀌었나"를 수치로 확인.
//   npx tsx tools/checkBoardFixes.ts [경기수=10]
// 측정: ③ 서브 리시브 패서 깊이(3m 라인 뒤인가) ⑦ 터치아웃 공이 멀리 나가고 추격이 떨어졌나
//       ⑧ 서브팀이 상대 리시브(pass) 구간에 이미 수비 전환을 시작했나(serveFormation→수비)
import { resetLeagueBase, getEvolvedTeamPlayers, coachInfoOf, LEAGUE } from '../data/league';
import { simulateMatch } from '../engine/match';
import { buildLineup } from '../engine/lineup';
import { ballPath, type Lineups } from '../components/courtPath';
import { segmentTargets, reconstructRallies } from '../components/courtDirector';
import { receiveLine, receiveFormation, serveFormation, switchedSpots, lineupIdxAt } from '../components/courtLayout';
import type { Side } from '../types';

const W = 360, H = 500, SERVE_OUT = 22;
const log = (m: string) => process.stdout.write(m + '\n');
const N = Math.max(1, Number(process.argv[2]) || 10);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

resetLeagueBase();
const teams = LEAGUE.teams.map((t) => t.id);

// ③ 패서 깊이
let passerN = 0, passerBehindLine = 0; const passerYs: number[] = [];
// ⑦ 터치아웃
const outBeyond: number[] = []; const outChaserGap: number[] = [];
// ⑧ 서브팀 전환: pass 구간 서브팀 위치가 serveFormation 보다 수비(switched)에 더 가까운 비율
let passSegs = 0, transitioningSegs = 0;

for (let m = 0; m < N; m++) {
  const hId = teams[m % teams.length], aId = teams[(m + 1) % teams.length];
  const hPs = getEvolvedTeamPlayers(hId, 0), aPs = getEvolvedTeamPlayers(aId, 0);
  const L: Lineups = { home: buildLineup(hPs), away: buildLineup(aPs) };
  const seed = 313131 + m * 7919;
  const sim = simulateMatch(seed, hPs, aPs, { home: coachInfoOf(hId), away: coachInfoOf(aId) });
  const rallies = reconstructRallies(sim);
  let prevLast: { x: number; y: number } | undefined;
  const lastTargets: Record<string, { x: number; y: number }> = {};

  for (const r of rallies) {
    const path = ballPath(r, seed, L, W, H, SERVE_OUT, prevLast);
    prevLast = path.length ? { x: path[path.length - 1].x, y: path[path.length - 1].y } : prevLast;
    const stage = { serving: r.serving, homeRot: r.homeRot, awayRot: r.awayRot };
    const recv: Side = r.serving === 'home' ? 'away' : 'home';

    // ③ 패서 깊이 — 받는 팀 receiveFormation 의 패서 y vs 3m 라인(home 0.66H / away 0.34H)
    {
      const lu = recv === 'home' ? L.home : L.away;
      const rot = recv === 'home' ? r.awayRot : r.homeRot; // recv 팀 rot
      const rotRecv = recv === 'home' ? stage.homeRot : stage.awayRot;
      const rf = receiveFormation(recv, lu, rotRecv, W, H);
      const line = receiveLine(lu, rotRecv);
      const lineY = (recv === 'home' ? 0.66 : 0.34) * H;
      for (const i of line) {
        const y = rf[i].y; passerYs.push(y); passerN++;
        const behind = recv === 'home' ? y > lineY : y < lineY; // 3m 라인보다 깊은가(엔드라인 쪽)
        if (behind) passerBehindLine++;
      }
      void rot;
    }

    // ⑧ 서브팀 전환 — pass 구간에서 서브팀(수비) 목표가 serveFormation 보다 switched(수비)에 가까운가
    for (let k = 0; k + 1 < path.length; k++) {
      const seg = { from: path[k], to: path[k + 1] };
      const targets = segmentTargets(seg, stage, L, W, H, SERVE_OUT, lastTargets);
      for (const key of Object.keys(targets)) lastTargets[key] = targets[key];
      if (seg.to.kind === 'pass' && seg.to.side === recv) {
        // 상대(recv)가 리시브/패스 중 = 서브팀은 수비 전환해야
        const sv = r.serving;
        const luSv = sv === 'home' ? L.home : L.away;
        const rotSv = sv === 'home' ? stage.homeRot : stage.awayRot;
        const sf = serveFormation(sv, luSv, rotSv, W, H);
        const def = switchedSpots(sv, luSv, rotSv, false, W, H).pos;
        let dServe = 0, dDef = 0, cnt = 0;
        for (let i = 0; i < 6; i++) {
          const t = targets[`${sv}-${i}`]; if (!t) continue;
          // 서버(zone1)는 베이스라인이라 제외
          if (lineupIdxAt(rotSv, 1) === i) continue;
          dServe += dist(t, sf[i]); dDef += dist(t, def[i]); cnt++;
        }
        if (cnt > 0) { passSegs++; if (dDef < dServe) transitioningSegs++; }
        break; // 랠리당 첫 pass 구간만
      }
    }

    // ⑦ 터치아웃 — fault 아웃볼의 경계 이탈 거리 + 추격 최근접
    if (r.how === 'blockout') {
      for (let k = 0; k < path.length; k++) {
        const wp = path[k];
        if (wp.kind !== 'fault') continue;
        const out = wp.x < 0 || wp.x > W || wp.y < 0 || wp.y > H;
        if (!out) continue;
        const beyond = Math.max(wp.x < 0 ? -wp.x : wp.x > W ? wp.x - W : 0, wp.y < 0 ? -wp.y : wp.y > H ? wp.y - H : 0);
        outBeyond.push(beyond);
        if (wp.movers && wp.movers.length) outChaserGap.push(Math.min(...wp.movers.map((mv) => dist(mv, wp))));
        break;
      }
    }
  }
}

const med = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const M_PER_PX = 9 / W;
log(`\n③ 서브 리시브 패서 깊이 (N=${passerN})`);
log(`  3m 라인 뒤(엔드라인 쪽) 비율: ${(100 * passerBehindLine / passerN).toFixed(0)}%  (목표: 패서는 라인 뒤에서 받는다)`);
log(`  패서 y 중앙값: ${(med(passerYs) / H).toFixed(3)}·H  (home 3m 라인 = 0.66·H)`);
log(`\n⑦ 터치아웃 아웃볼 (N=${outBeyond.length})`);
log(`  경계 이탈 중앙값: ${med(outBeyond).toFixed(0)}px (${(med(outBeyond) * M_PER_PX).toFixed(1)}m)  (목표: 멀리 — >40px)`);
log(`  추격 최근접 중앙값: ${med(outChaserGap).toFixed(0)}px (${(med(outChaserGap) * M_PER_PX).toFixed(1)}m)  (목표: 떨어져 지켜봄 — >60px)`);
log(`\n⑧ 서브팀 수비 전환 타이밍 (pass 구간 N=${passSegs})`);
log(`  상대 리시브(pass) 중 이미 수비 쪽으로 전환 중: ${(100 * transitioningSegs / Math.max(1, passSegs)).toFixed(0)}%  (목표: 높음 — 공격 전 전환)`);
log('완료.');
