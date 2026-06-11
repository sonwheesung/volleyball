// 외국인 트라이아웃 (FOREIGN_SYSTEM) — 매 오프시즌 풀 생성 + 지명 실행. data 계층(엔진 합성).
// 외인 성능 보장: 국내 평균 "그 이상"(설계 결정 2026-06-11) — 풀 바닥이 국내 평균을 깔고 시작한다.

import type { Player, Position } from '../types';
import { createRng, strSeed } from '../engine/rng';
import { overall } from '../engine/overall';
import { FOREIGN_SALARY, FRESH_POOL_SIZE, tryoutOrder, resolveTryout, type TryoutPicks } from '../engine/foreign';
import { makePlayer } from './seed';

const clampS = (v: number) => Math.max(20, Math.min(96, Math.round(v)));
const LIFT_KEYS = ['jump', 'agility', 'reaction', 'positioning', 'focus', 'consistency', 'vq',
  'skSpike', 'skBlock', 'skDig', 'skReceive', 'skSet', 'skServe'] as const;

/** 능력 일괄 상향(키·체력 제외) — 바닥 보장용 */
function lift(p: Player, delta: number): Player {
  const out = { ...p };
  for (const k of LIFT_KEYS) (out as Record<string, unknown>)[k] = clampS((p[k] as number) + delta);
  return out;
}

/** 매년 새 외인 풀 — 전원 국내 평균 +2 이상(상위권~슈퍼스타). OP 중심(여자부 현실) */
export function generateForeignPool(season: number, domesticAvg: number, count = FRESH_POOL_SIZE): Player[] {
  const rng = createRng(strSeed(`tryout-pool:${season}`));
  const out: Player[] = [];
  for (let i = 0; i < count; i++) {
    const pos: Position = rng.next() < 0.8 ? 'OP' : 'OH';
    const age = rng.int(23, 31);
    const bias = 6 + rng.int(0, 12); // 상위권 기본 — 분산은 도박의 재료
    let p = makePlayer(rng, `fgn-s${season}-${i}`, pos, true, age, bias);
    while (overall(p) < domesticAvg + 2) p = lift(p, 3); // 바닥 보장: 국내 평균 그 이상
    out.push({ ...p, contract: { salary: FOREIGN_SALARY, years: 1, remaining: 1, signedAtAge: p.age } });
  }
  return out;
}

export interface TryoutOutcome extends TryoutPicks {
  poolIds: string[]; // 그 해 트라이아웃 전체 풀(미리보기 표시용)
}

/**
 * 트라이아웃 실행 — snapshot/rosters를 직접 갱신(오프시즌 체인 내부, FA 시장 앞).
 * returningForeign: 전 시즌 외인(롤오버 생존자) — 재참가, 재지명되면 기록·근속 연속.
 */
export function runTryout(
  snapshot: Record<string, Player>,
  rosters: Record<string, string[]>,
  returningForeign: string[],
  nextSeason: number,
  myTeam: string,
  myWish: string[],
): TryoutOutcome {
  // 국내 평균 = 현재 로스터(외인 제외) OVR 평균 — 외인 바닥의 기준선
  const domestic = Object.values(rosters).flat()
    .map((id) => snapshot[id]).filter((p): p is Player => !!p && !p.isForeign);
  const domesticAvg = domestic.length
    ? domestic.reduce((s, p) => s + overall(p), 0) / domestic.length : 65;

  const fresh = generateForeignPool(nextSeason, domesticAvg);
  for (const p of fresh) snapshot[p.id] = p;
  const poolIds = [...fresh.map((p) => p.id), ...returningForeign.filter((id) => snapshot[id])];
  const pool = poolIds.map((id) => snapshot[id]).filter((p): p is Player => !!p);

  const order = tryoutOrder(nextSeason, Object.keys(rosters));
  const res = resolveTryout(order, pool, myTeam, myWish, nextSeason);

  // 지명자 → 1년 계약으로 로스터 합류
  for (const [teamId, pid] of Object.entries(res.picks)) {
    const p = snapshot[pid];
    if (!p) continue;
    snapshot[pid] = { ...p, contract: { salary: FOREIGN_SALARY, years: 1, remaining: 1, signedAtAge: p.age } };
    rosters[teamId] = [...(rosters[teamId] ?? []), pid];
  }
  // 미지명자(대체 풀 제외)는 리그를 떠난다 + 과거 잔류물(전 시즌 대체 풀 등) 청소 — 세이브 다이어트
  const keep = new Set([...Object.values(res.picks), ...res.altPoolIds]);
  for (const id of Object.keys(snapshot)) {
    const p = snapshot[id];
    if (!p?.isForeign) continue;
    const rostered = Object.values(rosters).some((r) => r.includes(id));
    if (!rostered && !keep.has(id)) delete snapshot[id];
  }
  return { ...res, poolIds };
}
