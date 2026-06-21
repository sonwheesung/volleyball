// INDEPENDENT VERIFICATION (검증자 세션, 수정 금지) — 서브 컨택 오버랩 합법성.
//
// 불변식 출처(문서에서 도출, 코드 베끼지 않음):
//   - BOARD_RULES 룰 Q(18)·45 + CLAUDE 4.3 로테이션 + 실제 배구 오버랩 규칙.
//   - 서브 임팩트 순간, 코트의 6명은 인접 로테이션 순서를 지켜야 한다:
//       · 같은 행(좌/중/우 열쌍): 전위가 후위보다 네트에 가깝다  (zone 4<5, 3<6, 2<1)
//       · 같은 행(전위 3 / 후위 3): 좌<중<우  (전위 4<3<2, 후위 5<6<1)
//   - **세터 포함**(룰 45의 핵심 교정 — 받는 팀 후위 세터가 전위 패서보다 깊어야).
//   - 면제는 **서버만**(zone1, 서브하러 베이스라인 뒤로). 받는 팀은 면제 0.
//   - 검사 시점 = 서브 컨택 직전 READY 대형: 서브팀 serveFormation / 받는팀 receiveFormation.
//
// 이 검사는 auditBoard.overlapViolations 를 재사용하지 않고 **독립 구현**한다(허위 오라클 회피).
// 좌표계: home 하단(네트 가까울수록 y작음), away 상단(점대칭). 좌측 x작음.
//
//   npx tsx tools/_dv_overlap.ts [경기수=12]

import { resetLeagueBase, getEvolvedTeamPlayers, LEAGUE } from '../data/league';
import { buildLineup } from '../engine/lineup';
import { serveFormation, receiveFormation, lineupIdxAt } from '../components/courtLayout';
import type { Side } from '../types';

const W = 360, H = 500;
const log = (m: string) => process.stdout.write(m + '\n');
const nMatches = Math.max(1, Number(process.argv[2]) || 12);

type Px = { x: number; y: number };

// 독립 오버랩 검사 — ready 대형 좌표 + 라인업 인덱스만으로 위반 도출.
// EPS 0: 정확히 동률/역전이면 위반(문서: "순서를 지켜야"). 미세 흔들기(jit)는 순서를 안 바꾸므로 통과해야 정상.
function overlapCheck(side: Side, rot: number, pos: Record<number, Px>, serverExempt: boolean): string[] {
  const s = side === 'home' ? 1 : -1; // home: 작은 y가 네트, away: 큰 y가 네트 → s로 정규화
  const idxAt = (z: number) => lineupIdxAt(rot, z);
  const P = (z: number) => pos[idxAt(z)];
  const serverIdx = idxAt(1);
  const exempt = (z: number) => serverExempt && idxAt(z) === serverIdx;
  const v: string[] = [];
  // 같은 열: 전위가 후위보다 네트에 가깝다 → s*(yBack - yFront) > 0 이어야 합법
  const colPair = (fz: number, bz: number, n: string) => {
    if (exempt(fz) || exempt(bz)) return;
    if (s * (P(bz).y - P(fz).y) <= 0) v.push(`${n}(전후역전 z${fz}/${bz} y=${P(fz).y.toFixed(0)}/${P(bz).y.toFixed(0)})`);
  };
  // 같은 행 좌<중<우 → s*(xRight - xLeft) > 0 합법
  const rowPair = (lz: number, rz: number, n: string) => {
    if (exempt(lz) || exempt(rz)) return;
    if (s * (P(rz).x - P(lz).x) <= 0) v.push(`${n}(좌우역전 z${lz}/${rz} x=${P(lz).x.toFixed(0)}/${P(rz).x.toFixed(0)})`);
  };
  colPair(4, 5, '좌열'); colPair(3, 6, '중열'); colPair(2, 1, '우열');
  rowPair(4, 3, '전위LC'); rowPair(3, 2, '전위CR'); rowPair(5, 6, '후위LC'); rowPair(6, 1, '후위CR');
  return v;
}

resetLeagueBase();
const teams = LEAGUE.teams.map((t) => t.id);

interface Stat { checked: number; violations: number; samples: string[] }
const recvStat: Stat = { checked: 0, violations: 0, samples: [] };
const servStat: Stat = { checked: 0, violations: 0, samples: [] };

