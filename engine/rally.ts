// 랠리 체인 판정 (CLAUDE.md 4.1/4.2, MATCH_SYSTEM 1~9장).
// 서브 → 리시브 → 세트 → 공격 ─┬ 득점(kill) / 블로킹 차단 / 공격 범실 / 디그(루프)
// 디그 성공 시 공수가 바뀌어 체인이 다시 돈다(한 점에 2~3바퀴). 시드 RNG 결정론.
//
// v2 구현: 로테이션·전후위·리베로(1장), 서브타입(2장), 리시브품질(3장), 공격종류(4장),
//   공격방법/블록아웃·블로킹 3축(5장), 찬스볼(6장), 체력·기세(7장), 감독성향(8장),
//   케미·부상(9장). 보류: 타임아웃은 match.ts(세트 루프)에서 처리. 계수는 placeholder.

import type { Rng } from './rng';
import type { Player, Position, Side, CoachStyle } from '../types';
import type { Ratings } from './ratings';
import { frontRow, backRow, serverIndex } from './rotation';

const n = (v: number) => v / 100;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 기세 → 능력 승수 (7.2). 0.90~1.10 (런 스노볼 → 스윕↑) */
export const momFactor = (m: number) => 0.9 + 0.002 * m;

const ATTACK_SHARE: Record<Position, number> = { OP: 1.0, OH: 0.9, MB: 0.6, S: 0.1, L: 0 };
const CAP = 8; // 랠리 hop 상한(7.3)

// ── 체력 (7.1) ──
const STAM_FLOOR = 0.82;
const HOP_COST = 0.02;
export const STAM_REGEN_BASE = 0.05;
const INJ_EFF = 0.5; // 부상 시 효율 배수(9.3)

// ── 서브 타입 (2장) ── [에이스 기저, 범실 기저]
type ServeT = 'safe' | 'float' | 'jumpfloat' | 'spike';
const SERVE_ACE: Record<ServeT, number> = { safe: 0.005, float: 0.02, jumpfloat: 0.04, spike: 0.08 };
const SERVE_ERR: Record<ServeT, number> = { safe: 0.02, float: 0.05, jumpfloat: 0.09, spike: 0.16 };
const SERVE_DIFF: Record<ServeT, number> = { safe: -0.1, float: 0.04, jumpfloat: 0.1, spike: 0.18 }; // 리시브 난이도(q 하락)

// ── 공격 종류 (4장) ── blockAvoid: 막기 어려움. atkErr: 빠른 공격일수록 범실 리스크↑(트레이드오프)
type Atk = 'quick' | 'tempo' | 'open' | 'back';
const BLOCK_AVOID: Record<Atk, number> = { quick: 1.14, tempo: 1.08, back: 1.03, open: 0.98 };
const ATK_ERR: Record<Atk, number> = { quick: 0.05, tempo: 0.03, back: 0.012, open: 0 };
const FAKE: Record<Atk, number> = { quick: 1, tempo: 1, back: 0, open: 0 };

const CHANCE_Q = 0.32; // 이 이하 리시브/디그 품질이면 찬스볼(6장)

