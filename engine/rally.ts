// 랠리 체인 판정 (CLAUDE.md 4.1/4.2, MATCH_SYSTEM 1~7장).
// 서브 → 리시브 → 세트 → 공격 ─┬ 득점(kill) / 블로킹 차단 / 공격 범실 / 디그(루프)
// 디그 성공 시 공수가 바뀌어 체인이 다시 돈다(한 점에 2~3바퀴). 시드 RNG 결정론.
//
// v1.1 구현: 로테이션 전·후위, 리베로 후위 수비, 세터 승수, VQ 포지션 폴트(1.4),
//   기세(7.2), 공격 종류(4장), 블로킹 3축(5.2), 체력 소모/효율(7.1).
//   보류: 서브타입(2장), 타임아웃/감독성향(7.4/8장), 케미·부상(9장). 계수는 placeholder.

import type { Rng } from './rng';
import type { Player, Position, Side } from '../types';
import type { Ratings } from './ratings';
import { frontRow, backRow, serverIndex } from './rotation';

const n = (v: number) => v / 100;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 기세 → 능력 승수 (MATCH_SYSTEM 7.2). 0.92~1.08 */
export const momFactor = (m: number) => 0.92 + 0.0016 * m;

const ATTACK_SHARE: Record<Position, number> = { OP: 1.0, OH: 0.9, MB: 0.6, S: 0.1, L: 0 };
const CAP = 8; // 랠리 hop 상한(7.3)

// ── 체력 (7.1) ──
const STAM_FLOOR = 0.82;        // 완전 방전 시 효율 하한
const HOP_COST = 0.02;          // 공격 1회 기준 소모(블록은 ×0.4)
export const STAM_REGEN_BASE = 0.05; // 랠리 사이 회복 기본(match.ts에서 사용)

// ── 공격 종류 (4장) ── blockAvoid: 높을수록 막기 어려움. fake: 커밋 블록 교란(속공/시간차)
type Atk = 'quick' | 'tempo' | 'open' | 'back';
const BLOCK_AVOID: Record<Atk, number> = { quick: 1.2, tempo: 1.12, back: 1.04, open: 0.96 };
const FAKE: Record<Atk, number> = { quick: 1, tempo: 1, back: 0, open: 0 };

export interface RallyTeam {
  six: Player[];
  libero: Player | null;
  rotation: number;
  momentum: number;            // 0..100 (세트 내 임시)
  stam: Map<string, number>;   // 선수 id → 체력 잔량(0..1)
}

export type Rate = (p: Player) => Ratings;

export interface Edge { home: number; away: number }
const NO_EDGE: Edge = { home: 1, away: 1 };

const front = (t: RallyTeam) => frontRow(t.rotation).map((i) => t.six[i]).filter(Boolean) as Player[];
const back = (t: RallyTeam) => backRow(t.rotation).map((i) => t.six[i]).filter(Boolean) as Player[];
const server = (t: RallyTeam) => t.six[serverIndex(t.rotation)];
const setterOf = (t: RallyTeam) => t.six.find((p) => p.position === 'S') ?? t.six[0];

/** 후위 수비수 — 후위 MB는 리베로로 대체(1.3 추상화) */
function defenders(t: RallyTeam): Player[] {
  return back(t).map((p) => (p.position === 'MB' && t.libero ? t.libero : p));
}

/** 체력 효율 (0.82~1.0) */
const eff = (t: RallyTeam, p: Player) => {
  const f = t.stam.get(p.id);
  return STAM_FLOOR + (1 - STAM_FLOOR) * (f == null ? 1 : f);
};

/** 체력 소모 — 체력(staminaMax) 높을수록 덜 지친다 */
function drain(t: RallyTeam, p: Player, mult: number): void {
  const cur = t.stam.get(p.id);
  if (cur == null) return;
  t.stam.set(p.id, Math.max(0, cur - (HOP_COST * mult) / (0.6 + n(p.staminaMax) * 0.8)));
}

