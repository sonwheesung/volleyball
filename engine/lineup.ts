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

// ── 육성 철학(dvPhilosophy) U23 기용 에지 (STAFF_SYSTEM §9.6-D) ──
//   육성형 감독(dvPhilosophy 높음)은 **실력이 근접한** U23에게 코트를 더 준다. **역전 금지**: OVR 큰 격차는
//   못 뒤집는다 — 에지 상한(U23_LINEUP_EDGE) 이내의 근소 차만 우선. dvPhilosophy≤50이면 에지 0(승부형=주전 위주).
//   기본값 0(=neutral) → 기존 호출부 전부 byte-동일(에지 미가산). 감독 자동 라인업 경로만 실제 dvPhilosophy 주입.
export const U23_AGE = 23;
export const U23_LINEUP_EDGE = 2; // dvPhilosophy 100에서 U23이 얻는 최대 OVR 우선권(정수 OVR 기준 ≤2점 격차만 역전)
/** U23 기용 에지(OVR 가산). 비-U23·dvPhilosophy≤50이면 0. dvPhilosophy 100→최대 U23_LINEUP_EDGE. */
export function u23Edge(p: Player, dvPhilosophy: number): number {
  if (p.age > U23_AGE) return 0;
  const t = Math.max(0, (dvPhilosophy - 50) / 50); // 50→0, 100→1
  return U23_LINEUP_EDGE * t;
}

function bestByPos(players: Player[], pos: Position, n: number, used: Set<string>, dvPhilosophy: number, force: ReadonlySet<string>): Player[] {
  const picked = players
    .filter((p) => p.position === pos && !used.has(p.id))
    // 강제 선발(force, ROTATION_MORALE F 신인 등용)은 OVR과 무관히 슬롯 상위 점유 — force-first, 그다음 OVR.
    // force 빈 셋이면 fa===fb===0 → 순수 OVR 정렬 = 기존과 byte-동일(전 호출부 불변 보장).
    .sort((a, b) => {
      const fa = force.has(a.id) ? 1 : 0, fb = force.has(b.id) ? 1 : 0;
      if (fa !== fb) return fb - fa;
      return (overall(b) + u23Edge(b, dvPhilosophy)) - (overall(a) + u23Edge(a, dvPhilosophy));
    })
    .slice(0, n);
  picked.forEach((p) => used.add(p.id));
  return picked;
}

/** 로스터 → 주전 6인 로테이션 배열 + 리베로. 결손 포지션은 잔여 선수로 방어 충원.
 *  빈 로스터는 명시적 거부 — 시즌 계층(부상 상한 3·방출 하한 ROSTER_MIN)이 원천 차단해야 하는 상태.
 *  @param dvPhilosophy 감독 육성 철학(0~100, STAFF §9.6-D) — U23 근소차 우선권. 기본 0=neutral(에지 미가산, byte-동일).
 *  @param force 강제 선발 id(ROTATION_MORALE F 신인 등용) — 지정 id는 OVR 무관 해당 포지션 슬롯 우선 진입. 기본 빈 셋 = byte-동일. */
