// 코트 좌표계 & 포메이션 (공간 텔레메트리용) — 순수 함수, React 무의존.
// 미터 단위 정규화: 코트 9m(폭) × 18m(길이). 네트 y=9. 홈 y∈[9,18], 원정 y∈[0,9].
// 좌표는 "설명/검증용"이며 승패에 영향 없음(별도 RNG로 파생). rotation→zone 매핑은 rally/UI와 동일.

import type { Side, Player } from '../types';

export interface Pt { x: number; y: number }

export const COURT = { W: 9, L: 18, NET_Y: 9 } as const;

// 홈 기준 존 중심 좌표. 전위 y=11.5(네트 근접), 후위 y=16. x: 좌1.7·중4.5·우7.3.
const HOME_ZONE: Record<number, Pt> = {
  4: { x: 1.7, y: 11.5 }, 3: { x: 4.5, y: 11.5 }, 2: { x: 7.3, y: 11.5 },
  5: { x: 1.7, y: 16.0 }, 6: { x: 4.5, y: 16.0 }, 1: { x: 7.3, y: 16.0 },
};

/** 코트 중심(4.5, 9) 점대칭 — 원정은 홈의 반사 */
const reflect = (p: Pt): Pt => ({ x: COURT.W - p.x, y: COURT.L - p.y });

/** 사이드·존 → 코트 좌표 */
export function zoneXY(side: Side, zone: number): Pt {
  const h = HOME_ZONE[zone] ?? HOME_ZONE[6];
  return side === 'home' ? { ...h } : reflect(h);
}

/** 로테이션 r 에서 라인업 인덱스 i 가 선 존 (zone z ↔ (r+z-1)%6 == i) */
export function zoneOfIdx(rotation: number, lineupIdx: number): number {
  for (let z = 1; z <= 6; z++) if ((rotation + z - 1) % 6 === lineupIdx) return z;
  return 6;
}

/** 라인업 인덱스의 코트 좌표(존 중심). 좌표는 존에만 의존하므로 six·libero는 받기만 하고 쓰지 않는다
 *  (리베로↔MB 자리 교체는 같은 후위 존이라 좌표가 동일 — 누가 그 자리에 서는지는 호출부 rally.ts가 선택). */
export function playerXY(side: Side, six: Player[], rotation: number, lineupIdx: number, libero: Player | null): Pt {
  const z = zoneOfIdx(rotation, lineupIdx);
  return zoneXY(side, z);
}

/** 서브 위치 — 엔드라인 뒤(코트 밖) zone1 근방 */
export function serveSpot(side: Side, rng01: () => number): Pt {
  const back = side === 'home' ? COURT.L + 0.6 : -0.6;
  return { x: 1 + rng01() * 7, y: back };
}

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
/** 한 사이드 코트 안(서브/공격 in/out 판정) */
export const inHalf = (side: Side, p: Pt): boolean =>
  p.x >= 0 && p.x <= COURT.W && (side === 'home' ? p.y >= COURT.NET_Y && p.y <= COURT.L : p.y >= 0 && p.y <= COURT.NET_Y);

/** 점 주변 지터(별도 RNG) */
export const jitter = (p: Pt, r: number, rng01: () => number): Pt => ({ x: p.x + (rng01() * 2 - 1) * r, y: p.y + (rng01() * 2 - 1) * r });
