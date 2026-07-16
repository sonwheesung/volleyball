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

// 전위 3인 깊이 — 스페셜리스트 레인 순(identity)으로 고정 배정. 서브 대형 ↔ 수비 스위칭 전환 때
// 각 선수가 자기 깊이를 유지(좌우만 슬라이드)해서, 두 윙이 좌우를 맞바꿀 때 같은 깊이에서 겹쳐
// 쌓이지(뒷통수에 손) 않게 한다(2026-06-19 사용자 보고). 센터 레인(대개 MB)이 네트 최밀착,
// 윙은 살짝 어긋난 깊이 → 좌우 교차해도 깊이가 달라 마커가 분리돼 보인다. 전부 네트 밴드(≤1.3m).
const FRONT_DEPTH_HOME = [0.58, 0.555, 0.605]; // laneRank 0(좌윙)·1(센터)·2(우윙)
const frontDepthFrac = (side: Side, laneRank: number): number => {
  const d = FRONT_DEPTH_HOME[laneRank] ?? 0.57;
  return side === 'home' ? d : 1 - d;
};
/** 전위 i 의 레인 순위(0~2) — 같은 전위 3인을 스페셜리스트 순으로 줄세웠을 때 위치 */
const frontLaneRank = (six: Player[], frontIdx: number[], i: number): number =>
  [...frontIdx].sort((a, b) => LANE[six[a].position] - LANE[six[b].position]).indexOf(i);

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 로테이션 r 에서 zone 에 선 라인업 인덱스 (zone z → (r+z-1)%6) */
export const lineupIdxAt = (r: number, zone: number) => (r + zone - 1) % 6;
/** 라인업 인덱스 i 가 선 존 */
export const zoneOfIdx = (rot: number, i: number) => ((i - rot) % 6 + 6) % 6 + 1;
const isBackZone = (z: number) => z === 1 || z === 5 || z === 6;

// ── 오버랩 합법 + 자유분방한 룩 (CLAUDE.md 4.3 로테이션) ──
// 서브 컨택 순간 6명은 인접 기준 로테이션 순서만 지키면 된다(등간격 격자가 아니다):
//   같은 행 좌<중<우(전위 4·3·2 / 후위 5·6·1), 같은 열 전위가 후위보다 네트에 가깝다(4·5 / 3·6 / 2·1).
// 그래서: 가로는 전·후위 레인을 어긋나게(stagger) + 존/로테이션별 결정론 흔들기(jit),
// 세로는 전위/후위 밴드 안에서 자유롭게(아크·깊이차) — 순서는 보존하되 등간격은 깬다.
/** 존 → 가로랭크(L0/C1/R2): {4,5}=좌 · {3,6}=중 · {2,1}=우 */
const lateralRank = (zone: number): number => (zone === 4 || zone === 5 ? 0 : zone === 3 || zone === 6 ? 1 : 2);
// 결정론 흔들기(시드 → -amp..amp) — 같은 입력=같은 위치(렌더=감사 단일 소스). Math.random/Date 불사용.
const frac = (n: number): number => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const jit = (seed: number, amp: number): number => (frac(seed) - 0.5) * 2 * amp;

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
  const yBw = (side === 'home' ? 0.80 : 0.20) * H;    // 후위 윙
  const yBm = (side === 'home' ? 0.905 : 0.095) * H;  // 후위 중앙 — 가장 깊게(리베로)
  const pos: Record<number, Px> = {};
  // 전위: 좌→우(스페셜리스트) x, 깊이는 레인 고정(frontDepthFrac) — 서브 대형과 동일 깊이라 전환 시 겹침 없음
  [...front].sort((a, b) => LANE[posOf(a)] - LANE[posOf(b)]).forEach((i, k) => { pos[i] = { x: XF[k] * W, y: frontDepthFrac(side, k) * H }; });
  [...back].sort((a, b) => LANE[posOf(a)] - LANE[posOf(b)]).forEach((i, k) => { pos[i] = { x: XB[k] * W, y: k === 1 ? yBm : yBw }; });
  const setterIdx = lu.six.findIndex((p) => p.position === 'S');
  if (offense && setterIdx >= 0) pos[setterIdx] = { x: (side === 'home' ? 0.63 : 0.37) * W, y: (side === 'home' ? 0.57 : 0.43) * H }; // 공격 시에만 네트 침투
  return { pos, setterIdx, frontHitters: front.filter((i) => i !== setterIdx), backers: back.filter((i) => i !== setterIdx) };
}

