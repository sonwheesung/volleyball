// INDEPENDENT — 서브 리시브 패서 레인 3등분 가드(COURT_POSITIONING A-1 · BOARD_RULES 룰 69).
// 존 컬럼 고정(RF_*_X)이 4/6 로테이션에서 패서 3인을 한쪽에 뭉치게 해 반대편이 무패서로 비었다
// (rot2/5 좌측 절반 공백, 최대 무패서 구간 1.04W). receiveFormation 레인 재분배가 이를 해소하는지 검증.
//
// 불변식(문서에서 도출 — 코드 베끼지 않음):
//   ① 최대 무패서 구간 ≤ 0.55W  — 패서 x 정렬 후 gaps=[좌끝×2, 사이들, 우끝×2] 최대값.
//   ② 오버랩 합법(룰 Q) 위반 0  — 같은 행 인접 존 좌<중<우, 같은 열 전위<후위(receiveFormation 좌표 직접).
//   ③ 결정론  — 2회 호출 바이트 동일.
//   ④ A/B: 구 로직(존 컬럼 고정)을 가드 안에서 재계산 → 4/6 로테이션에서 ①이 FAIL 함을 증명.
//
//   npx tsx tools/_dv_receive_lanes.ts

import { resetLeagueBase, getEvolvedTeamPlayers, LEAGUE } from '../data/league';
import { buildLineup } from '../engine/lineup';
import { receiveFormation, receiveLine, zoneOfIdx, lineupIdxAt } from '../components/courtLayout';
import type { Side } from '../types';

const W = 360, H = 500;
const log = (m: string) => process.stdout.write(m + '\n');
const GAP_MAX = 0.55; // W 프랙션

// 구 존컬럼 로직 재구성(A/B 전용) — receiveFormation 폐기 전 패서 x 산식(문서 상수).
const RF_FRONT_X = [0.21, 0.50, 0.79];
const RF_BACK_X = [0.13, 0.55, 0.87];
const lateralRank = (zone: number): number => (zone === 4 || zone === 5 ? 0 : zone === 3 || zone === 6 ? 1 : 2);
const isBack = (z: number) => z === 1 || z === 5 || z === 6;

// 패서 x(프랙션) → 최대 무패서 구간. 좌우 미러 무관(대칭 지표)이라 x/W 그대로.
function maxGap(fracs: number[]): number {
  const s = fracs.slice().sort((a, b) => a - b);
  const gaps = [2 * s[0]];
  for (let k = 1; k < s.length; k++) gaps.push(s[k] - s[k - 1]);
  gaps.push(2 * (1 - s[s.length - 1]));
  return Math.max(...gaps);
}

// 오버랩 독립 검사(auditBoard.overlapViolations 미재사용) — receiveFormation 좌표 + 라인업 인덱스로 도출.
function overlapViol(side: Side, rot: number, pos: Record<number, { x: number; y: number }>): string[] {
  const s = side === 'home' ? 1 : -1; // home: 작은 y가 네트, 작은 x가 좌
  const P = (z: number) => pos[lineupIdxAt(rot, z)];
  const v: string[] = [];
  const col = (fz: number, bz: number, n: string) => { if (s * (P(bz).y - P(fz).y) <= 0) v.push(`${n}(전후역전 z${fz}/${bz})`); };
  const row = (lz: number, rz: number, n: string) => { if (s * (P(rz).x - P(lz).x) <= 0) v.push(`${n}(좌우역전 z${lz}/${rz})`); };
  col(4, 5, '좌열'); col(3, 6, '중열'); col(2, 1, '우열');
  row(4, 3, '전위LC'); row(3, 2, '전위CR'); row(5, 6, '후위LC'); row(6, 1, '후위CR');
  return v;
}

resetLeagueBase();
const teams = LEAGUE.teams.map((t) => t.id);

let checked = 0, gapFail = 0, overlapFail = 0, detFail = 0;
let worstGap = 0; let worstAt = '';
const ex: string[] = [];
const gapByRot: number[][] = [[], [], [], [], [], []];

