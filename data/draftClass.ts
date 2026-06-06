// 신인 드래프트 클래스 생성 (결정론, 시즌 시드). makeProspect 합성.

import { createRng } from '../engine/rng';
import { makeProspect } from './seed';
import type { Player, Position } from '../types';

// 한 클래스의 포지션 분포(대략 로스터 수요 비율)
const POS_DIST: Position[] = ['OH', 'MB', 'S', 'OH', 'OP', 'MB', 'L', 'OH'];

export function generateDraftClass(season: number, size: number): Player[] {
  const rng = createRng(50000 + season * 613);
  const out: Player[] = [];
  for (let i = 0; i < size; i++) {
    out.push(makeProspect(rng, `d${season}_${i}`, POS_DIST[i % POS_DIST.length]));
  }
  return out;
}