// ─── 랠리 중 동적 위치 (수비 부채꼴 / 블로커 벽 / 공격 커버) ───

/** 수비 부채꼴(컵/활) 3슬롯 — 공격 x 쪽으로 살짝 시프트. **표준 페리미터 수비**: 중앙 백(미들백)
 *  가장 깊게(라인/딥 크로스)·양 윙 앞으로(각·연타) → 공격자 쪽으로 열린 "∨"(활). 이전엔 중앙 얕고
 *  윙 깊은 역방향("∧")이었다(2026-06-19 사용자 보고). 네트 앞 팁은 전위 커버/블로커가 담당.
 *  좌→우 순서 보장: 호출측이 "현재 x 순"으로 정렬한 선수에게 순서대로 배정하면 동선 교차 없음. */
export function fanSlots(side: Side, attackX: number, W: number, H: number): Px[] {
  const shift = (attackX - 0.5 * W) * 0.3;
  const sx = [0.22, 0.5, 0.78].map((b) => clampN(b * W + shift, 22, W - 22));
  const yDeep = (side === 'home' ? 0.85 : 0.15) * H; // 중앙 백 — 가장 깊게
  const yWing = (side === 'home' ? 0.72 : 0.28) * H; // 양 윙 — 앞으로(컵)
  return [{ x: sx[0], y: yWing }, { x: sx[1], y: yDeep }, { x: sx[2], y: yWing }];
}

// 네트 안전 여백(px, 절대값) — 점프 마커(반지름 MR×JUMP≈22px + 네트선)가 네트를 침범하지 않도록
// 네트에 서는 마커(공격수 타점·블로커 벽)의 중심을 최소 이만큼 네트에서 떨어뜨린다(저해상도 폰 대응).
// 분수 오프셋만으론 COURT_H가 작은 화면에서 px 여백이 부족해 "네트 터치"가 보였다(2026-06-18 측정).
export const NET_SAFE = 26;

/** 블로커 벽 — 공격수 x 정면에 count장(어깨 맞댐). 좌→우 순서로 반환. 네트 안전 여백 보장. */
export function blockerWall(side: Side, attackX: number, count: number, W: number, H: number): Px[] {
  const netY = 0.5 * H;
  const yNet = side === 'home' ? Math.max(0.575 * H, netY + NET_SAFE) : Math.min(0.425 * H, netY - NET_SAFE);
  const spread = count <= 1 ? [0] : count === 2 ? [-13, 13] : [-22, 0, 22];
  return spread.map((dx) => ({ x: clampN(attackX + dx, 24, W - 24), y: yNet }));
}

/** 공격 커버 — 블록 리바운드 낙하 구역을 감싸는 반원(가까운 2 측면 + 1 깊은 중앙).
 *  전위 공격(타점=네트): 블록에 막힌 공은 히터 바로 뒤(네트 쪽)에 뚝 떨어진다 → 커버가 히터를 바짝
 *  감싼다(2026-06-18 보정: 0.68/0.78은 ~3m로 너무 깊어 리바운드 구역 뒤였음 → 0.645/0.70로 타이트).
 *  백어택(타점=3m 라인): 리바운드가 히터 앞(네트 쪽)에 떨어짐 → 측면 커버가 앞(0.62), 깊은 커버는 뒤(0.78). */