for (let m = 0; m < teams.length; m++) {
  const lu = buildLineup(getEvolvedTeamPlayers(teams[m], 0));
  for (let rot = 0; rot < 6; rot++) {
    const recv = receiveLine(lu, rot);
    for (const side of ['home', 'away'] as Side[]) {
      const pos = receiveFormation(side, lu, rot, W, H);
      const pos2 = receiveFormation(side, lu, rot, W, H);
      checked++;
      // ③ 결정론
      if (JSON.stringify(pos) !== JSON.stringify(pos2)) { detFail++; if (ex.length < 16) ex.push(`team${m} ${side} rot${rot} 비결정론`); }
      // ① 무패서 구간
      const fracs = recv.map((i) => pos[i].x / W);
      const g = maxGap(fracs);
      gapByRot[rot].push(g);
      if (g > worstGap) { worstGap = g; worstAt = `team${m} ${side} rot${rot}`; }
      if (g > GAP_MAX) { gapFail++; if (ex.length < 16) ex.push(`team${m} ${side} rot${rot} 무패서구간 ${g.toFixed(3)}W (≤${GAP_MAX} 기대) 패서x=[${fracs.map((f) => f.toFixed(2)).join(',')}]`); }
      // ② 오버랩
      const v = overlapViol(side, rot, pos);
      if (v.length) { overlapFail++; if (ex.length < 16) ex.push(`team${m} ${side} rot${rot} 오버랩 ${v.join(' · ')}`); }
    }
  }
}

log('═══ 서브 리시브 패서 레인 3등분 (전 팀·rot0~5·양 사이드) ═══');
log(`검사 ${checked}대형`);
log(`① 최대 무패서 구간 ≤ ${GAP_MAX}W: FAIL ${gapFail} · 최악 ${worstGap.toFixed(3)}W @ ${worstAt}`);
log(`② 오버랩(룰 Q) 위반: FAIL ${overlapFail}`);
log(`③ 결정론(2회 바이트 동일): FAIL ${detFail}`);
log(`로테이션별 무패서 구간 중앙값: ${gapByRot.map((a, r) => { const s = a.slice().sort((x, y) => x - y); return `rot${r}=${(s[Math.floor(s.length / 2)] ?? 0).toFixed(2)}`; }).join(' · ')}`);
ex.forEach((e) => log('  ⚠ ' + e));

// ── ④ A/B: 구 존컬럼 로직이면 4/6 로테이션에서 ① FAIL 함을 증명 ──
log(`\n── A/B 자가검증: 구 존컬럼 로직(RF_*_X 고정)이면 무패서 구간이 터지는가 ──`);
let oldFailRots = 0; const oldByRot: string[] = [];
for (let rot = 0; rot < 6; rot++) {
  // 팀0 홈 기준 구 패서 x 재구성(수정 전 산식)
  const lu = buildLineup(getEvolvedTeamPlayers(teams[0], 0));
  const recv = receiveLine(lu, rot);
  const fracs = recv.map((i) => { const z = zoneOfIdx(rot, i); return (isBack(z) ? RF_BACK_X : RF_FRONT_X)[lateralRank(z)]; });
  const g = maxGap(fracs);
  const bad = g > GAP_MAX;
  if (bad) oldFailRots++;
  oldByRot.push(`rot${rot}=${g.toFixed(2)}W${bad ? ' ✗' : ''}`);
}
log(`구 로직 무패서 구간: ${oldByRot.join(' · ')}`);
log(`구 로직 FAIL 로테이션 ${oldFailRots}개 ${oldFailRots > 0 ? '✅ (오라클 유효 — 구 로직은 실제로 터짐)' : '❌ (A/B 무효 — 구 로직도 통과하면 가드가 무의미)'}`);

const pass = gapFail === 0 && overlapFail === 0 && detFail === 0 && oldFailRots > 0;
log(`\n결론: ${pass ? '✅ 레인 3등분 정상 + 오버랩 0 + 결정론 + 구 로직 붕괴 실증' : '❌ 실패'}`);
process.exit(pass ? 0 : 1);
