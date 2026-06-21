// INDEPENDENT — 서브리시브 대형: 전위(zone 2/3/4)가 후위 밴드로 내려가는지 측정(사용자 보고 2026-06-21).
// 설계 의도(courtLayout 주석): 전위 ≤0.68 · 후위 ≥0.72 밴드 분리. 전위 패서가 0.75로 내려가면 후위밴드 침범.
//   npx tsx tools/_dv_receive.ts
import { resetLeagueBase, getEvolvedTeamPlayers, LEAGUE } from '../data/league';
import { buildLineup } from '../engine/lineup';
import { receiveFormation, receiveLine, zoneOfIdx, displayPos } from '../components/courtLayout';
import type { Side } from '../types';

const W = 360, H = 500;
const log = (m: string) => process.stdout.write(m + '\n');
resetLeagueBase();
const teams = LEAGUE.teams.map((t) => t.id);
const homeDepth = (side: Side, y: number) => (side === 'home' ? y / H : 1 - y / H); // 네트 0.5 … 베이스라인 1.0

let checked = 0, frontInBack = 0, frontPasserDeep = 0;
const ex: string[] = [];
const depthsFrontPasser: number[] = [], depthsBackPasser: number[] = [];

for (let m = 0; m < teams.length; m++) {
  const lu = buildLineup(getEvolvedTeamPlayers(teams[m], 0));
  if (!lu.libero) continue;
  for (let rot = 0; rot < 6; rot++) {
    const recv = receiveLine(lu, rot);
    for (const side of ['home', 'away'] as Side[]) {
      const pos = receiveFormation(side, lu, rot, W, H);
      for (let i = 0; i < 6; i++) {
        const z = zoneOfIdx(rot, i);
        const front = z === 2 || z === 3 || z === 4;
        const d = homeDepth(side, pos[i].y);
        const isRecv = recv.includes(i);
        if (front) {
          checked++;
          if (isRecv) depthsFrontPasser.push(d);
          if (d >= 0.72) {
            frontInBack++;
            if (isRecv) frontPasserDeep++;
            if (ex.length < 14) ex.push(`team${m} ${side} rot${rot} z${z} ${displayPos(lu, rot, i)} ${isRecv ? '패서' : '비패서'} depth=${d.toFixed(3)}`);
          }
        } else if (isRecv) depthsBackPasser.push(d);
      }
    }
  }
}

const med = (a: number[]) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
log('═══ 서브리시브 전위 깊이 (전 팀·rot0~5·양 사이드) ═══');
log(`전위(zone2/3/4) 검사 ${checked}건 중 **후위밴드(depth≥0.72) 침범 ${frontInBack}건** (그중 전위 패서 ${frontPasserDeep}건)`);
log(`전위 패서 depth 중앙값=${med(depthsFrontPasser).toFixed(3)} · 후위 패서 depth 중앙값=${med(depthsBackPasser).toFixed(3)}`);
log(`(설계 의도: 전위 ≤0.68 · 후위 ≥0.72 — 전위 패서가 0.72↑면 후위밴드 침범 = 사용자 보고 증상)`);
ex.forEach((e) => log('  ⚠ ' + e));
