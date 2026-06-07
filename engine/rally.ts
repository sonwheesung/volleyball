// 랠리 체인 판정 (CLAUDE.md 4.1/4.2, MATCH_SYSTEM 1~7장).
// 서브 → 리시브 → 세트 → 공격 ─┬ 득점(kill) / 블로킹 차단 / 공격 범실 / 디그(루프)
// 디그 성공 시 공수가 바뀌어 체인이 다시 돈다(한 점에 2~3바퀴). 시드 RNG 결정론.
//
// v1 구현 범위: 로테이션 전·후위, 리베로 후위 수비, 세터 승수, 기세(momentum),
//   VQ 포지션 폴트(1.4). 보류: 서브타입/공격방법 세분, 3축 블로킹, 찬스볼, 체력 hop(7.1).
//   모든 계수는 placeholder — 밸런싱 단계 튜닝.

import type { Rng } from './rng';
import type { Player, Position, Side } from '../types';
import type { Ratings } from './ratings';
import { frontRow, backRow, serverIndex } from './rotation';
import type { Lineup } from './lineup';

const n = (v: number) => v / 100;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 기세 → 능력 승수 (MATCH_SYSTEM 7.2). 0.92~1.08 */
export const momFactor = (m: number) => 0.92 + 0.0016 * m;

/** 공격 점유(포지션별) — 공격수 선택 가중 */
const ATTACK_SHARE: Record<Position, number> = { OP: 1.0, OH: 0.9, MB: 0.6, S: 0.1, L: 0 };

const CAP = 8; // 랠리 hop 상한(7.3) — 무한 루프 방지

export interface RallyTeam {
  six: Player[];          // 로테이션 슬롯 0..5
  libero: Player | null;
  rotation: number;       // 0..5
  momentum: number;       // 0..100 (세트 내 임시)
}

export type Rate = (p: Player) => Ratings;

const front = (t: RallyTeam) => frontRow(t.rotation).map((i) => t.six[i]).filter(Boolean) as Player[];
const back = (t: RallyTeam) => backRow(t.rotation).map((i) => t.six[i]).filter(Boolean) as Player[];
const server = (t: RallyTeam) => t.six[serverIndex(t.rotation)];
const setterOf = (t: RallyTeam) => t.six.find((p) => p.position === 'S') ?? t.six[0];

/** 후위 수비수 — 후위 MB는 리베로로 대체(리베로 후위 전담, 1.3 추상화) */
function defenders(t: RallyTeam): Player[] {
  return back(t).map((p) => (p.position === 'MB' && t.libero ? t.libero : p));
}

/** 리스트의 (0.5·최고 + 0.5·평균) 능력 — 대표 수비/블로킹 강도 */
function strength(players: Player[], pick: (r: Ratings) => number, R: Rate): number {
  if (players.length === 0) return 0.4;
  const vals = players.map((p) => n(pick(R(p))));
  const max = Math.max(...vals);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return 0.5 * max + 0.5 * avg;
}

/** 평균 VQ (포지션 폴트 판정용, 1.4) — 코트 6인 */
const teamVQ = (t: RallyTeam) => t.six.reduce((s, p) => s + p.vq, 0) / t.six.length / 100;

/** 공격수 선택 — 전위 3 + 후위 OH/OP(백어택 0.4) 가중[share × 스파이크] */
function pickAttacker(t: RallyTeam, R: Rate, rng: Rng): Player {
  const pool: { p: Player; w: number }[] = [];
  for (const p of front(t)) pool.push({ p, w: ATTACK_SHARE[p.position] * n(R(p).spike) });
  for (const p of back(t)) {
    if (p.position === 'OH' || p.position === 'OP') pool.push({ p, w: 0.4 * ATTACK_SHARE[p.position] * n(R(p).spike) });
  }
  const total = pool.reduce((s, x) => s + x.w, 0);
  if (total <= 0) return front(t)[0] ?? t.six[0];
  let r = rng.next() * total;
  for (const x of pool) {
    r -= x.w;
    if (r <= 0) return x.p;
  }
  return pool[pool.length - 1].p;
}

