// 개인 생산 기록 귀속 (SALARY_SYSTEM 1장). 순수 함수 + 시드 결정론.
// 선발 라인업(코트 위 7명)만 정상 생산 → "뛴 선수만 기록/성장".
// 큰 점수차(블로아웃)의 가비지타임엔 벤치/유망주가 출전해 생산(감독 육성 판단).

import type { Player, Position } from '../types';
import { createRng } from './rng';
import { overall } from './overall';
import type { SimResult } from './simMatch';

export interface ProdLine {
  matches: number;  // 출전
  points: number;   // 득점(공격+블록+에이스)
  spikes: number;
  blocks: number;
  aces: number;
  assists: number;  // 세트(세터)
  digs: number;
}

export const emptyProd = (): ProdLine => ({
  matches: 0, points: 0, spikes: 0, blocks: 0, aces: 0, assists: 0, digs: 0,
});

/** 시즌 생산을 선수 통산 기록(CareerStats)에 누적한 새 선수 — 백년 누적 서사의 토대.
 *  career.seasons 는 rollover가 증가시키므로 여기선 생산 스탯만 더한다. 밸런스 무영향(기록용). */
export function accrueCareer(p: Player, prod: ProdLine | undefined): Player {
  if (!prod || prod.matches <= 0) return p;
  const c = p.career;
  return {
    ...p,
    career: {
      ...c,
      matches: c.matches + Math.round(prod.matches),
      points: c.points + prod.points,
      spikes: c.spikes + prod.spikes,
      blocks: c.blocks + prod.blocks,
      digs: c.digs + prod.digs,
      aces: c.aces + prod.aces,
    },
  };
}

export function mergeProd(a: ProdLine | undefined, b: ProdLine): ProdLine {
  const x = a ?? emptyProd();
  return {
    matches: x.matches + b.matches, points: x.points + b.points,
    spikes: x.spikes + b.spikes, blocks: x.blocks + b.blocks, aces: x.aces + b.aces,
    assists: x.assists + b.assists, digs: x.digs + b.digs,
  };
}

// 코트 위 인원(선발) — 1S·2OH·1OP·2MB·1L = 7
const ON_COURT: Record<Position, number> = { S: 1, OH: 2, OP: 1, MB: 2, L: 1 };

// 공격 점유 — OP(아포짓)가 확실한 1옵션, OH 좌우, MB(센터)는 속공 위주로 비중 낮음(실제 여자배구)
const ATTACK: Record<Position, number> = { OP: 1.38, OH: 0.98, MB: 0.28, S: 0.08, L: 0 };
const BLOCK: Record<Position, number> = { MB: 1.0, OH: 0.6, OP: 0.6, S: 0.3, L: 0 };
const SERVE: Record<Position, number> = { OP: 1, OH: 1, MB: 1, S: 1, L: 0.1 };
const DIG: Record<Position, number> = { L: 1.3, OH: 0.6, S: 0.5, MB: 0.4, OP: 0.3 };
const ATK_FOCUS = 2.0; // 공격 집중도 — 좋은 공격수에게 세트 몰림(1옵션 에이스 부각)
const BLK_FOCUS = 2.5; // 블록 집중도 — 좋은 블로커(센터)가 팀 블록 점유↑ → 스킬→블록 기울기 확보

/** 선발(코트 위 7) / 벤치 분리 — 포지션별 OVR 상위가 선발 */
export function splitLineup(players: Player[]): { starters: Player[]; bench: Player[] } {
  const byPos: Record<Position, Player[]> = { S: [], OH: [], OP: [], MB: [], L: [] };
  for (const p of players) byPos[p.position].push(p);
  const starters: Player[] = [];
  const bench: Player[] = [];
  (Object.keys(byPos) as Position[]).forEach((pos) => {
    const sorted = byPos[pos].sort((a, b) => overall(b) - overall(a));
    starters.push(...sorted.slice(0, ON_COURT[pos]));
    bench.push(...sorted.slice(ON_COURT[pos]));
  });
  return { starters, bench };
}