export interface RallyTeam {
  six: Player[];
  libero: Player | null;
  rotation: number;
  momentum: number;            // 0..100 (세트 내 임시)
  stam: Map<string, number>;   // 선수 id → 체력 잔량(0..1)
  injured: Set<string>;        // 경기 중 부상자(효율 급감)
  style: CoachStyle;           // 감독 성향(8장)
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

/** 체력·부상 효율 */
const eff = (t: RallyTeam, p: Player) => {
  const f = t.stam.get(p.id);
  const s = STAM_FLOOR + (1 - STAM_FLOOR) * (f == null ? 1 : f);
  return t.injured.has(p.id) ? s * INJ_EFF : s;
};

function drain(t: RallyTeam, p: Player, mult: number): void {
  const cur = t.stam.get(p.id);
  if (cur == null) return;
  t.stam.set(p.id, Math.max(0, cur - (HOP_COST * mult) / (0.6 + n(p.staminaMax) * 0.8)));
}

/** 부상 판정(9.3) — 노쇠·체력 고갈 시 ↑. 경기 한정(시즌 영향 없음). */
function maybeInjure(t: RallyTeam, p: Player, rng: Rng): void {
  if (t.injured.has(p.id)) return;
  const frac = t.stam.get(p.id) ?? 1;
  const ageF = 1 + Math.max(0, p.age - 30) * 0.15;
  const tiredF = 1 + (1 - frac) * 1.5;
  if (rng.next() < 0.0006 * ageF * tiredF) t.injured.add(p.id);
}

function strength(players: Player[], pick: (r: Ratings) => number, R: Rate, t: RallyTeam): number {
  if (players.length === 0) return 0.4;
  const vals = players.map((p) => n(pick(R(p))) * eff(t, p));
  const max = Math.max(...vals);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return 0.5 * max + 0.5 * avg;
}

const teamVQ = (t: RallyTeam) => t.six.reduce((s, p) => s + p.vq, 0) / t.six.length / 100;

/** 서브 타입 선택 (2장) — 서브 능력·집중력·감독 성향이 공격성을 정한다 */
function chooseServe(p: Player, style: CoachStyle, rng: Rng): ServeT {
  const styleAdj = style === 'attack' ? 0.12 : style === 'defense' ? -0.1 : 0;
  const aggr = n(p.skServe) * 0.6 + 0.2 * n(p.focus) + styleAdj + rng.range(-0.12, 0.12);
  if (aggr > 0.7) return 'spike';
  if (aggr > 0.46) return 'jumpfloat';
  if (aggr > 0.2) return 'float';
  return 'safe';
}

/** 공격 종류 선택 (4장) — 리시브 품질·세터 능력·감독 성향 */
function chooseAtk(q: number, setQ: number, setVQ: number, style: CoachStyle, rng: Rng): Atk {
  if (q < CHANCE_Q) return rng.next() < 0.7 ? 'open' : 'back'; // 찬스볼(6장): 빠른 공격 불가
  const fast = clamp((q - 0.5) * 2, 0, 1) * (0.4 + 0.6 * setQ) * (0.5 + 0.5 * setVQ);
  const fastBias = style === 'attack' ? 1.2 : style === 'defense' ? 0.85 : 1;
  const w: Record<Atk, number> = {
    open: style === 'defense' ? 1.15 : 1.0,
    back: 0.35 * (q > 0.4 ? 1 : 0.25),
    quick: 1.1 * fast * fastBias,
    tempo: 0.7 * fast * fastBias,
  };
  const tot = w.open + w.back + w.quick + w.tempo;
  let r = rng.next() * tot;
  for (const k of ['quick', 'tempo', 'back', 'open'] as Atk[]) { r -= w[k]; if (r <= 0) return k; }
  return 'open';
}

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

/** 세터-공격수 케미(9.2 근사) — 같은 구단 근속이 길수록 호흡↑(0~1) */
function chemistry(setter: Player, attacker: Player): number {
  return clamp(Math.min(setter.clubTenure, attacker.clubTenure) / 6, 0, 1);
}

/** 블로킹 3축 (5.2): 인원·타이밍(리드/커밋)·강도. 감독 성향이 스터프/소프트 선호를 가른다 */
function blockEval(df: RallyTeam, atk: Atk, R: Rate, rng: Rng): { str: number } {
  const fr = front(df);
  if (!fr.length) return { str: 0.4 };
  const readiness = fr.reduce((s, p) => s + (n(p.reaction) + n(p.vq)) / 2, 0) / fr.length;
  const isRead = rng.next() < clamp(0.2 + 0.5 * readiness, 0.05, 0.9);
  let count = atk === 'quick' ? 1 : atk === 'open' ? (rng.next() < 0.5 ? 2 : 3)
    : atk === 'tempo' ? (rng.next() < 0.6 ? 1 : 2) : (rng.next() < 0.5 ? 1 : 2);
  count = Math.min(count, fr.length);
  const sorted = fr.slice().sort((a, b) => n(R(b).block) - n(R(a).block)).slice(0, count);
  const vals = sorted.map((p) => n(R(p).block) * eff(df, p));
  for (const p of sorted) drain(df, p, 0.4);
  const skill = 0.5 * Math.max(...vals) + 0.5 * (vals.reduce((a, b) => a + b, 0) / vals.length);
  const fooled = FAKE[atk] && !isRead ? 0.7 : 1.0;
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

  // ── 서브 (2장) ── 타입별 (에이스·범실·난이도) 트레이드오프
  const sp = server(serv);
  drain(serv, sp, 1);
  const st = chooseServe(sp, serv.style, rng);
  const svPow = n(R(sp).serve) * momFactor(serv.momentum) * eg(serving) * eff(serv, sp);
  const recvSkill = strength(defenders(recv), (r) => r.receive, R, recv) * momFactor(recv.momentum) * eg(recvSide);
  const aceP = clamp(SERVE_ACE[st] * (0.5 + svPow) + 0.12 * (svPow - recvSkill), 0.003, 0.18);
  const errP = clamp(SERVE_ERR[st] * (1.3 - 0.5 * n(sp.focus)), 0.01, 0.24);
  const s0 = rng.next();
  if (s0 < aceP) return serving;            // 서브 에이스
  if (s0 < aceP + errP) return recvSide;    // 서브 범실

  // ── 포지션 폴트 (1.4) ──
  for (const side of [serving, recvSide] as Side[]) {
    const t = teamOf(side);
    if (rng.next() < clamp(0.012 * (1 - teamVQ(t)), 0, 0.02)) return other(side);
  }

  // ── 랠리 루프 (4·5·6장) ── 서브 난이도만큼 첫 리시브 품질 하락
  let att = recvSide;
  let q = clamp(0.58 + 0.6 * (recvSkill - svPow) - SERVE_DIFF[st] + rng.range(-0.15, 0.15), 0.08, 0.98);

  for (let hop = 0; hop < CAP; hop++) {
    const at = teamOf(att);
    const df = teamOf(other(att));
    const setter = setterOf(at);
    const setQ = n(R(setter).set) * eff(at, setter);
    const atk = chooseAtk(q, setQ, n(setter.vq), at.style, rng);
    const attacker = pickAttacker(at, atk, R, rng);
    drain(at, attacker, 1);
    maybeInjure(at, attacker, rng);

    const chem = (atk === 'quick' || atk === 'tempo') ? 0.12 * chemistry(setter, attacker) : 0; // 케미(9.2)
    const chanceBall = q < CHANCE_Q ? 0.85 : 1; // 찬스볼은 세트 품질 하락(6장)
    const setMul = (0.85 + 0.3 * setQ + chem) * chanceBall;
    const qf = 0.6 + 0.5 * q;
    const atkStyleMul = at.style === 'attack' ? 1.03 : 1; // 공격형: 화력 소폭↑
    const serveDisadv = att === serving ? 0.9 : 1; // 서브한 팀은 전환 공격 불리(서브 직후 out-of-system) → 사이드아웃↑
    const attackPower = n(R(attacker).spike) * setMul * BLOCK_AVOID[atk] * qf * momFactor(at.momentum) * eg(att) * eff(at, attacker) * atkStyleMul * serveDisadv;
    const blk = blockEval(df, atk, R, rng);
    const firstBall = hop === 0; // 리시브 후 첫 공격(인시스템) — 서브한 팀의 블록이 미완성
    const blkStr = blk.str * (firstBall ? 0.74 : 1);

    // 좋은 패스(높은 q)면 깔끔히 결정(범실↓→사이드아웃↑), 난조면 범실 급증. 기복·VQ가 낮춤
    const errP2 = clamp(0.16 - 0.09 * q + ATK_ERR[atk] - 0.05 * n(attacker.consistency) - 0.03 * n(attacker.vq), 0.04, 0.28);
    const blockP = clamp(0.07 + 0.4 * (blkStr - attackPower), 0.02, 0.4);
    const r1 = rng.next();
    if (r1 < errP2) return other(att);                          // 공격 범실
    if (r1 < errP2 + blockP) {
      // 공격방법(5.1): 영리한 공격수는 블록아웃/툴샷으로 살린다(VQ↑일수록)
      const blockOutP = clamp(0.12 + 0.35 * n(attacker.vq) - 0.15, 0.04, 0.4);
      if (rng.next() < blockOutP) return att;                    // 블록아웃 득점
      const stuffPref = df.style === 'attack' ? 0.06 : df.style === 'defense' ? -0.06 : 0;
      const stuffProb = clamp(0.27 + stuffPref + 0.7 * (blkStr - attackPower), 0.05, 0.8);
      if (rng.next() < stuffProb) return other(att);            // 스터프 블록 득점
      q = clamp(0.7 + rng.range(-0.1, 0.1), 0.4, 0.92);          // 소프트 블록 → 수비측 좋은 전환
      att = other(att);
      continue;
    }

    const defStyleBonus = df.style === 'defense' ? 0.05 : 0; // 수비형: 디그 이점
    const digStr = strength(defenders(df), (r) => r.dig, R, df) * momFactor(df.momentum);
    const digP = clamp(0.46 + defStyleBonus + 0.6 * (digStr - attackPower), 0.05, 0.9); // 디그↑(랠리 길게)·스킬 민감도↑
    if (rng.next() < digP) {
      q = clamp(0.4 + 0.4 * (digStr - attackPower) + rng.range(-0.1, 0.1), 0.1, 0.85);
      att = other(att);
      continue;
    }
    return att;                                                 // 공격 성공(kill)
  }
  return att;
}
