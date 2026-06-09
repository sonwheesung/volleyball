// 공간 파생 수학 (서브 낙하·토스 낙하·공격 코스) — 추상 결과 + 좌표 → 구체 좌표.
// 순수 함수. 난수는 호출부의 별도 srng(r01)만 사용 → 메인 결과 RNG 불간섭(승패 불변).

import { type Pt, dist, jitter, inHalf, COURT } from './court';
import type { Side } from '../types';

type R01 = () => number;
const clampHalf = (side: Side, p: Pt): Pt => ({
  x: Math.max(0.2, Math.min(COURT.W - 0.2, p.x)),
  y: side === 'home' ? Math.max(COURT.NET_Y + 0.3, Math.min(COURT.L - 0.3, p.y)) : Math.max(0.3, Math.min(COURT.NET_Y - 0.3, p.y)),
});
const outOf = (side: Side, p: Pt, r01: R01): Pt => {
  // 코트 밖(범실) — 엔드라인 뒤 또는 사이드라인 밖
  if (r01() < 0.5) return { x: p.x, y: side === 'home' ? COURT.L + 0.4 + r01() : -0.4 - r01() };
  return { x: r01() < 0.5 ? -0.4 - r01() : COURT.W + 0.4 + r01(), y: p.y };
};

/** 서브 낙하 — 의도 target 대비 outcome별 실제 낙하. q 낮을수록 리시버에서 멀리(=도달거리↑) */
export function serveLanding(recvSide: Side, passerXY: Pt, target: Pt, outcome: 'in' | 'ace' | 'fault', r01: R01, q = 0.6): Pt {
  if (outcome === 'fault') return outOf(recvSide, target, r01);
  if (outcome === 'ace') return clampHalf(recvSide, jitter(target, 1.2, r01));  // 의도한 빈 곳(아무도 못 닿음)
  const off = 0.3 + (1 - q) * 1.3;                                              // 좋은 패스=품 안, 난조=멀리 뻗음
  return clampHalf(recvSide, jitter(passerXY, off, r01));
}

/** 토스 낙하 — 인시스템이면 정확, 난조(q↓)·아웃오브시스템이면 엉뚱한 곳 */
export function tossLanding(attackerHitXY: Pt, atkSide: Side, inSystem: boolean, q: number, r01: R01): { target: Pt; landing: Pt; offTarget: number } {
  const off = inSystem ? (1 - q) * 0.6 : 0.9 + (1 - q) * 1.3; // m
  const landing = clampHalf(atkSide, jitter(attackerHitXY, off, r01));
  return { target: attackerHitXY, landing, offTarget: dist(attackerHitXY, landing) };
}

/** 공격 코스 — 결과별 상대 코트(또는 코트 밖) 도달점 */
export function attackCourse(defSide: Side, result: 'kill' | 'error' | 'blocked' | 'blockout' | 'softblock' | 'dug', atkSide: Side, diggerXY: Pt | null, netX: number, r01: R01): Pt {
  const netY = COURT.NET_Y;
  const deep = defSide === 'home' ? COURT.L - 1 - r01() * 4 : 1 + r01() * 4;
  const open = { x: 0.6 + r01() * (COURT.W - 1.2), y: deep };
  switch (result) {
    case 'kill': return open;                                   // 빈 곳 깊숙이
    case 'dug': return diggerXY ? jitter(diggerXY, 0.5, r01) : open; // 디거 쪽
    case 'error': return outOf(defSide, open, r01);             // 코트 밖
    case 'blocked': return { x: netX + (r01() * 2 - 1), y: atkSide === 'home' ? netY + 0.6 + r01() : netY - 0.6 - r01() }; // 스터프 — 공격수 쪽으로 떨어짐
    case 'blockout': return outOf(defSide, { x: r01() < 0.5 ? 0 : COURT.W, y: deep }, r01); // 블록 맞고 아웃
    case 'softblock': return { x: netX + (r01() * 2 - 1), y: defSide === 'home' ? netY + 1 + r01() : netY - 1 - r01() }; // 튕겨 올라 수비측 전환
  }
}

export { inHalf };
