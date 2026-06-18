// 경기 보드 위치 계산 — React 무의존 순수 모듈(MatchCourt에서 분리, 헤드리스 검증 가능).
// 좌표는 픽셀(코트 W×H 파라미터). 홈=하단, 원정=상단(점대칭).

import type { Player, Position, Side } from '../types';
import type { buildLineup } from '../engine/lineup';

export type Lineup = ReturnType<typeof buildLineup>;
export interface Px { x: number; y: number }

// 존(zone) → 그리드 (col 0~2, row F=전위/B=후위)
const GRID: Record<number, [number, 'F' | 'B']> = {
  4: [0, 'F'], 3: [1, 'F'], 2: [2, 'F'],
  5: [0, 'B'], 6: [1, 'B'], 1: [2, 'B'],
};
const COLX = [0.18, 0.5, 0.82];

// 존별 자연 x(좌우 순서·블로커 정렬용 기준)
export const ZONE_X: Record<number, number> = { 4: 0.22, 3: 0.5, 2: 0.78, 5: 0.18, 6: 0.5, 1: 0.82 };

// 스위칭 좌→우 선호(전문 포지션)
const LANE: Record<Position, number> = { OH: 0, L: 1, MB: 2, S: 3, OP: 4 };

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 로테이션 r 에서 zone 에 선 라인업 인덱스 (zone z → (r+z-1)%6) */
export const lineupIdxAt = (r: number, zone: number) => (r + zone - 1) % 6;
/** 라인업 인덱스 i 가 선 존 */
export const zoneOfIdx = (rot: number, i: number) => ((i - rot) % 6 + 6) % 6 + 1;
const isBackZone = (z: number) => z === 1 || z === 5 || z === 6;

// ── 오버랩 합법 레인 (CLAUDE.md 4.3 로테이션) ──
// 서브 컨택 순간 6명은 인접 기준 로테이션 순서를 지켜야 한다:
//   같은 행 좌→중→우(전위 4·3·2 / 후위 5·6·1), 같은 열 전위가 후위보다 네트에 가깝다(4·5 / 3·6 / 2·1).
// x를 존 가로랭크로만, y를 전/후위 밴드로만 정하면 위 두 순서가 구성상 보장된다.
const LANE_X = [0.17, 0.5, 0.83]; // 좌·중·우 (home 프랙션)
/** 존 → 가로랭크(L0/C1/R2): {4,5}=좌 · {3,6}=중 · {2,1}=우 */
const lateralRank = (zone: number): number => (zone === 4 || zone === 5 ? 0 : zone === 3 || zone === 6 ? 1 : 2);

/** 존 중심 좌표(px) — 홈은 하단, 원정은 상단(좌우·전후 점대칭) */
export function zonePx(side: Side, zone: number, W: number, H: number): Px {
  const [col, row] = GRID[zone];
  const x = (side === 'home' ? COLX[col] : COLX[2 - col]) * W;
  const yF = side === 'home' ? 0.62 : 0.38;
  const yB = side === 'home' ? 0.9 : 0.1;
  return { x, y: (row === 'F' ? yF : yB) * H };
}

/** 화면 표시 포지션 — 후위(1·5·6) MB는 리베로 표시 */
export function displayPos(lu: Lineup, rot: number, i: number): Position {
  const p = lu.six[i];
  if (lu.libero && p?.position === 'MB' && isBackZone(zoneOfIdx(rot, i))) return 'L';
  return p?.position ?? 'OH';
}

/** zone 의 표시 선수(후위 MB → 리베로. 리베로는 전위 불가) */
export function playerAtZone(lu: Lineup, rot: number, zone: number): Player {
  let p = lu.six[lineupIdxAt(rot, zone)];
  if (isBackZone(zone) && lu.libero && p?.position === 'MB') p = lu.libero;
  return p;
}

export interface Switched { pos: Record<number, Px>; setterIdx: number; frontHitters: number[]; backers: number[] }

/** 스위칭(1.5) — 서브 후 전문 포지션. offense=true일 때만 세터가 네트로 침투.
 *  격자 금지: 전위는 살짝 V자(센터가 네트에 더 붙음), 후위는 다이아몬드
 *  (윙 2명 넓고 약간 높게, 중앙 — 대개 리베로 — 이 가장 깊게: 실제 6-백 수비 베이스). */
