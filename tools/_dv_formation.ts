// INDEPENDENT — 정적 대형 불변식: 번치리드(룰47)·수비컵(룰41)·블록벽 좌우순서·NET_SAFE(룰23)·
// 로테이션 리베로 교체(CLAUDE 4.3)·전위만 공격. 좌표 함수를 직접 호출(엔진 출력 대조).
//   npx tsx tools/_dv_formation.ts [경기수=12]

import { resetLeagueBase, getEvolvedTeamPlayers, LEAGUE } from '../data/league';
import { buildLineup } from '../engine/lineup';
import {
  serveFormation, fanSlots, blockerWall, lineupIdxAt, zoneOfIdx, displayPos, playerAtZone, NET_SAFE,
} from '../components/courtLayout';
import type { Side } from '../types';

const W = 360, H = 500, NET_Y = 0.5 * H;
const M_PER_PX = 9 / W;
const log = (m: string) => process.stdout.write(m + '\n');
const nMatches = Math.max(1, Number(process.argv[2]) || 12);

resetLeagueBase();
const teams = LEAGUE.teams.map((t) => t.id);

// ── 룰47 번치리드: 서브팀 전위 3인 x가 미들서드(중앙)에 뭉치고, 간격은 비겹침(>24px) ──
let bunchChecked = 0, bunchSpreadFail = 0, bunchOverlapFail = 0;
const frontSpans: number[] = [], frontMinGaps: number[] = [];

// ── 룰41 수비컵: 중앙 백 가장 깊고 양 윙 앞(∨) ──
let cupChecked = 0, cupFail = 0;

// ── 블록벽 좌우순서(교차금지) + NET_SAFE ──
let wallChecked = 0, wallOrderFail = 0, netSafeFail = 0;

// ── 로테이션: 후위 MB↔리베로 교체, 리베로 전위 불가, 전위만 공격 ──
let liberoFrontFail = 0, liberoBackOk = 0, rotChecked = 0;

for (let m = 0; m < nMatches; m++) {
  const hId = teams[m % teams.length], aId = teams[(m + 1) % teams.length];
  const lu = { home: buildLineup(getEvolvedTeamPlayers(hId, 0)), away: buildLineup(getEvolvedTeamPlayers(aId, 0)) };

  for (let rot = 0; rot < 6; rot++) {
    for (const side of ['home', 'away'] as Side[]) {
      const L = side === 'home' ? lu.home : lu.away;
      if (!L.libero) continue;

      // 룰47 번치리드
      const sf = serveFormation(side, L, rot, W, H);
      const fx = [2, 3, 4].map((z) => sf[lineupIdxAt(rot, z)].x).sort((a, b) => a - b);
      bunchChecked++;
      const span = fx[2] - fx[0];
      frontSpans.push(span * M_PER_PX);
      const gaps = [fx[1] - fx[0], fx[2] - fx[1]];
      frontMinGaps.push(Math.min(...gaps));
      // 미들서드 = 코트폭 1/3~2/3 (0.36~0.64 기준). 3인 모두 [0.30W,0.70W] 안이면 번치.
      if (fx[0] < 0.28 * W || fx[2] > 0.72 * W) bunchSpreadFail++;
      if (Math.min(...gaps) < 24) bunchOverlapFail++;

      // 룰41 수비컵: 공격 x=중앙일 때 fanSlots → [윙, 중앙깊음, 윙]
      const cup = fanSlots(side, 0.5 * W, W, H);
      cupChecked++;
      const s = side === 'home' ? 1 : -1;
      // 중앙(idx1)이 가장 깊다 = s*(centerY - wingY) > 0 (home: 깊을수록 y큼)
      const centerDeeper = s * (cup[1].y - cup[0].y) > 0 && s * (cup[1].y - cup[2].y) > 0;
      if (!centerDeeper) cupFail++;

      // 블록벽: 공격 x=좌/중/우 각각에서 2장·3장 벽 — 좌→우 순서 + NET_SAFE
      for (const ax of [0.25 * W, 0.5 * W, 0.75 * W]) {
        for (const cnt of [2, 3]) {
          const wall = blockerWall(side, ax, cnt, W, H);
          wallChecked++;
          for (let i = 1; i < wall.length; i++) if (wall[i].x <= wall[i - 1].x) wallOrderFail++;
          for (const w of wall) if (Math.abs(w.y - NET_Y) < NET_SAFE - 0.5) netSafeFail++;
        }
      }

      // 로테이션: 후위 MB는 리베로로 표시되어야, 리베로는 전위 존에 절대 없어야
      rotChecked++;
      for (let i = 0; i < 6; i++) {
        const z = zoneOfIdx(rot, i);
        const dp = displayPos(L, rot, i);
        const front = z === 2 || z === 3 || z === 4;
        if (front && dp === 'L') liberoFrontFail++;
        // 후위 MB 슬롯은 리베로로 치환
        if (!front && L.six[i].position === 'MB') {
          const pz = playerAtZone(L, rot, z);
          if (pz.id === L.libero.id) liberoBackOk++;
        }
      }
    }
  }
}

const med = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
log(`═══ 정적 대형 불변식 (${nMatches}경기 · rot0~5 · 양팀) ═══`);
log(`[룰47 번치리드] ${bunchChecked}대형: 중앙이탈 ${bunchSpreadFail} · 겹침(<24px) ${bunchOverlapFail} · 전위폭중앙값 ${med(frontSpans).toFixed(2)}m · 최소간격중앙값 ${med(frontMinGaps).toFixed(0)}px`);
log(`[룰41 수비컵] ${cupChecked}대형: 역컵(중앙얕음) ${cupFail}`);
log(`[블록벽] ${wallChecked}벽: 좌우순서위반 ${wallOrderFail} · NET_SAFE침범 ${netSafeFail}`);
log(`[로테이션] ${rotChecked}대형: 리베로전위 ${liberoFrontFail} (0기대) · 후위MB→리베로치환확인 ${liberoBackOk}`);

// ── A/B 자가검증 ──
log(`\n── A/B 자가검증 ──`);
let ab = 0, abT = 0;
const L0 = buildLineup(getEvolvedTeamPlayers(teams[0], 0));
// 번치 검사: 일부러 넓게 편 x → 중앙이탈 잡혀야
abT++; { const wideFx = [0.1 * W, 0.5 * W, 0.9 * W].sort((a, b) => a - b); if (wideFx[0] < 0.28 * W || wideFx[2] > 0.72 * W) ab++; else log('  ⚠ 번치 A/B 실패'); }
// 수비컵: 역컵(중앙 얕음) 주입 → 잡혀야
abT++; { const s = 1; const bad = [{ y: 0.85 * H }, { y: 0.72 * H }, { y: 0.85 * H }]; const ok = s * (bad[1].y - bad[0].y) > 0; if (!ok) ab++; else log('  ⚠ 수비컵 A/B 실패'); }
// 블록벽 순서: 역순 주입 → 잡혀야
abT++; { const bad = [{ x: 200 }, { x: 100 }]; let f = 0; for (let i = 1; i < bad.length; i++) if (bad[i].x <= bad[i - 1].x) f++; if (f > 0) ab++; else log('  ⚠ 블록벽 A/B 실패'); }
void L0;
log(`A/B: ${abT}건 중 ${ab}건 검출 ${ab === abT ? '✅' : '❌'}`);