/** 팀별 능력 배수 — 홈 어드밴티지/플레이오프 시드 우위 등(기본 1.0) */
export interface Edge { home: number; away: number }
const NO_EDGE: Edge = { home: 1, away: 1 };

/**
 * 한 랠리를 끝까지 시뮬 → 득점한 쪽 반환.
 * @param serving 현재 서브권 측
 * @param edge 팀별 능력 배수(홈 어드밴티지 등)
 */
export function playRally(serving: Side, home: RallyTeam, away: RallyTeam, R: Rate, rng: Rng, edge: Edge = NO_EDGE): Side {
  const teamOf = (s: Side) => (s === 'home' ? home : away);
  const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');
  const eg = (s: Side) => (s === 'home' ? edge.home : edge.away);

  const serv = teamOf(serving);
  const recvSide = other(serving);
  const recv = teamOf(recvSide);

  // ── 서브 (MATCH_SYSTEM 2장 간이) ──
  const sv = n(R(server(serv)).serve) * momFactor(serv.momentum) * eg(serving);
  const recvSkill = strength(defenders(recv), (r) => r.receive, R) * momFactor(recv.momentum) * eg(recvSide);
  const aceP = clamp(0.05 + 0.18 * (sv - recvSkill), 0.01, 0.3);
  const errP = clamp(0.08 - 0.03 * sv, 0.02, 0.12);
  const s0 = rng.next();
  if (s0 < aceP) return serving;            // 서브 에이스
  if (s0 < aceP + errP) return recvSide;    // 서브 범실

  // ── 포지션 폴트 (1.4) — 평균 VQ 낮을수록 드물게 발생 → 즉시 실점 ──
  for (const side of [serving, recvSide] as Side[]) {
    const t = teamOf(side);
    const faultP = clamp(0.012 * (1 - teamVQ(t)), 0, 0.02);
    if (rng.next() < faultP) return other(side);
  }

  // ── 랠리 루프 (4.1) — 리시브 품질로 시작, 디그 성공 시 공수 전환 ──
  let att = recvSide;                                  // 리시브한 팀이 먼저 공격
  let q = clamp(0.55 + 0.6 * (recvSkill - sv) + rng.range(-0.15, 0.15), 0.1, 0.98); // 리시브 품질

  for (let hop = 0; hop < CAP; hop++) {
    const at = teamOf(att);
    const df = teamOf(other(att));
    const setMul = 0.85 + 0.3 * n(R(setterOf(at)).set);   // 세터 승수(0.85~1.15)
    const attacker = pickAttacker(at, R, rng);
    const qf = 0.6 + 0.5 * q;                              // 리시브/디그 품질 → 공격력
    const attackPower = n(R(attacker).spike) * setMul * qf * momFactor(at.momentum) * eg(att);
    const blockStr = strength(front(df), (r) => r.block, R) * momFactor(df.momentum) * eg(other(att));
    const digStr = strength(defenders(df), (r) => r.dig, R) * eg(other(att));

    const errP2 = clamp(0.1 - 0.06 * n(attacker.consistency), 0.03, 0.12);
    const blockP = clamp(0.1 + 0.3 * (blockStr - attackPower), 0.03, 0.35);
    const r1 = rng.next();
    if (r1 < errP2) return other(att);                   // 공격 범실
    if (r1 < errP2 + blockP) return other(att);          // 블로킹 차단

    const digP = clamp(0.35 + 0.45 * (digStr - attackPower), 0.05, 0.85);
    if (rng.next() < digP) {
      // 디그 성공 → 공수 전환, 전환 품질로 루프 지속
      q = clamp(0.4 + 0.4 * (digStr - attackPower) + rng.range(-0.1, 0.1), 0.1, 0.85);
      att = other(att);
      continue;
    }
    return att;                                           // 공격 성공(kill)
  }
  return att; // hop 상한 도달 시 현재 공격자 측 마무리
}
