// 경기 MVP(매치 단위) — 결과 화면 커튼콜 + 한 줄 서사. AWARDS_SYSTEM §1.
// box(BoxSink) 단일 소스에서 파생(새 저장 0). 이긴 팀 최고 생산자(득점 위주 + 수비 가산).
// SOLID: UI → data(여기) → 엔진 타입(BoxSink·SimResult)에만 의존.

import type { Player } from '../types';
import type { BoxSink, BoxLine } from '../engine/rally';
import type { SimResult } from '../engine/simMatch';

export interface MatchMvp {
  id: string; name: string; position: string; side: 'home' | 'away';
  points: number; blocks: number; aces: number; digs: number;
  line: string; // 한 줄 서사 리캡
}

/** 한 선수의 박스 → 득점(공격 킬 + 블록 득점 + 서브 에이스). BoxLine 단일 소스. */
function pointsOf(s: BoxLine): number {
  return s.atkKill + s.blockPt + s.srvAce;
}

/** 경기 MVP = 이긴 팀 최고 생산자(points + 0.3·digs). 한 줄 리캡 동봉. box 비면 null. */
export function matchMvp(box: BoxSink, home: Player[], away: Player[], sim: SimResult, homeName: string, awayName: string): MatchMvp | null {
  const winner: 'home' | 'away' = sim.homeSets > sim.awaySets ? 'home' : 'away';
  const squad = winner === 'home' ? home : away;
  const winName = winner === 'home' ? homeName : awayName;
  let best: { p: Player; points: number; blocks: number; aces: number; digs: number } | null = null;
  let bestScore = -1;
  for (const p of squad) {
    const s = box.get(p.id);
    if (!s) continue;
    const points = pointsOf(s);
    const score = points + s.digSucc * 0.3; // 득점 위주, 수비(디그) 가산 — 수비형 명경기 시 리베로도 후보
    if (score > bestScore) { bestScore = score; best = { p, points, blocks: s.blockPt, aces: s.srvAce, digs: s.digSucc }; }
  }
  if (!best || bestScore <= 0) return null;

  // 매치 맥락 태그
  const w = Math.max(sim.homeSets, sim.awaySets), l = Math.min(sim.homeSets, sim.awaySets);
  const tag = w === 3 && l === 0 ? '3-0 완승' : w === 3 && l === 2 ? '풀세트 접전 끝에' : `${w}-${l} 승리`;
  // 주요 스탯(눈에 띄는 것만)
  const extras: string[] = [];
  if (best.blocks >= 3) extras.push(`블로킹 ${best.blocks}`);
  if (best.aces >= 3) extras.push(`서브 ${best.aces}`);
  if (best.digs >= 15 && best.points < 10) extras.push(`디그 ${best.digs}`); // 수비형 MVP일 때만 디그 강조
  const statTail = extras.length ? ` · ${extras.join(' · ')}` : '';
  const line = `${winName}, ${tag} — ${best.p.name} ${best.points}득점${statTail}`;
  return { id: best.p.id, name: best.p.name, position: best.p.position, side: winner, points: best.points, blocks: best.blocks, aces: best.aces, digs: best.digs, line };
}