/** (0.5·최고 + 0.5·평균) 능력 — 체력 효율 반영 */
function strength(players: Player[], pick: (r: Ratings) => number, R: Rate, t: RallyTeam): number {
  if (players.length === 0) return 0.4;
  const vals = players.map((p) => n(pick(R(p))) * eff(t, p));
  const max = Math.max(...vals);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return 0.5 * max + 0.5 * avg;
}

const teamVQ = (t: RallyTeam) => t.six.reduce((s, p) => s + p.vq, 0) / t.six.length / 100;

/** 공격 종류 선택 (4장) — 리시브 품질·세터 능력이 좋을수록 속공/시간차 가능 */
function chooseAtk(q: number, setQ: number, setVQ: number, rng: Rng): Atk {
  const fast = clamp((q - 0.5) * 2, 0, 1) * (0.4 + 0.6 * setQ) * (0.5 + 0.5 * setVQ);
  const w: Record<Atk, number> = {
    open: 1.0,
    back: 0.35 * (q > 0.4 ? 1 : 0.25),
    quick: 1.1 * fast,
    tempo: 0.7 * fast,
  };
  const tot = w.open + w.back + w.quick + w.tempo;
  let r = rng.next() * tot;
  for (const k of ['quick', 'tempo', 'back', 'open'] as Atk[]) { r -= w[k]; if (r <= 0) return k; }
  return 'open';
}

/** 공격자 선택 — 공격 종류에 맞는 포지션 풀에서 가중[스파이크] */
function pickAttacker(t: RallyTeam, atk: Atk, R: Rate, rng: Rng): Player {
  const fr = front(t);
  const bk = back(t);
  const pool: { p: Player; w: number }[] = [];
  if (atk === 'quick' || atk === 'tempo') {
    for (const p of fr) if (p.position === 'MB') pool.push({ p, w: n(R(p).spike) });
    if (!pool.length) for (const p of fr) pool.push({ p, w: ATTACK_SHARE[p.position] * n(R(p).spike) });
  } else if (atk === 'back') {
    for (const p of bk) if (p.position === 'OH' || p.position === 'OP') pool.push({ p, w: n(R(p).spike) });
    if (!pool.length) for (const p of fr) pool.push({ p, w: ATTACK_SHARE[p.position] * n(R(p).spike) });
  } else {
    for (const p of fr) if (p.position !== 'MB' && p.position !== 'S') pool.push({ p, w: ATTACK_SHARE[p.position] * n(R(p).spike) });
    if (!pool.length) for (const p of fr) pool.push({ p, w: ATTACK_SHARE[p.position] * n(R(p).spike) });
  }
  const tot = pool.reduce((s, x) => s + x.w, 0);
  if (tot <= 0) return fr[0] ?? t.six[0];
  let r = rng.next() * tot;
  for (const x of pool) { r -= x.w; if (r <= 0) return x.p; }
  return pool[pool.length - 1].p;
}

/** 블로킹 3축 (5.2): 인원(1~3)·타이밍(리드/커밋)·강도. 페이크엔 커밋 블록이 약해짐 */
function blockEval(df: RallyTeam, atk: Atk, R: Rate, rng: Rng): { str: number } {
  const fr = front(df);
  if (!fr.length) return { str: 0.4 };
  const readiness = fr.reduce((s, p) => s + (n(p.reaction) + n(p.vq)) / 2, 0) / fr.length;
  const isRead = rng.next() < clamp(0.15 + 0.75 * readiness, 0.05, 0.9); // 리드 블록 성공 여부
  let count = atk === 'quick' ? 1 : atk === 'open' ? (rng.next() < 0.5 ? 2 : 3)
    : atk === 'tempo' ? (rng.next() < 0.6 ? 1 : 2) : (rng.next() < 0.5 ? 1 : 2);
  count = Math.min(count, fr.length);
  const sorted = fr.slice().sort((a, b) => n(R(b).block) - n(R(a).block)).slice(0, count);
  const vals = sorted.map((p) => n(R(p).block) * eff(df, p));
  for (const p of sorted) drain(df, p, 0.4);
  const skill = 0.5 * Math.max(...vals) + 0.5 * (vals.reduce((a, b) => a + b, 0) / vals.length);
  const fooled = FAKE[atk] && !isRead ? 0.55 : 1.0; // 커밋 블록이 속공/시간차에 헛손질
  return { str: skill * (0.72 + 0.14 * count) * fooled * momFactor(df.momentum) };
}

