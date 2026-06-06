// 종합 능력치(OVR) 산출 — 포지션 가중치(CLAUDE.md 5.3)로 윗단 스탯을 블렌딩.
// 카드/목록 표시용 단일 숫자. 계수는 placeholder.

import type { Player, Position } from '../types';
import { deriveRatings, type Ratings } from './ratings';

// 가중치 순서: [spike, block, dig, receive, set, serve]
const WEIGHTS: Record<Position, [number, number, number, number, number, number]> = {
  S: [0, 1, 2, 1, 3, 2],
  OH: [3, 2, 2, 3, 1, 3],
  OP: [3, 2, 1, 0, 0, 3],
  MB: [3, 3, 1, 1, 1, 2],
  L: [0, 0, 3, 3, 1, 0],
};

export function overall(p: Player): number {
  const r: Ratings = deriveRatings(p);
  const w = WEIGHTS[p.position];
  const vals = [r.spike, r.block, r.dig, r.receive, r.set, r.serve];
  let num = 0;
  let den = 0;
  for (let i = 0; i < vals.length; i++) {
    num += w[i] * vals[i];
    den += w[i];
  }
  const base = den === 0 ? 50 : num / den;
  // 멘탈을 소폭 가미
  const mental = (p.focus + p.consistency) / 2;
  return Math.round(Math.max(40, Math.min(99, base * 0.85 + mental * 0.15)));
}

export function teamOverall(players: Player[]): number {
  if (players.length === 0) return 0;
  // 상위 7인 평균(주전 체감)
  const ovrs = players.map(overall).sort((a, b) => b - a);
  const top = ovrs.slice(0, 7);
  return Math.round(top.reduce((a, b) => a + b, 0) / top.length);
}
