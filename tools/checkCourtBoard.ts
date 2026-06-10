// 경기 보드 위치 전수 검사 — 모든 (팀 × 사이드 × 로테이션 × 국면)의 마커 좌표 무결성.
//   npx tsx tools/checkCourtBoard.ts
// 검사: ①코트 경계 ②자기 진영 ③마커 겹침(최소 간격) ④역할 배치(리베로 네트 금지·
//   전위 MB 네트·패서 라인 구성) ⑤리베로 표시 교체 정합 ⑥세터 은신/침투 위치.

import { resetLeagueBase, getEvolvedTeamPlayers, LEAGUE } from '../data/league';
import { buildLineup } from '../engine/lineup';
import {
  receiveFormation, switchedSpots, playerAtZone, displayPos, zoneOfIdx, zonePx,
} from '../components/courtLayout';
import type { Side } from '../types';

const W = 360, H = 500; // 대표 보드 크기(폰)
const MIN_DIST = 26;    // 마커 지름(30px) 대비 최소 간격 — 이보다 가까우면 "겹침"
const log = (m: string) => process.stdout.write(m + '\n');

let checks = 0;
const issues: string[] = [];
const flag = (msg: string) => { issues.push(msg); };

function inOwnHalf(side: Side, y: number): boolean {
  return side === 'home' ? y >= 0.5 * H && y <= H : y >= 0 && y <= 0.5 * H;
}

resetLeagueBase();
for (const team of LEAGUE.teams) {
  const lu = buildLineup(getEvolvedTeamPlayers(team.id, 0));
  for (const side of ['home', 'away'] as Side[]) {
    for (let rot = 0; rot < 6; rot++) {
      const ctx = `${team.name.split(' ').slice(-1)[0]}/${side}/rot${rot}`;

      // ── 국면별 좌표 수집 ──
      const phases: Record<string, Record<number, { x: number; y: number }>> = {
        '리시브대형': receiveFormation(side, lu, rot, W, H),
        '스위칭(공격)': switchedSpots(side, lu, rot, true, W, H).pos,
        '스위칭(수비)': switchedSpots(side, lu, rot, false, W, H).pos,
      };

      for (const [phase, pos] of Object.entries(phases)) {
        const pts = [0, 1, 2, 3, 4, 5].map((i) => ({ i, ...pos[i] }));
        for (const p of pts) {
          checks++;
          // ① 경계 ② 자기 진영
          if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) flag(`${ctx} ${phase}: idx${p.i} 코트 밖 (${p.x.toFixed(0)},${p.y.toFixed(0)})`);
          else if (!inOwnHalf(side, p.y)) flag(`${ctx} ${phase}: idx${p.i} 상대 진영 침범 y=${p.y.toFixed(0)}`);
        }
        // ③ 겹침
        for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) {
          checks++;
          const d = Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y);
          if (d < MIN_DIST) flag(`${ctx} ${phase}: idx${pts[a].i}↔idx${pts[b].i} 겹침 ${d.toFixed(0)}px (${displayPos(lu, rot, pts[a].i)}·${displayPos(lu, rot, pts[b].i)})`);
        }
      }

      // ④ 역할 배치 — 리시브 대형
      const rf = phases['리시브대형'];
      const netY = side === 'home' ? 0.64 * H : 0.36 * H; // 이 선 안쪽(네트 쪽)이면 "네트 근처"
      const deepY = side === 'home' ? 0.74 * H : 0.26 * H;
      for (let i = 0; i < 6; i++) {
        checks++;
        const d = displayPos(lu, rot, i);
        const nearNet = side === 'home' ? rf[i].y < netY : rf[i].y > netY;
        const inPassLine = side === 'home' ? rf[i].y >= deepY : rf[i].y <= deepY;
        if (d === 'L' && nearNet) flag(`${ctx} 리시브: 리베로(표시)가 네트 근처 y=${rf[i].y.toFixed(0)} — 공격 불가 포지션`);
        if (d === 'MB' && !zBack(rot, i) && inPassLine) flag(`${ctx} 리시브: 전위 MB가 리시브 라인 y=${rf[i].y.toFixed(0)} — 비현실`);
      }
      // 패서 라인 구성 = 표시 기준 L+OH 3인(엔진 receivers()와 동일)이어야
      const passLine = [0, 1, 2, 3, 4, 5].filter((i) => (side === 'home' ? rf[i].y >= deepY : rf[i].y <= deepY));
      checks++;
      if (passLine.length !== 3) flag(`${ctx} 리시브: 패서 라인 ${passLine.length}명(3명이어야)`);
      else {
        const kinds = passLine.map((i) => displayPos(lu, rot, i)).sort().join(',');
        if (kinds !== 'L,OH,OH') flag(`${ctx} 리시브: 패서 구성 ${kinds} (기대 L,OH,OH)`);
      }

      // ⑤ 리베로 표시 교체 — 후위 MB만 L, 전위는 절대 L 금지
      for (let z = 1; z <= 6; z++) {
        checks++;
        const p = playerAtZone(lu, rot, z);
        const back = z === 1 || z === 5 || z === 6;
        if (!back && p.position === 'L') flag(`${ctx}: 리베로가 전위 zone${z}에!`);
        if (back && lu.libero && lu.six[(rot + z - 1) % 6].position === 'MB' && p.position !== 'L')
          flag(`${ctx}: 후위 MB(zone${z})가 리베로 교체 안 됨`);
      }

      // ⑥ 스위칭(공격) 세터 침투 — 네트 근접·우측(홈 기준), 자기 진영
      const swo = switchedSpots(side, lu, rot, true, W, H);
      if (swo.setterIdx >= 0) {
        checks++;
        const sp = swo.pos[swo.setterIdx];
        const nearNet2 = side === 'home' ? sp.y <= 0.6 * H : sp.y >= 0.4 * H;
        if (!nearNet2) flag(`${ctx} 스위칭(공격): 세터 침투 위치가 네트에서 멂 y=${sp.y.toFixed(0)}`);
      }
    }
  }
}

function zBack(rot: number, i: number): boolean { const z = zoneOfIdx(rot, i); return z === 1 || z === 5 || z === 6; }

// 서브 위치(전 로테이션 공통 — zone1 px 기준 엔드라인 뒤는 MatchCourt에서 별도 오프셋) sanity
for (const side of ['home', 'away'] as Side[]) {
  for (let z = 1; z <= 6; z++) {
    const p = zonePx(side, z, W, H);
    checks++;
    if (!inOwnHalf(side, p.y) || p.x < 0 || p.x > W) issues.push(`zonePx ${side}/zone${z} 이상 (${p.x},${p.y})`);
  }
}

log(`\n═══ 경기 보드 위치 전수 검사 — ${LEAGUE.teams.length}팀 × 2사이드 × 6로테이션 × 3국면 ═══`);
log(`검사 항목 ${checks}건`);
if (issues.length === 0) log(`✅ 이상 위치 0건 — 경계·진영·겹침·역할 배치·리베로 교체·세터 침투 모두 정상`);
else {
  log(`❌ 이상 ${issues.length}건:`);
  for (const m of issues.slice(0, 40)) log(`  · ${m}`);
  if (issues.length > 40) log(`  … 외 ${issues.length - 40}건`);
}