export function switchedSpots(side: Side, lu: Lineup, rot: number, offense: boolean, W: number, H: number): Switched {
  const front = [2, 3, 4].map((z) => lineupIdxAt(rot, z));
  const back = [1, 5, 6].map((z) => lineupIdxAt(rot, z));
  const posOf = (i: number) => lu.six[i].position;
  const XF = side === 'home' ? [0.2, 0.5, 0.8] : [0.8, 0.5, 0.2];
  const XB = side === 'home' ? [0.15, 0.5, 0.85] : [0.85, 0.5, 0.15];
  const yFw = (side === 'home' ? 0.615 : 0.385) * H;  // 전위 윙
  const yFm = (side === 'home' ? 0.585 : 0.415) * H;  // 전위 중앙(센터) — 네트에 더 붙음
  const yBw = (side === 'home' ? 0.80 : 0.20) * H;    // 후위 윙
  const yBm = (side === 'home' ? 0.905 : 0.095) * H;  // 후위 중앙 — 가장 깊게(리베로)
  const pos: Record<number, Px> = {};
  [...front].sort((a, b) => LANE[posOf(a)] - LANE[posOf(b)]).forEach((i, k) => { pos[i] = { x: XF[k] * W, y: k === 1 ? yFm : yFw }; });
  [...back].sort((a, b) => LANE[posOf(a)] - LANE[posOf(b)]).forEach((i, k) => { pos[i] = { x: XB[k] * W, y: k === 1 ? yBm : yBw }; });
  const setterIdx = lu.six.findIndex((p) => p.position === 'S');
  if (offense && setterIdx >= 0) pos[setterIdx] = { x: (side === 'home' ? 0.63 : 0.37) * W, y: (side === 'home' ? 0.57 : 0.43) * H }; // 공격 시에만 네트 침투
  return { pos, setterIdx, frontHitters: front.filter((i) => i !== setterIdx), backers: back.filter((i) => i !== setterIdx) };
}

// ─── 랠리 중 동적 위치 (수비 부채꼴 / 블로커 벽 / 공격 커버) ───

/** 수비 부채꼴 3슬롯 — 공격 x 쪽으로 살짝 시프트, 중앙 얕게(팁 커버)·양쪽 깊게(라인/크로스).
 *  좌→우 순서 보장: 호출측이 "현재 x 순"으로 정렬한 선수에게 순서대로 배정하면 동선 교차 없음. */
export function fanSlots(side: Side, attackX: number, W: number, H: number): Px[] {
  const shift = (attackX - 0.5 * W) * 0.3;
  const sx = [0.22, 0.5, 0.78].map((b) => clampN(b * W + shift, 22, W - 22));
  const yDeep = (side === 'home' ? 0.84 : 0.16) * H;
  const yMid = (side === 'home' ? 0.72 : 0.28) * H;
  return [{ x: sx[0], y: yDeep }, { x: sx[1], y: yMid }, { x: sx[2], y: yDeep }];
}

/** 블로커 벽 — 공격수 x 정면에 count장(어깨 맞댐). 좌→우 순서로 반환. */
export function blockerWall(side: Side, attackX: number, count: number, W: number, H: number): Px[] {
  const yNet = (side === 'home' ? 0.575 : 0.425) * H;
  const spread = count <= 1 ? [0] : count === 2 ? [-13, 13] : [-22, 0, 22];
  return spread.map((dx) => ({ x: clampN(attackX + dx, 24, W - 24), y: yNet }));
}

/** 공격 커버 — 블록 리바운드 낙하 구역을 감싸는 반원(가까운 2 측면 + 1 깊은 중앙).
 *  전위 공격(타점=네트): 리바운드가 히터 뒤에 떨어짐 → 커버가 뒤(0.68/0.78).
 *  백어택(타점=3m 라인): 리바운드가 히터 앞(네트 쪽)에 떨어짐 → 측면 커버가 앞(0.62), 깊은 커버는 뒤(0.80). */
export function coverSpots(side: Side, attackX: number, n: number, W: number, H: number, backAtk = false): Px[] {
  const yNear = (side === 'home' ? (backAtk ? 0.62 : 0.68) : (backAtk ? 0.38 : 0.32)) * H;
  const yDeep = (side === 'home' ? (backAtk ? 0.80 : 0.78) : (backAtk ? 0.20 : 0.22)) * H;
  const cx = (dx: number) => clampN(attackX + dx, 24, W - 24);
  if (n <= 1) return [{ x: cx(0), y: yNear }];
  if (n === 2) return [{ x: cx(-32), y: yNear }, { x: cx(32), y: yNear }];
  return [{ x: cx(-36), y: yNear }, { x: cx(36), y: yNear }, { x: cx(0), y: yDeep }];
}

/** 같은 팀 마커 최소 간격(px) — 마커 지름 30px의 2/3, 어깨 맞댐(블록 벽 22px)은 보존 */
export const MIN_SEP = 20;

/** 같은 팀 마커 분리 — 한 점에 몰린 목표(추격자·커버·동결+무버 합성)를 어깨 간격으로 벌린다.
 *  결정론(키 정렬 + 고정 반복 완화). 자기 진영 유지(네트 불침범)·추격 마진 내 클램프.
 *  렌더(MatchCourt)와 감사기(auditBoard)가 segmentTargets를 통해 같은 결과를 받는다. */