/**
 * 한 랠리를 끝까지 시뮬 → 득점한 쪽 반환.
 * @param edge 팀별 능력 배수(홈 어드밴티지 등)
 */
export function playRally(serving: Side, home: RallyTeam, away: RallyTeam, R: Rate, rng: Rng, edge: Edge = NO_EDGE): Side {
  const teamOf = (s: Side) => (s === 'home' ? home : away);
  const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');
  const eg = (s: Side) => (s === 'home' ? edge.home : edge.away);

  const serv = teamOf(serving);
  const recvSide = other(serving);
  const recv = teamOf(recvSide);

  // ── 서브 (2장 간이) ──
  const sp = server(serv);
  drain(serv, sp, 1);
  const sv = n(R(sp).serve) * momFactor(serv.momentum) * eg(serving) * eff(serv, sp);
  const recvSkill = strength(defenders(recv), (r) => r.receive, R, recv) * momFactor(recv.momentum) * eg(recvSide);
  const aceP = clamp(0.05 + 0.18 * (sv - recvSkill), 0.01, 0.3);
  const errP = clamp(0.08 - 0.03 * sv, 0.02, 0.12);
  const s0 = rng.next();
  if (s0 < aceP) return serving;
  if (s0 < aceP + errP) return recvSide;

  // ── 포지션 폴트 (1.4) ──
  for (const side of [serving, recvSide] as Side[]) {
    const t = teamOf(side);
    if (rng.next() < clamp(0.012 * (1 - teamVQ(t)), 0, 0.02)) return other(side);
  }

  // ── 랠리 루프 (4·5장) ──
  let att = recvSide;
  let q = clamp(0.55 + 0.6 * (recvSkill - sv) + rng.range(-0.15, 0.15), 0.1, 0.98);

  for (let hop = 0; hop < CAP; hop++) {
    const at = teamOf(att);
    const df = teamOf(other(att));
    const setter = setterOf(at);
    const setQ = n(R(setter).set) * eff(at, setter);
    const atk = chooseAtk(q, setQ, n(setter.vq), rng);
    const attacker = pickAttacker(at, atk, R, rng);
    drain(at, attacker, 1);

    const setMul = 0.85 + 0.3 * setQ;             // 세터 승수
    const qf = 0.6 + 0.5 * q;                      // 리시브/디그 품질
    const attackPower = n(R(attacker).spike) * setMul * BLOCK_AVOID[atk] * qf * momFactor(at.momentum) * eg(att) * eff(at, attacker);
    const blk = blockEval(df, atk, R, rng);

    const errP2 = clamp(0.1 - 0.06 * n(attacker.consistency), 0.03, 0.12);
    const blockP = clamp(0.1 + 0.32 * (blk.str - attackPower), 0.02, 0.4);
    const r1 = rng.next();
    if (r1 < errP2) return other(att);                          // 공격 범실
    if (r1 < errP2 + blockP) {
      const stuffProb = clamp(0.35 + 0.7 * (blk.str - attackPower), 0.05, 0.85);
      if (rng.next() < stuffProb) return other(att);            // 스터프(공격적) 블록 득점
      q = clamp(0.7 + rng.range(-0.1, 0.1), 0.4, 0.92);          // 소프트 블록 → 수비측 좋은 전환
      att = other(att);
      continue;
    }

    const digStr = strength(defenders(df), (r) => r.dig, R, df) * momFactor(df.momentum);
    const digP = clamp(0.33 + 0.45 * (digStr - attackPower), 0.05, 0.85);
    if (rng.next() < digP) {
      q = clamp(0.4 + 0.4 * (digStr - attackPower) + rng.range(-0.1, 0.1), 0.1, 0.85);
      att = other(att);
      continue;
    }
    return att;                                                 // 공격 성공(kill)
  }
  return att;
}
