// INDEPENDENT — 서브리시브 대형 깊이 가드. **2026-06-24 모델 반전**: 평평한 3인 라인(COURT_POSITIONING A-1).
// 신 기준: 전위 **패서**는 후위 패서와 같은 깊이(≈0.79)로 **라인 합류**(depth≥0.74) · 전위 **비패서**(MB/OP)는
// **네트 앞**(depth≤0.68)에 남는다. "후위밴드 침범"은 더는 위반이 아니다(오버랩 합법은 _dv_overlap 가 가드).
// (구 기준: 전위 패서 ≤0.68 W형 — 룰 49, 2026-06-21. 오버랩 룰 재확인으로 폐기.)
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

let checked = 0, frontPasserShallow = 0, frontNonPasserDeep = 0;
const ex: string[] = [];
const depthsFrontPasser: number[] = [], depthsBackPasser: number[] = [], depthsFrontNonPasser: number[] = [];

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
          if (isRecv) {
            depthsFrontPasser.push(d);
            if (d < 0.74) { frontPasserShallow++; if (ex.length < 14) ex.push(`team${m} ${side} rot${rot} z${z} ${displayPos(lu, rot, i)} 전위 패서 라인 미합류 depth=${d.toFixed(3)}(≥0.74 기대)`); }
          } else {
            depthsFrontNonPasser.push(d);
            if (d > 0.68) { frontNonPasserDeep++; if (ex.length < 14) ex.push(`team${m} ${side} rot${rot} z${z} ${displayPos(lu, rot, i)} 전위 비패서 네트 못 떠남 depth=${d.toFixed(3)}(≤0.68 기대)`); }
          }
        } else if (isRecv) depthsBackPasser.push(d);
      }
    }
  }
}

const med = (a: number[]) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
log('═══ 서브리시브 전위 깊이 — 평평한 3인 라인 모델 (전 팀·rot0~5·양 사이드) ═══');
log(`전위(zone2/3/4) 검사 ${checked}건`);
log(`· 전위 패서 라인 합류(depth≥0.74): 미합류 ${frontPasserShallow}건 (0이어야)`);
log(`· 전위 비패서 네트 앞(depth≤0.68): 못 떠남 ${frontNonPasserDeep}건 (0이어야)`);
log(`depth 중앙값 — 전위 패서 ${med(depthsFrontPasser).toFixed(3)} · 후위 패서 ${med(depthsBackPasser).toFixed(3)} · 전위 비패서 ${med(depthsFrontNonPasser).toFixed(3)}`);
log(`(신 모델 2026-06-24: 전위 패서≈후위 패서 깊이로 라인 / 비패서는 네트 ~0.575. 오버랩 합법은 _dv_overlap 가 가드)`);
log(frontPasserShallow === 0 && frontNonPasserDeep === 0 ? '✅ 평평한 라인 정상' : '❌ 라인 어긋남');
ex.forEach((e) => log('  ⚠ ' + e));