export function separateTargets(t: Record<string, Px>, W: number, H: number, serveOut: number): Record<string, Px> {
  const out: Record<string, Px> = {};
  for (const k of Object.keys(t)) out[k] = { x: t[k].x, y: t[k].y };
  for (const side of ['home', 'away']) {
    const keys = Object.keys(out).filter((k) => k.startsWith(side)).sort();
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (let a = 0; a < keys.length; a++) for (let b = a + 1; b < keys.length; b++) {
        const A = out[keys[a]], B = out[keys[b]];
        const dx = B.x - A.x, dy = B.y - A.y;
        const d = Math.hypot(dx, dy);
        if (d >= MIN_SEP) continue;
        const ux = d > 0.01 ? dx / d : (a % 2 ? -1 : 1); // 완전 일치 시 좌우로(결정론)
        const uy = d > 0.01 ? dy / d : 0;
        const push = (MIN_SEP - d) / 2 + 0.5;
        A.x -= ux * push; A.y -= uy * push;
        B.x += ux * push; B.y += uy * push;
        moved = true;
      }
      if (!moved) break;
    }
    const netY = 0.5 * H;
    for (const k of keys) {
      out[k].x = clampN(out[k].x, -26, W + 26);
      const y = clampN(out[k].y, -serveOut - 22, H + serveOut + 22);
      out[k].y = side === 'home' ? Math.max(y, netY - 6) : Math.min(y, netY + 6);
    }
  }
  return out;
}

/** 서브 리시브 라인(패서 3인) — "표시 기준" 리베로(후위 MB 슬롯)·OH 우선.
 *  엔진 receivers()와 동일. 서브는 이 선수들 중 하나가 리시브 대형 자리에서 받는다. */
export function receiveLine(lu: Lineup, rot: number): number[] {
  const setterIdx = lu.six.findIndex((p) => p.position === 'S');
  const passers = [0, 1, 2, 3, 4, 5].filter((i) => {
    if (i === setterIdx) return false;
    const d = displayPos(lu, rot, i);
    return d === 'L' || d === 'OH';
  });
  for (const i of [0, 1, 2, 3, 4, 5]) { if (passers.length >= 3) break; if (i !== setterIdx && !passers.includes(i)) passers.push(i); }
  return passers.slice(0, 3);
}

/** 서브 받기 전 대형 — **오버랩 합법**(같은 행 좌<중<우, 같은 열 전위<후위)을 보존하면서
 *  3-패서 리시브 룩(전위 공격수 네트 대기·후위 패서 깊게·세터 코너). x는 존 가로랭크로만,
 *  y는 전/후위 밴드로만 정해 구성상 합법 — 밴드 분리(전위 max 0.665 < 후위 min 0.72)로 열 전후 보장.
 *  세터는 서브 컨택과 동시에 침투(릴리즈)하는 단일 예외(디렉터가 별도 처리, MATCH_SYSTEM 1장). */
export function receiveFormation(side: Side, lu: Lineup, rot: number, W: number, H: number): Record<number, Px> {
  const mx = (f: number) => (side === 'home' ? f : 1 - f) * W;
  const my = (f: number) => (side === 'home' ? f : 1 - f) * H;
  const setterIdx = lu.six.findIndex((p) => p.position === 'S');
  const recv = receiveLine(lu, rot);
  const pos: Record<number, Px> = {};
  for (let i = 0; i < 6; i++) {
    const zone = zoneOfIdx(rot, i);
    const front = !isBackZone(zone);
    let yf: number;
    if (i === setterIdx) yf = front ? 0.585 : 0.72;        // 세터: 전위면 네트 코너, 후위면 백밴드 얕게(릴리즈 대기)
    else if (front) yf = recv.includes(i) ? 0.665 : 0.60;  // 전위: 패서면 미드, 비패서(공격수) 네트
    else yf = recv.includes(i) ? 0.845 : 0.755;            // 후위: 패서 깊게, 비패서 얕게
    pos[i] = { x: mx(LANE_X[lateralRank(zone)]), y: my(yf) };
  }
  return pos;
}

/** 서브 팀 대형(서버 제외 5인) — 서브 컨택 순간 **오버랩 합법** 베이스. 직후(패스 구간)부터 스위칭 전환.
 *  x=존 가로랭크, y=전/후위 밴드. 서버(zone1)는 디렉터가 베이스라인으로 따로 보낸다. */
export function serveFormation(side: Side, lu: Lineup, rot: number, W: number, H: number): Record<number, Px> {
  const mx = (f: number) => (side === 'home' ? f : 1 - f) * W;
  const my = (f: number) => (side === 'home' ? f : 1 - f) * H;
  const pos: Record<number, Px> = {};
  for (let i = 0; i < 6; i++) {
    const zone = zoneOfIdx(rot, i);
    pos[i] = { x: mx(LANE_X[lateralRank(zone)]), y: my(isBackZone(zone) ? 0.805 : 0.625) };
  }
  return pos;
}
