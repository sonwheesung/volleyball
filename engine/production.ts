// 개인 생산 기록 귀속 (SALARY_SYSTEM 1장). 순수 함수 + 시드 결정론.
// SOLID: 경기 "구현"이 아니라 SimResult "형태"에만 의존 →
//        경기 엔진을 바꿔도 이 모듈은 영향 없음. 단일 책임 = 득점/세트/디그 귀속.

import type { Player, Position } from '../types';
import { createRng } from './rng';
import type { SimResult } from './simMatch';

export interface ProdLine {
  matches: number;
  points: number;   // 득점(공격+블록+에이스)
  spikes: number;   // 공격 성공
  blocks: number;   // 블로킹 득점
  aces: number;     // 서브 에이스
  assists: number;  // 세트(세터)
  digs: number;     // 디그(수비)
}

export const emptyProd = (): ProdLine => ({
  matches: 0, points: 0, spikes: 0, blocks: 0, aces: 0, assists: 0, digs: 0,
});

export function mergeProd(a: ProdLine | undefined, b: ProdLine): ProdLine {
  const x = a ?? emptyProd();
  return {
    matches: x.matches + b.matches,
    points: x.points + b.points,
    spikes: x.spikes + b.spikes,
    blocks: x.blocks + b.blocks,
    aces: x.aces + b.aces,
    assists: x.assists + b.assists,
    digs: x.digs + b.digs,
  };
}

// 포지션별 역할 점유 (placeholder — SALARY_SYSTEM 1.1)
const ATTACK: Record<Position, number> = { OP: 1.0, OH: 0.9, MB: 0.6, S: 0.1, L: 0 };
const BLOCK: Record<Position, number> = { MB: 1.0, OH: 0.6, OP: 0.6, S: 0.3, L: 0 };
const SERVE: Record<Position, number> = { OP: 1, OH: 1, MB: 1, S: 1, L: 0.1 };
const DIG: Record<Position, number> = { L: 1.0, OH: 0.6, S: 0.5, MB: 0.4, OP: 0.3 };

function pick(players: Player[], weight: (p: Player) => number, r: number): Player | null {
  let total = 0;
  const ws: number[] = [];
  for (const p of players) {
    const w = Math.max(0, weight(p));
    ws.push(w);
    total += w;
  }
  if (total <= 0) return null;
  let t = r * total;
  for (let i = 0; i < players.length; i++) {
    t -= ws[i];
    if (t <= 0) return players[i];
  }
  return players[players.length - 1];
}

/**
 * 한 경기 결과(SimResult)를 선수별 생산으로 귀속한다(불변, 결정론).
 * seed 로 파생 RNG를 만들어 경기 애니메이션과 독립적으로 동작.
 */
export function attributeProduction(
  sim: SimResult,
  home: Player[],
  away: Player[],
  seed: number,
): Map<string, ProdLine> {
  const rng = createRng((seed ^ 0x9e3779b9) >>> 0);
  const tally = new Map<string, ProdLine>();
  const bump = (id: string, f: (l: ProdLine) => void) => {
    const l = tally.get(id) ?? emptyProd();
    f(l);
    tally.set(id, l);
  };

  for (const pt of sim.points) {
    const off = pt.scorer === 'home' ? home : away;
    const def = pt.scorer === 'home' ? away : home;
    const roll = rng.next();

    if (roll < 0.62) {
      // 공격 성공
      const hitter = pick(off, (p) => ATTACK[p.position] * p.skSpike, rng.next());
      if (hitter) bump(hitter.id, (l) => { l.points++; l.spikes++; });
      const setter = pick(off, (p) => (p.position === 'S' ? p.skSet : 0), rng.next());
      if (setter) bump(setter.id, (l) => { l.assists++; });
      const digger = pick(def, (p) => DIG[p.position] * p.skDig, rng.next());
      if (digger) bump(digger.id, (l) => { l.digs++; });
    } else if (roll < 0.75) {
      // 블로킹 득점
      const blocker = pick(off, (p) => BLOCK[p.position] * p.skBlock, rng.next());
      if (blocker) bump(blocker.id, (l) => { l.points++; l.blocks++; });
    } else if (roll < 0.85) {
      // 서브 에이스
      const server = pick(off, (p) => SERVE[p.position] * p.skServe, rng.next());
      if (server) bump(server.id, (l) => { l.points++; l.aces++; });
    }
    // else: 상대 범실 — 무귀속
  }

  // 출전(근사): 양 팀 로스터 전원 +1경기
  for (const p of [...home, ...away]) bump(p.id, (l) => { l.matches++; });

  return tally;
}