export function buildLineup(players: Player[], dvPhilosophy = 0, force: ReadonlySet<string> = EMPTY_FORCE): Lineup {
  if (players.length === 0) throw new Error('빈 로스터 — 라인업을 구성할 수 없습니다(시즌 계층 가드 위반)');
  // 선발 구성 인원은 STARTER_NEED(engine/transactions) 단일 출처. 픽 순서는 유지(각 pos 배타 필터라 결과 불변).
  const used = new Set<string>();
  const S = bestByPos(players, 'S', STARTER_NEED.S, used, dvPhilosophy, force);
  const OH = bestByPos(players, 'OH', STARTER_NEED.OH, used, dvPhilosophy, force);
  const MB = bestByPos(players, 'MB', STARTER_NEED.MB, used, dvPhilosophy, force);
  const OP = bestByPos(players, 'OP', STARTER_NEED.OP, used, dvPhilosophy, force);
  const libero = bestByPos(players, 'L', STARTER_NEED.L, used, dvPhilosophy, force)[0] ?? null;

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

// 공용 빈 force 셋(공유 참조 — 매 호출 재할당 회피, 절대 mutate 금지: buildLineup은 읽기만).
const EMPTY_FORCE: ReadonlySet<string> = new Set<string>();

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

// ── 신인 등용(ROTATION_MORALE F) — PO 탈락 확정 팀이 잔여 경기에 신인을 선발 승격 ──
const PROMOTE_GAME_RATE = 0.5;    // 탈락 확정 후 잔여 경기 중 등용 발동 비율(휴식 rest: 스트림과 독립)
const PROMOTE_SECOND_RATE = 0.4;  // 1명 승격 시 2명째 추가 확률(휴식 REST_SECOND_RATE 대칭)
export const PROMOTE_MAX_SEASONS = 0; // 신인 정의: career.seasons ≤ 이 값(=0, 데뷔 전=신인상 풀 일치). F.8 실측 확정
const SIX_SLOTS: Record<Position, number> = { S: 1, OH: 2, MB: 2, OP: 1, L: 1 }; // 슬롯 수(같은 단일슬롯에 2명 강제 방지)

/** 로드매니지먼트 대칭 — 그 경기 선발로 올릴 신인 집합(force 셋). 순수: 같은 (avail·teamId·day·restCount)면 항상 동일.
 *  @param avail  **휴식(rest) 제외 후**의 출전 가능 명단(승격은 여기서 비선발 신인을 끌어올림).
 *  @param restCount 같은 날 휴식으로 빠진 주전 수 — 승격+휴식 총 이탈 주전 ≤3 상한(maxPromote=min(2,3−restCount)).
 *  발동 자격(eliminated·clinch day−1)은 호출측이 이미 게이트. 미발동 경기는 빈 셋 → buildLineup byte-동일. */
export function pickPromote(avail: Player[], teamId: string, day: number, restCount = 0): Set<string> {
  const rng = createRng(strSeed(`dev:${teamId}:${day}`));
  if (rng.next() >= PROMOTE_GAME_RATE) return new Set(); // 이 경기는 등용 없음(주전 그대로)
  const maxPromote = Math.min(2, 3 - restCount);
  if (maxPromote <= 0) return new Set();
  // 현 default 선발(dv=0 neutral — pickRest와 동일 기준, 3경로 동일 집합 보장). 이미 선발인 신인은 승격 대상 아님(no-op 방지).
  const lu0 = buildLineup(avail);
  const starters = new Set(lu0.six.map((p) => p.id));
  if (lu0.libero) starters.add(lu0.libero.id);
  const rookies = avail
    .filter((p) => p.career.seasons <= PROMOTE_MAX_SEASONS && !starters.has(p.id))
    .sort((a, b) => (overall(b) - overall(a)) || a.id.localeCompare(b.id)); // 준비된 유망주 우선(결정론 tiebreak)
  if (!rookies.length) return new Set();
  // 슬롯 용량 내에서만 강제(같은 단일슬롯 포지션에 2명 넣어 무효화되는 것 방지 = 유효 승격만 카운트)
  const usedSlot: Record<string, number> = {};
  const roll2 = rng.next(); // 2명째 여부(선발 순서 무관 결정)
  const cap = maxPromote >= 2 && roll2 < PROMOTE_SECOND_RATE ? 2 : 1;
  const out = new Set<string>();
  for (const p of rookies) {
    if (out.size >= cap) break;
    if ((usedSlot[p.position] ?? 0) >= SIX_SLOTS[p.position]) continue;
    usedSlot[p.position] = (usedSlot[p.position] ?? 0) + 1;
    out.add(p.id);
  }
  return out;
}