/** 큰 점수차일수록 가비지타임 비중↑ (벤치 출전) */
function garbageFrac(sim: SimResult): number {
  const lead = Math.abs(sim.homeSets - sim.awaySets);
  if (lead >= 3) return 0.2; // 3-0
  if (lead === 2) return 0.08; // 3-1
  return 0;
}

function pick(pool: Player[], weight: (p: Player) => number, r: number): Player | null {
  let total = 0;
  const ws: number[] = [];
  for (const p of pool) {
    const w = Math.max(0, weight(p));
    ws.push(w);
    total += w;
  }
  if (total <= 0) return null;
  let t = r * total;
  for (let i = 0; i < pool.length; i++) {
    t -= ws[i];
    if (t <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

export function attributeProduction(
  sim: SimResult,
  home: Player[],
  away: Player[],
  seed: number,
): Map<string, ProdLine> {
  const rng = createRng((seed ^ 0x9e3779b9) >>> 0);
  const H = splitLineup(home);
  const A = splitLineup(away);
  const total = sim.points.length;
  const gp = Math.round(total * garbageFrac(sim));

  const tally = new Map<string, ProdLine>();
  const bump = (id: string, f: (l: ProdLine) => void) => {
    const l = tally.get(id) ?? emptyProd();
    f(l);
    tally.set(id, l);
  };

  sim.points.forEach((pt, i) => {
    const garbage = i >= total - gp;
    const offHome = pt.scorer === 'home';
    const offStart = offHome ? H.starters : A.starters;
    const offBench = offHome ? H.bench : A.bench;
    const defStart = offHome ? A.starters : H.starters;
    const defBench = offHome ? A.bench : H.bench;
    const off = garbage && offBench.length ? offBench : offStart;
    const def = garbage && defBench.length ? defBench : defStart;
    const roll = rng.next();

    // 득점 유형 비율 = 밸런싱된 엔진 실측에 맞춤(공격킬+블록아웃 62% / 스터프 10% / 에이스 6% / 상대범실 22%)
    if (roll < 0.62) {
      const hitter = pick(off, (p) => ATTACK[p.position] * p.skSpike ** ATK_FOCUS, rng.next());
      if (hitter) bump(hitter.id, (l) => { l.points++; l.spikes++; });
      const setter = pick(off, (p) => (p.position === 'S' ? p.skSet : 0), rng.next());
      if (setter) bump(setter.id, (l) => { l.assists++; });
      const digger = pick(def, (p) => DIG[p.position] * p.skDig, rng.next());
      if (digger) bump(digger.id, (l) => { l.digs++; });
    } else if (roll < 0.72) {
      const blocker = pick(off, (p) => BLOCK[p.position] * p.skBlock ** BLK_FOCUS, rng.next());
      if (blocker) bump(blocker.id, (l) => { l.points++; l.blocks++; });
    } else if (roll < 0.78) {
      const server = pick(off, (p) => SERVE[p.position] * p.skServe, rng.next());
      if (server) bump(server.id, (l) => { l.points++; l.aces++; });
    }
    // else: 상대 범실 — 무귀속
  });

  // 출전: 선발은 항상, 벤치는 가비지타임 있었을 때
  for (const p of [...H.starters, ...A.starters]) bump(p.id, (l) => { l.matches++; });
  if (gp > 0) for (const p of [...H.bench, ...A.bench]) bump(p.id, (l) => { l.matches++; });

  // 작전 교체 출전(핀치 서버·블로킹·수비 교체) → 코트타임 비례 경험 XP(1.3c). 풀세트≈한 경기.
  if (sim.subUse) {
    for (const id in sim.subUse) bump(id, (l) => { l.matches += Math.min(1, sim.subUse![id] / 40); });
  }

  return tally;
}
