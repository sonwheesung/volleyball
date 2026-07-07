// 코트 라인업 구성 (MATCH_SYSTEM 1장) — 로스터에서 주전 6인(로테이션 배열) + 리베로 선발.
// 5-1 시스템: 세터 1. 슬롯 배치를 대각(세터↔아포짓, OH↔OH, MB↔MB)으로 둬
// 회전이 돌수록 전·후위 구성이 현실적으로 바뀐다(로테이션 효과의 토대).
// 순수 함수 — React 무의존.

import type { Player, Position } from '../types';
import { overall } from './overall';
import { STARTER_NEED } from './transactions';
import { createRng, strSeed } from './rng';

export interface Lineup {
  six: Player[];          // 로테이션 슬롯 0..5: [S, OH, MB, OP, OH, MB]
  libero: Player | null;  // 후위 수비 전문(서브·전위 공격 불가)
}

function bestByPos(players: Player[], pos: Position, n: number, used: Set<string>): Player[] {
  const picked = players
    .filter((p) => p.position === pos && !used.has(p.id))
    .sort((a, b) => overall(b) - overall(a))
    .slice(0, n);
  picked.forEach((p) => used.add(p.id));
  return picked;
}

/** 로스터 → 주전 6인 로테이션 배열 + 리베로. 결손 포지션은 잔여 선수로 방어 충원.
 *  빈 로스터는 명시적 거부 — 시즌 계층(부상 상한 3·방출 하한 ROSTER_MIN)이 원천 차단해야 하는 상태. */
export function buildLineup(players: Player[]): Lineup {
  if (players.length === 0) throw new Error('빈 로스터 — 라인업을 구성할 수 없습니다(시즌 계층 가드 위반)');
  // 선발 구성 인원은 STARTER_NEED(engine/transactions) 단일 출처. 픽 순서는 유지(각 pos 배타 필터라 결과 불변).
  const used = new Set<string>();
  const S = bestByPos(players, 'S', STARTER_NEED.S, used);
  const OH = bestByPos(players, 'OH', STARTER_NEED.OH, used);
  const MB = bestByPos(players, 'MB', STARTER_NEED.MB, used);
  const OP = bestByPos(players, 'OP', STARTER_NEED.OP, used);
  const libero = bestByPos(players, 'L', STARTER_NEED.L, used)[0] ?? null;

  // 대각 배치: 세터(0)↔아포짓(3), OH(1)↔OH(4), MB(2)↔MB(5)
  const slots: (Player | undefined)[] = [S[0], OH[0], MB[0], OP[0], OH[1], MB[1]];

  // 포지션 결손 시 잔여 비(非)리베로 선수로 채움
  const fallback = players.filter((p) => !used.has(p.id) && p.position !== 'L');
  let fi = 0;
  for (let i = 0; i < 6; i++) {
    if (!slots[i]) slots[i] = fallback[fi++] ?? players[i % players.length];
  }
  return { six: slots as Player[], libero };
}

const REST_GAME_RATE = 0.45;   // 굳은 순위에서 잔여 경기 중 휴식 발동 비율(ROTATION_MORALE #3)
const REST_SECOND_RATE = 0.4;  // 1명 휴식 시 2명째 추가 확률(라인업 붕괴 방지 — 최대 2명)

/** 로드 매니지먼트(#3) — 그 경기 쉬게 할 주전 집합. 순수: 같은 (avail·teamId·day)면 항상 같은 결과.
 *  고령 우선·동포지션 백업 있는 주전만(대체 가능)·리베로 제외·최대 2명. 순위 굳음 판정은 호출측(eligible). */
export function pickRest(avail: Player[], teamId: string, day: number): Set<string> {
  const rng = createRng(strSeed(`rest:${teamId}:${day}`));
  if (rng.next() >= REST_GAME_RATE) return new Set(); // 이 경기는 풀전력
  const lu = buildLineup(avail);
  const cnt: Record<string, number> = {};
  for (const p of avail) cnt[p.position] = (cnt[p.position] ?? 0) + 1;
  const restable = lu.six.filter((s) => (cnt[s.position] ?? 0) >= 2); // 본인+백업 → 빼도 그 포지션 채워짐
  if (!restable.length) return new Set();
  const sorted = [...restable].sort((a, b) => b.age - a.age || a.id.localeCompare(b.id)); // 고령 우선(결정론 tiebreak)
  const n = 1 + (sorted.length >= 2 && rng.next() < REST_SECOND_RATE ? 1 : 0);
  return new Set(sorted.slice(0, n).map((s) => s.id));
}