for (let m = 0; m < nMatches; m++) {
  const hId = teams[m % teams.length];
  const aId = teams[(m + 1) % teams.length];
  const lu = { home: buildLineup(getEvolvedTeamPlayers(hId, 0)), away: buildLineup(getEvolvedTeamPlayers(aId, 0)) };
  // 전 로테이션 0~5 · 양 팀 · 서브팀/받는팀 두 역할 모두 시험
  for (let rot = 0; rot < 6; rot++) {
    for (const side of ['home', 'away'] as Side[]) {
      const L = side === 'home' ? lu.home : lu.away;
      // 받는 팀 역할(receiveFormation, 세터 포함, 서버 면제 없음)
      {
        const pos = receiveFormation(side, L, rot, W, H);
        const v = overlapCheck(side, rot, pos, false);
        recvStat.checked++;
        if (v.length) { recvStat.violations++; if (recvStat.samples.length < 8) recvStat.samples.push(`경기${m} ${side} rot${rot}: ${v.join(' · ')}`); }
      }
      // 서브 팀 역할(serveFormation, 서버 zone1 면제)
      {
        const pos = serveFormation(side, L, rot, W, H);
        const v = overlapCheck(side, rot, pos, true);
        servStat.checked++;
        if (v.length) { servStat.violations++; if (servStat.samples.length < 8) servStat.samples.push(`경기${m} ${side} rot${rot}: ${v.join(' · ')}`); }
      }
    }
  }
}

log(`═══ 독립 서브 오버랩 검증 (${nMatches}경기 · rot0~5 · 양팀 · 세터포함) ═══`);
log(`받는팀(receiveFormation): ${recvStat.checked}대형 검사, 위반 ${recvStat.violations}`);
recvStat.samples.forEach((s) => log('  ✗ ' + s));
log(`서브팀(serveFormation, 서버면제): ${servStat.checked}대형 검사, 위반 ${servStat.violations}`);
servStat.samples.forEach((s) => log('  ✗ ' + s));

// ── A/B 자가검증(허위 오라클 방지): 일부러 틀린 위치 주입 → 반드시 fail 해야 ──
log(`\n── A/B 자가검증: 틀린 입력에 fail 하는가 ──`);
const L0 = buildLineup(getEvolvedTeamPlayers(teams[0], 0));
let abPass = 0, abTotal = 0;

// (A) 받는팀 후위 세터를 전위 패서보다 앞으로(네트로) 끌어 전후 역전 주입 → colPair 위반 기대
for (let rot = 0; rot < 6; rot++) {
  const pos = receiveFormation('home', L0, rot, W, H);
  const sIdx = L0.six.findIndex((p) => p.position === 'S');
  const sZone = ((sIdx - rot) % 6 + 6) % 6 + 1;
  if (sZone === 1 || sZone === 5 || sZone === 6) { // 세터가 후위일 때만
    abTotal++;
    const bad = { ...pos };
    bad[sIdx] = { x: pos[sIdx].x, y: 0.55 * H }; // 네트 쪽으로(전위 패서 0.75보다 앞)
    const v = overlapCheck('home', rot, bad, false);
    if (v.length > 0) abPass++; else log(`  ⚠ rot${rot} 후위세터 역전 주입했는데 통과(오라클 결함!)`);
  }
}
// (B) 전위 좌우 뒤집기(zone4와 zone2 x 스왑) → rowPair 위반 기대
for (let rot = 0; rot < 6; rot++) {
  abTotal++;
  const pos = receiveFormation('home', L0, rot, W, H);
  const i4 = lineupIdxAt(rot, 4), i2 = lineupIdxAt(rot, 2);
  const bad = { ...pos };
  const tmp = bad[i4].x; bad[i4] = { x: bad[i2].x, y: bad[i4].y }; bad[i2] = { x: tmp, y: bad[i2].y };
  const v = overlapCheck('home', rot, bad, false);
  if (v.length > 0) abPass++; else log(`  ⚠ rot${rot} 전위 좌우스왑 주입했는데 통과(오라클 결함!)`);
}
log(`A/B: 틀린입력 ${abTotal}건 중 ${abPass}건 검출 ${abPass === abTotal ? '✅ (오라클 유효)' : '❌ (오라클 결함)'}`);
log(`\n결론: ${recvStat.violations === 0 && servStat.violations === 0 ? '✅ 정상입력 위반 0 + 오라클 유효' : '❌ 위반 발견'}`);