export function coverSpots(side: Side, attackX: number, n: number, W: number, H: number, backAtk = false): Px[] {
  const yNear = (side === 'home' ? (backAtk ? 0.62 : 0.645) : (backAtk ? 0.38 : 0.355)) * H;
  const yDeep = (side === 'home' ? (backAtk ? 0.78 : 0.70) : (backAtk ? 0.22 : 0.30)) * H;
  const cx = (dx: number) => clampN(attackX + dx, 24, W - 24);
  if (n <= 1) return [{ x: cx(0), y: yNear }];
  if (n === 2) return [{ x: cx(-30), y: yNear }, { x: cx(30), y: yNear }];
  return [{ x: cx(-34), y: yNear }, { x: cx(34), y: yNear }, { x: cx(0), y: yDeep }];
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

// 전·후위 가로 레인 — 어긋나게(stagger) 둬서 같은 열 앞뒤 선수가 일직선 정렬되지 않게(격자 탈피).
const RF_FRONT_X = [0.21, 0.50, 0.79];
const RF_BACK_X = [0.13, 0.55, 0.87];
// 서브 팀 전위(블로커)는 **번치 리드**로 가운데에 모은다(미들서드 0.36~0.64) — 프로/상위 표준:
// 넓게 펴지 않고 중앙에 뭉쳐 상대 세터를 읽고 핀으로 빠르게 이동(GMS·USAV, 2026-06-20 사용자 보고).
// 서브 직후 switched(스페셜리스트)로 벌어지며 "번치→핀 릴리즈"가 보인다. 좌우 순서 보존 = 오버랩 합법.
const SV_FRONT_X = [0.36, 0.50, 0.64];
const SV_BACK_X = [0.15, 0.53, 0.85];

// ── 패서 레인 3등분(레인 재분배, COURT_POSITIONING A-1 · BOARD_RULES 룰 69) ──
// 존 컬럼 고정(RF_*_X)은 4/6 로테이션에서 세 패서가 한쪽에 뭉쳐 반대편이 무패서로 빈다(rot2/5 좌측 절반 공백).
// 서브 코스를 좌·중·우로 3등분하려면 패서를 목표 레인에 재배치하되, 같은 행 인접 존 점유자(비패서·세터) x를
// 넘지 않는 합법 구간으로 클램프해 오버랩(룰 Q)을 유지한다. 패서 3인의 **x만** 바꾼다(깊이 y·비패서·세터·jit 무변경).
const RECV_LANES = [0.18, 0.5, 0.82];
const LANE_EPS = 0.03;                 // 이웃 존 점유자와 최소 간격(룰 Q strict>0.5px 여유)
const LANE_MARGIN_L = 0.08, LANE_MARGIN_R = 0.92; // 끝 존(4·5 좌끝 / 2·1 우끝)·패서 이웃일 때 코트 여백
const LANE_ORDER_MARGIN = 0.01;        // 같은 행 패서끼리 최소 x 간격(오버랩 좌우 순서 여유)
const RECV_PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
const rowOrderZones = (front: boolean): number[] => (front ? [4, 3, 2] : [5, 6, 1]);

/** 패서 3인의 x(home 프랙션)를 좌·중·우 레인으로 재분배. xf 배열을 제자리 수정. */
function redistributePasserLanes(xf: number[], zoneOf: number[], recv: number[], rot: number): void {
  const passers = recv.slice(0, 3);
  if (passers.length !== 3) return; // 항상 3인(안전용 가드)
  const lo: number[] = [], hi: number[] = [], jitT: number[] = [];
  for (let k = 0; k < 3; k++) {
    const z = zoneOf[passers[k]];
    const order = rowOrderZones(!isBackZone(z));
    const j = order.indexOf(z);
    let L = LANE_MARGIN_L, Hh = LANE_MARGIN_R;
    if (j > 0) { const nb = lineupIdxAt(rot, order[j - 1]); if (!recv.includes(nb)) L = xf[nb] + LANE_EPS; }
    if (j < order.length - 1) { const nb = lineupIdxAt(rot, order[j + 1]); if (!recv.includes(nb)) Hh = xf[nb] - LANE_EPS; }
    if (L > Hh) { const mid = (L + Hh) / 2; L = Hh = mid; } // 구간 반전 방지(사실상 미발생)
    lo.push(L); hi.push(Hh);
    jitT.push(jit(z * 31 + rot * 7 + 3, 0.015)); // 레인 목표 결정론 흔들기(패서 존 시드)
  }
  let best: number[] | null = null, bestScore = Infinity;
  for (const perm of RECV_PERMS) {
    const assigned = [0, 1, 2].map((k) => clampN(RECV_LANES[perm[k]] + jitT[k], lo[k], hi[k]));
    // 같은 행 패서 좌우 순서(존 순 x 증가) 검증 — 위반 순열은 불가
    let feasible = true;
    for (const front of [true, false]) {
      const order = rowOrderZones(front);
      const inRow = [0, 1, 2].map((k) => ({ k, oi: order.indexOf(zoneOf[passers[k]]) })).filter((e) => e.oi >= 0).sort((a, b) => a.oi - b.oi);
      for (let t = 1; t < inRow.length; t++) if (assigned[inRow[t].k] <= assigned[inRow[t - 1].k] + LANE_ORDER_MARGIN) { feasible = false; break; }
      if (!feasible) break;
    }
    if (!feasible) continue;
    let score = 0;
    for (let k = 0; k < 3; k++) score += Math.abs(assigned[k] - (RECV_LANES[perm[k]] + jitT[k]));
    if (score < bestScore) { bestScore = score; best = assigned; } // 동점=순열 인덱스↓(strict <)
  }
  if (best) for (let k = 0; k < 3; k++) xf[passers[k]] = best[k];
}

/** 서브 받기 전 대형 — **오버랩 합법**(행 좌<중<우, 열 전위<후위)을 지키되 **등간격 격자가 아니라
 *  자유분방하게**(레인 어긋남 + 결정론 흔들기 + 후위 패서 W 아크). 전위 공격수 네트 대기·후위 패서
 *  깊게·세터 코너 은신. y는 전위(≤0.68)·후위(≥0.72) 밴드가 분리돼 열 전후 보장. 패서 3인의 x는
 *  좌·중·우 레인으로 재분배(redistributePasserLanes — 존 컬럼 뭉침 해소, 룰 69). 세터는 컨택과 동시 침투
 *  (릴리즈) — 디렉터가 별도 처리. 원정은 홈 프랙션에서 계산 후 mx() 미러. */
export function receiveFormation(side: Side, lu: Lineup, rot: number, W: number, H: number): Record<number, Px> {
  const mx = (f: number) => (side === 'home' ? f : 1 - f) * W;
  const my = (f: number) => (side === 'home' ? f : 1 - f) * H;
  const setterIdx = lu.six.findIndex((p) => p.position === 'S');
  const recv = receiveLine(lu, rot);
  const xfs: number[] = new Array(6);
  const yfs: number[] = new Array(6);
  const zoneOf: number[] = new Array(6);
  for (let i = 0; i < 6; i++) {
    const zone = zoneOfIdx(rot, i);
    zoneOf[i] = zone;
    const r = lateralRank(zone);
    const front = !isBackZone(zone);
    const seed = zone * 31 + rot * 7;
    if (i === setterIdx) {
      xfs[i] = r === 2 ? 0.87 : r === 0 ? 0.13 : 0.5;          // 자기 사이드 코너에 은신
      // 전위 세터는 네트(0.57). 후위 세터는 **가장 깊게**(0.86) — 같은 열 전위 패서(0.79)가 패스 깊이로
      // 내려와도 그 뒤를 받쳐 오버랩 합법(전위<후위, 룰 Q) 유지. 세터는 안 받으니(릴리즈) 깊어도 무방.
      // 침투는 디렉터가 컨택 직후 릴리즈(switchedSpots offense). (2026-06-24: 평평한 3인 라인 채택, COURT_POSITIONING A-1)
      yfs[i] = front ? 0.57 : 0.86;
    } else if (front) {
      xfs[i] = RF_FRONT_X[r] + jit(seed + 1, 0.04); // 패서면 아래 redistribute가 덮어씀
      // 전위 패서(주로 OH)는 **후위 패서와 같은 패스 깊이(0.79)** 로 내려와 3인 **평평한 라인**을 이룬다
      // (리베로·백OH 0.80~0.82와 한 줄). 2026-06-24 채택(COURT_POSITIONING A-1 "패서 3명 3~5m 한 라인"): 구 W(0.665)는
      // 전위 패서를 3m 라인에 얕게 둬 그 뒤(자기 열 짝=세터/OP가 비우는 깊은 쪽)가 빈 채로 에이스 허용 — 사용자 보고.
      // 오버랩(룰 Q): "후위밴드 침범(≥0.72)"은 룰이 아니다. 전위 패서는 **자기 열 후위 짝보다만** 네트쪽이면 합법
      // (FIVB 7.4 인접 쌍). 짝(세터 0.86·비패서 0.85)을 더 깊이 빼 0.79가 합법 — _dv_overlap 위반 0 측정으로 확인.
      yfs[i] = recv.includes(i) ? 0.79 + jit(seed + 2, 0.012) : 0.575 + jit(seed + 2, 0.02);
    } else {
      xfs[i] = RF_BACK_X[r] + jit(seed + 1, 0.04); // 패서면 아래 redistribute가 덮어씀
      // 후위 패서 라인 — 리베로(중앙 zone6, 서브 집중 구역) 가장 깊게(0.82), 윙 0.80. 비패서(백어택
      // 대기 OP)는 **가장 깊게(0.85)** 로 빼 같은 열 전위 패서(0.79)와 오버랩 여유 확보(전위<후위 합법).
      yfs[i] = recv.includes(i) ? (r === 1 ? 0.82 : 0.80) + jit(seed + 2, 0.015) : 0.85 + jit(seed + 2, 0.015);
    }
  }
  // 패서 3인의 x만 좌·중·우 레인으로 재분배(존 컬럼 뭉침 해소). 비패서·세터 x·전원 y는 위에서 확정된 값 유지.
  redistributePasserLanes(xfs, zoneOf, recv, rot);
  const pos: Record<number, Px> = {};
  for (let i = 0; i < 6; i++) pos[i] = { x: mx(xfs[i]), y: my(yfs[i]) };
  return pos;
}

/** 서브 팀 대형(서버 제외 5인) — 컨택 순간 **오버랩 합법** 베이스(직후 패스 구간부터 스위칭 전환).
 *  받기와 같은 원리(레인 어긋남 + 흔들기)로 자유분방하되 순서 보존. 서버(zone1)는 디렉터가 베이스라인으로. */
export function serveFormation(side: Side, lu: Lineup, rot: number, W: number, H: number): Record<number, Px> {
  const mx = (f: number) => (side === 'home' ? f : 1 - f) * W;
  const my = (f: number) => (side === 'home' ? f : 1 - f) * H;
  const frontIdx = [2, 3, 4].map((z) => lineupIdxAt(rot, z));
  const pos: Record<number, Px> = {};
  for (let i = 0; i < 6; i++) {
    const zone = zoneOfIdx(rot, i);
    const r = lateralRank(zone);
    const front = !isBackZone(zone);
    const seed = zone * 31 + rot * 7 + 99;
    const xf = (front ? SV_FRONT_X : SV_BACK_X)[r] + jit(seed + 1, 0.045);
    // 전위는 네트(블로킹 라인)에 붙인다. 깊이는 스위칭과 동일한 레인 고정(frontDepthFrac)을 써서,
    // 서브 직후 좌우 스위칭이 "깊이 유지·좌우 슬라이드"로 보이게 — 중앙에서 겹쳐 쌓이지 않게(사용자 보고).
    if (front) {
      // 깊이는 레인 고정(frontDepthFrac은 side 보정 완료) + 미세 흔들기. x는 zone 순(mx).
      const yf = frontDepthFrac(side, frontLaneRank(lu.six, frontIdx, i)) + jit(seed + 2, 0.01);
      pos[i] = { x: mx(xf), y: yf * H };
    } else {
      pos[i] = { x: mx(xf), y: my(0.80 + jit(seed + 2, 0.025)) };
    }
  }
  return pos;
}
