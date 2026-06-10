// 랠리 체인 판정 (CLAUDE.md 4.1/4.2, MATCH_SYSTEM 1~9장).
// 서브 → 리시브 → 세트 → 공격 ─┬ 득점(kill) / 블로킹 차단 / 공격 범실 / 디그(루프)
// 디그 성공 시 공수가 바뀌어 체인이 다시 돈다(한 점에 2~3바퀴). 시드 RNG 결정론.
//
// v2 구현: 로테이션·전후위·리베로(1장), 서브타입(2장), 리시브품질(3장), 공격종류(4장),
//   공격방법/블록아웃·블로킹 3축(5장), 찬스볼(6장), 체력·기세(7장), 감독성향(8장),
//   케미·부상(9장). 보류: 타임아웃은 match.ts(세트 루프)에서 처리. 계수는 placeholder.

import { type Rng, strSeed } from './rng';
import type { Player, Position, Side, CoachStyle } from '../types';
import type { Ratings } from './ratings';
import { frontRow, backRow, serverIndex } from './rotation';
import { type Pt, zoneXY, playerXY, serveSpot, dist, jitter, COURT } from './court';
import type { Tele, AtkResult, QuickKind } from './events';
import { serveLanding, tossLanding, attackCourse } from './spatial';
import { clutchFocusAdj, serveAggrAdj } from './traits';

const n = (v: number) => v / 100;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 기세 → 능력 승수 (7.2). 0.94~1.06 — KOVO 세트 점수차(4~6)·듀스 비율 정렬(2026-06.
 *  ±10%는 스노볼 과강: 패자 평균 17.6·점수차 7.6·듀스 6%로 일방적 세트 과다) */
export const momFactor = (m: number) => 0.96 + 0.0008 * m;

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
// 공격 화력 보정: 표시 spike를 풀스케일로 올린 만큼(ratings.ts) 엔진 화력을 옛 캘리브레이션으로 되돌림.
// 표시 spike(n≈0.63) × ATK_K ≈ 옛 spike(n≈0.40). 킬·스터프 KOVO 분포 유지.
const ATK_K = 0.64;
// 블로킹 보정: 표시 block 키 스케일 상향(ratings.ts blockHeight, 평균 57→60) 만큼 엔진 강도 환원.
// 0.91 = 주블로커(MB) 기준 비율(65→71) — 스터프% 기준선(~9.6) 유지.
const BLK_K = 0.91;
const FAKE: Record<Atk, number> = { quick: 1, tempo: 1, back: 0, open: 0 };

const CHANCE_Q = 0.32; // 이 이하 리시브/디그 품질이면 찬스볼(6장)

// 트레이스(디버그) 한글 라벨
const SERVE_KO: Record<ServeT, string> = { safe: '안전서브', float: '플로터', jumpfloat: '점프플로터', spike: '스파이크서브' };
const ATK_KO: Record<Atk, string> = { quick: '속공(센터)', tempo: '시간차(센터)', open: '오픈(레프트/라이트)', back: '후위공격' };
const QK_KO: Record<QuickKind, string> = { A: 'A퀵', B: 'B퀵', slide: '이동속공' };
const qLabel = (q: number) => (q >= 0.6 ? '좋음' : q < 0.45 ? '난조' : '보통');

// 속공 세부 종류 — 난수 없이 상황으로 결정(승패 불변·결정론). 패스 품질·세터 VQ·미들 신장/성향.
//   좋은 패스 + 슬라이드 성향 장신 미들 → 이동속공 / 좋은 패스 + 영리한 세터 → A퀵(빠르고 타이트) / 그 외 안전한 B퀵.
function quickKindOf(q: number, setter: Player, attacker: Player): QuickKind {
  const slideApt = attacker.height >= 188 && (strSeed(attacker.id) & 1) === 0; // 이동 잘하는 장신 미들(고정 성향)
  if (q >= 0.6 && slideApt) return 'slide';          // 좋은 패스 + 슬라이드형 장신 → 이동속공(상황적)
  if (q >= 0.58 && n(setter.vq) >= 0.6) return 'A';  // 좋은 패스 + 영리한 세터 → 빠른 A퀵(주력)
  return 'B';                                         // 그 외 안전한 B퀵(가장 흔함)
}

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

/** 후위 수비수 — 후위 MB는 리베로로 대체(1.3 추상화). 디그(전체 코트 수비) 담당. */
function defenders(t: RallyTeam): Player[] {
  return back(t).map((p) => (p.position === 'MB' && t.libero ? t.libero : p));
}

/** 서브 리시브 담당 — 리베로 + 아웃사이드(OH) 전원(W형). 세터·OP·MB는 숨김(현실 KOVO 5-1). */
function receivers(t: RallyTeam): Player[] {
  const ohs = t.six.filter((p) => p.position === 'OH');
  const grp = t.libero ? [t.libero, ...ohs] : ohs;
  return grp.length ? grp : defenders(t);
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
  const styleAdj = style === 'attack' ? 0.12 : style === 'defense' ? -0.05 : 0;
  const aggr = n(p.skServe) * 0.6 + 0.2 * n(p.focus) + styleAdj + serveAggrAdj(p.traits) + rng.range(-0.12, 0.12);
  if (aggr > 0.7) return 'spike';
  if (aggr > 0.46) return 'jumpfloat';
  if (aggr > 0.2) return 'float';
  return 'safe';
}

/** 공격 종류 선택 (4장) — 리시브 품질·세터 능력·감독 성향 */
function chooseAtk(q: number, setQ: number, setVQ: number, style: CoachStyle, rng: Rng): Atk {
  if (q < CHANCE_Q) return rng.next() < 0.7 ? 'open' : 'back'; // 찬스볼(6장): 빠른 공격 불가
  // 좋은 패스일수록 센터 속공↑(현실 여자배구 센터 비중 ~15~20%로 상향, 2026-06)
  const fast = clamp((q - 0.44) * 2, 0, 1) * (0.4 + 0.6 * setQ) * (0.5 + 0.5 * setVQ);
  const fastBias = style === 'attack' ? 1.2 : style === 'defense' ? 0.85 : 1;
  const w: Record<Atk, number> = {
    open: style === 'defense' ? 1.15 : 1.0,
    back: 0.35 * (q > 0.4 ? 1 : 0.25),
    quick: 1.6 * fast * fastBias,
    tempo: 1.0 * fast * fastBias,
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
function blockEval(df: RallyTeam, atk: Atk, R: Rate, rng: Rng): { str: number; count: number; blockers: Player[] } {
  const fr = front(df);
  if (!fr.length) return { str: 0.4, count: 0, blockers: [] };
  const readiness = fr.reduce((s, p) => s + (n(p.reaction) + n(p.vq)) / 2, 0) / fr.length;
  const isRead = rng.next() < clamp(0.2 + 0.5 * readiness, 0.05, 0.9);
  let count = atk === 'quick' ? 1 : atk === 'open' ? (rng.next() < 0.5 ? 2 : 3)
    : atk === 'tempo' ? (rng.next() < 0.6 ? 1 : 2) : (rng.next() < 0.5 ? 1 : 2);
  count = Math.min(count, fr.length);
  const sorted = fr.slice().sort((a, b) => n(R(b).block) - n(R(a).block)).slice(0, count);
  const vals = sorted.map((p) => BLK_K * n(R(p).block) * eff(df, p));
  for (const p of sorted) drain(df, p, 0.4);
  const skill = 0.5 * Math.max(...vals) + 0.5 * (vals.reduce((a, b) => a + b, 0) / vals.length);
  const fooled = FAKE[atk] && !isRead ? 0.7 : 1.0;
  return { str: skill * (0.72 + 0.14 * count) * fooled * momFactor(df.momentum), count, blockers: sorted };
}

/** 선택적 통계 수집 — 비우면(undefined) 아무 영향 없음(결과 불변). 밸런싱 측정 전용. */
export interface RallyStats {
  rallies: number; sideouts: number;
  serves: number; aces: number; serveErrs: number; faults: number;
  recvErrs: number; miscErrs: number; // 기타 범실(KOVO 범실군) — 리시브 범실·볼핸들링/네트터치
  attacks: number; kills: number; attackErrs: number; stuffs: number; blockouts: number; digs: number; softblocks: number;
  // 세트(토스) 선택 분석 — 센터 토스(속공/시간차)를 패스 품질별로
  atkQuick: number; atkTempo: number; atkOpen: number; atkBack: number;
  atkQuickA: number; atkQuickB: number; atkSlide: number; // 속공 세부(A퀵/B퀵/이동속공)
  goodAtk: number; goodCenter: number;   // 좋은 패스(q≥0.6)에서 공격수·센터 비중
  badAtk: number; badCenter: number;     // 난조 패스(q<0.45)에서
  srvSafe: number; srvFloat: number; srvJump: number; srvSpike: number; // 서브 타입 분포
}

/** 포지션별 동작 계측(서브/세트/공격/속공/블로킹 처리자) — 포지션 역할 검증용 */
export interface PosStats {
  serve: Record<Position, number>;
  set: Record<Position, number>;
  attack: Record<Position, number>;
  quick: Record<Position, number>;  // 속공/시간차 공격수
  block: Record<Position, number>;  // 전위 주 블로커
}
const zeroPos = (): Record<Position, number> => ({ S: 0, OH: 0, OP: 0, MB: 0, L: 0 });
export const newPosStats = (): PosStats => ({
  serve: zeroPos(), set: zeroPos(), attack: zeroPos(), quick: zeroPos(), block: zeroPos(),
});

export const newRallyStats = (): RallyStats => ({
  rallies: 0, sideouts: 0,
  serves: 0, aces: 0, serveErrs: 0, faults: 0,
  recvErrs: 0, miscErrs: 0,
  attacks: 0, kills: 0, attackErrs: 0, stuffs: 0, blockouts: 0, digs: 0, softblocks: 0,
  atkQuick: 0, atkTempo: 0, atkOpen: 0, atkBack: 0,
  atkQuickA: 0, atkQuickB: 0, atkSlide: 0,
  goodAtk: 0, goodCenter: 0, badAtk: 0, badCenter: 0,
  srvSafe: 0, srvFloat: 0, srvJump: 0, srvSpike: 0,
});

/**
 * 한 랠리를 끝까지 시뮬 → 득점한 쪽 반환.
 * @param edge 팀별 능력 배수(홈 어드밴티지 등)
 * @param stats 선택적 통계 싱크(있으면 이벤트 카운트, 없으면 무영향)
 */
export function playRally(serving: Side, home: RallyTeam, away: RallyTeam, R: Rate, rng: Rng, edge: Edge = NO_EDGE, stats?: RallyStats, trace?: string[], pos?: PosStats, tele?: Tele, clutch = false): Side {
  const teamOf = (s: Side) => (s === 'home' ? home : away);
  const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');
  const eg = (s: Side) => (s === 'home' ? edge.home : edge.away);

  // ── 공간 텔레메트리(승패 불변; 좌표는 별도 srng로 파생, 메인 rng 불간섭) ──
  const E = tele?.events;
  const sj: () => number = tele ? () => tele.srng.next() : () => 0;
  const xyOf = (side: Side, t: RallyTeam, p: Player): Pt => {
    const i = t.six.indexOf(p);
    if (i >= 0) return playerXY(side, t.six, t.rotation, i, t.libero);
    for (const bi of backRow(t.rotation)) if (t.six[bi]?.position === 'MB') return playerXY(side, t.six, t.rotation, bi, t.libero); // 리베로
    return zoneXY(side, 6);
  };
  const emitPoint = (winner: Side, reason: string) => { if (E) E.push({ t: 'point', winner, reason }); };

  const serv = teamOf(serving);
  const recvSide = other(serving);
  const recv = teamOf(recvSide);

  // ── 서브 (2장) ── 타입별 (에이스·범실·난이도) 트레이드오프
  const sp = server(serv);
  drain(serv, sp, 1);
  const st = chooseServe(sp, serv.style, rng);
  const svPow = n(R(sp).serve) * momFactor(serv.momentum) * eg(serving) * eff(serv, sp);
  const recvSkill = strength(receivers(recv), (r) => r.receive, R, recv) * momFactor(recv.momentum) * eg(recvSide);
  // 실력차 민감도 0.09 — KOVO 정렬로 무작위성(랠리·기세)을 줄인 만큼 격차 전달을 압축(parity, 2026-06)
  const aceP = clamp(SERVE_ACE[st] * (0.5 + svPow) + 0.09 * (svPow - recvSkill), 0.003, 0.18);
  const spFocus = n(sp.focus) + (clutch ? clutchFocusAdj(sp.traits) : 0); // 큰 고비: 클러치↑·새가슴↓
  const errP = clamp(SERVE_ERR[st] * (1.3 - 0.5 * spFocus) * (serv.style === 'balanced' ? 0.92 : 1), 0.01, 0.24);
  if (stats) {
    stats.rallies++; stats.serves++;
    if (st === 'safe') stats.srvSafe++; else if (st === 'float') stats.srvFloat++;
    else if (st === 'jumpfloat') stats.srvJump++; else stats.srvSpike++;
  }
  if (pos) pos.serve[sp.position]++;
  const sideKo = (s: Side) => (s === 'home' ? '홈' : '원정');
  if (trace) trace.push(`서브 [${sideKo(serving)}] ${sp.name}(${sp.position}) · ${SERVE_KO[st]}`);

  // 공간: 서브 위치·의도 목표·리시버 선정(별도 srng) — 결과는 아래 s0로 파생
  let srvFrom: Pt = { x: 0, y: 0 }, srvTarget: Pt = { x: 0, y: 0 };
  let passer: Player | null = null, passerXY: Pt = { x: 0, y: 0 };
  if (E) {
    srvFrom = serveSpot(serving, sj);
    const rcv = receivers(recv);
    // 패서 = 리시브 좋은 쪽으로 가중 선택(좌표 srng)
    passer = rcv.length ? rcv[Math.min(rcv.length - 1, Math.floor(sj() * rcv.length))] : sp;
    passerXY = xyOf(recvSide, recv, passer);
    srvTarget = jitter({ x: passerXY.x, y: passerXY.y }, 1.2, sj); // 서버가 노린 점(빈 곳·심)
  }

  const s0 = rng.next();
  if (s0 < aceP) {
    if (stats) stats.aces++; if (trace) trace.push('  → 서브 에이스! (서브팀 득점)');
    if (E && passer) {
      const land = serveLanding(recvSide, passerXY, srvTarget, 'ace', sj);
      E.push({ t: 'serve', side: serving, player: sp.name, pos: sp.position, serveType: st, from: srvFrom, target: srvTarget, landing: land, errMargin: dist(srvTarget, land), outcome: 'ace' });
      E.push({ t: 'receive', side: recvSide, player: passer.name, pos: passer.position, at: passerXY, ball: land, reach: dist(passerXY, land), result: 'ace', q: 0 });
      emitPoint(serving, '서브 에이스');
    }
    return serving;
  }
  if (s0 < aceP + errP) {
    if (stats) stats.serveErrs++; if (trace) trace.push('  → 서브 범실 (리시브팀 득점)');
    if (E && passer) {
      const land = serveLanding(recvSide, passerXY, srvTarget, 'fault', sj);
      E.push({ t: 'serve', side: serving, player: sp.name, pos: sp.position, serveType: st, from: srvFrom, target: srvTarget, landing: land, errMargin: dist(srvTarget, land), outcome: 'fault' });
      emitPoint(recvSide, '서브 범실');
    }
    return recvSide;
  }

  // ── 포지션 폴트 (1.4) ──
  for (const side of [serving, recvSide] as Side[]) {
    const t = teamOf(side);
    if (rng.next() < clamp(0.012 * (1 - teamVQ(t)), 0, 0.02)) { if (stats) stats.faults++; return other(side); }
  }

  // ── 랠리 루프 (4·5·6장) ── 서브 난이도만큼 첫 리시브 품질 하락
  let att = recvSide;
  let q = clamp(0.58 + 0.45 * (recvSkill - svPow) - SERVE_DIFF[st] + rng.range(-0.15, 0.15), 0.08, 0.98); // 민감도 압축(parity)
  // 리시브 범실(기타 범실군) — 난조 리시브일수록 공이 죽어 서브팀 직접 득점(에이스와 별개 기록)
  const recvErrP = clamp(0.10 - 0.13 * q, 0.005, 0.10);
  if (rng.next() < recvErrP) {
    if (stats) stats.recvErrs++;
    if (trace) trace.push(`리시브 범실 [${sideKo(recvSide)}] (서브팀 득점)`);
    if (E && passer) {
      const land = serveLanding(recvSide, passerXY, srvTarget, 'in', sj, 0.05);
      E.push({ t: 'serve', side: serving, player: sp.name, pos: sp.position, serveType: st, from: srvFrom, target: srvTarget, landing: land, errMargin: dist(srvTarget, land), outcome: 'in' });
      E.push({ t: 'receive', side: recvSide, player: passer.name, pos: passer.position, at: passerXY, ball: land, reach: dist(passerXY, land), result: 'shank', q: 0 });
      emitPoint(serving, '리시브 범실');
    }
    return serving;
  }
  if (trace) trace.push(`리시브 [${sideKo(recvSide)}] 품질 ${q.toFixed(2)} (${qLabel(q)})`);
  if (E && passer) {
    const land = serveLanding(recvSide, passerXY, srvTarget, 'in', sj, q);
    E.push({ t: 'serve', side: serving, player: sp.name, pos: sp.position, serveType: st, from: srvFrom, target: srvTarget, landing: land, errMargin: dist(srvTarget, land), outcome: 'in' });
    E.push({ t: 'receive', side: recvSide, player: passer.name, pos: passer.position, at: passerXY, ball: land, reach: dist(passerXY, land), result: q >= 0.6 ? 'good' : q >= 0.4 ? 'poor' : 'shank', q });
  }

  for (let hop = 0; hop < CAP; hop++) {
    const at = teamOf(att);
    const df = teamOf(other(att));
    const setter = setterOf(at);
    const setQ = n(R(setter).set) * eff(at, setter);
    // 볼핸들링 범실(기타 범실군) — 더블컨택·캐치·네트터치. 세터 기복↓·난조 패스일수록↑
    const miscP = clamp(0.042 - 0.022 * n(setter.consistency) - 0.012 * q, 0.006, 0.06);
    if (rng.next() < miscP) {
      if (stats) stats.miscErrs++;
      if (trace) trace.push(`  볼핸들링 범실 [${sideKo(att)}] (상대 득점)`);
      if (E) emitPoint(other(att), '핸들링 범실');
      return other(att);
    }
    const atk = chooseAtk(q, setQ, n(setter.vq), at.style, rng);
    const attacker = pickAttacker(at, atk, R, rng);
    drain(at, attacker, 1);
    maybeInjure(at, attacker, rng);
    const quickKind: QuickKind | undefined = atk === 'quick' ? quickKindOf(q, setter, attacker) : undefined; // 난수 없는 결정론 분류

    // 세트(토스) 선택 계측 — 센터 토스(속공/시간차)를 패스 품질별로
    if (stats) {
      if (atk === 'quick') stats.atkQuick++; else if (atk === 'tempo') stats.atkTempo++;
      else if (atk === 'open') stats.atkOpen++; else stats.atkBack++;
      if (quickKind === 'A') stats.atkQuickA++; else if (quickKind === 'B') stats.atkQuickB++; else if (quickKind === 'slide') stats.atkSlide++;
      const center = atk === 'quick' || atk === 'tempo';
      if (q >= 0.6) { stats.goodAtk++; if (center) stats.goodCenter++; }
      else if (q < 0.45) { stats.badAtk++; if (center) stats.badCenter++; }
    }
    if (pos) {
      pos.set[setter.position]++;
      pos.attack[attacker.position]++;
      if (atk === 'quick' || atk === 'tempo') pos.quick[attacker.position]++;
      const fr = front(df);
      if (fr.length) { const lead = fr.reduce((b, p) => (R(p).block > R(b).block ? p : b)); pos.block[lead.position]++; }
    }
    if (trace) trace.push(`  세트 [${sideKo(att)}] ${setter.name}(S) → ${ATK_KO[atk]}${quickKind ? `·${QK_KO[quickKind]}` : ''} : ${attacker.name}(${attacker.position})`);

    // 공간: 세터 위치 → 공격수 타점으로 토스(난조·아웃오브시스템이면 엉뚱한 곳)
    const attSide = att, defSide = other(att);
    let attackerHitXY: Pt = { x: 0, y: 0 };
    const pushAttack = (result: AtkResult, diggerXY: Pt | null): Pt => {
      const course = attackCourse(defSide, result, attSide, diggerXY, attackerHitXY.x, sj);
      E!.push({ t: 'attack', side: attSide, player: attacker.name, pos: attacker.position, atk, quickKind, from: attackerHitXY, course, result });
      return course;
    };
    if (E) {
      const inSystem = q >= CHANCE_Q;
      const aXY = xyOf(attSide, at, attacker);
      const isBack = atk === 'back';
      const hy = attSide === 'home' ? (isBack ? COURT.NET_Y + 3.2 : COURT.NET_Y + 1.2) : (isBack ? COURT.NET_Y - 3.2 : COURT.NET_Y - 1.2);
      // 속공 종류별 타점 — A퀵: 세터 앞 1m / B퀵: 2.4m 넓게(레프트) / 이동속공: 세터 뒤(반대쪽)로 횡이동
      let hx = aXY.x;
      if (quickKind) {
        const setterX = xyOf(attSide, at, setter).x;
        const toLeft = attSide === 'home' ? -1 : 1; // 홈은 x 작은 쪽이 레프트(zone4)
        hx = quickKind === 'A' ? setterX + toLeft * 1.0 : quickKind === 'B' ? setterX + toLeft * 2.4 : setterX - toLeft * 1.6;
      }
      attackerHitXY = { x: Math.max(0.5, Math.min(COURT.W - 0.5, hx)), y: hy };
      const toss = tossLanding(attackerHitXY, attSide, inSystem, q, sj);
      E.push({ t: 'set', side: attSide, player: setter.name, pos: setter.position, from: xyOf(attSide, at, setter), target: toss.target, landing: toss.landing, atk, quickKind, offTarget: toss.offTarget, inSystem });
    }

    const chem = (atk === 'quick' || atk === 'tempo') ? 0.12 * chemistry(setter, attacker) : 0; // 케미(9.2)
    const chanceBall = q < CHANCE_Q ? 0.85 : 1; // 찬스볼은 세트 품질 하락(6장)
    const setMul = (0.85 + 0.3 * setQ + chem) * chanceBall;
    const qf = 0.6 + 0.5 * q;
    const atkStyleMul = at.style === 'attack' ? 1.05 : at.style === 'defense' ? 0.98 : 1; // 공격형 화력↑ / 수비형 화력↓(트레이드오프)
    const serveDisadv = att === serving ? 0.9 : 1; // 서브한 팀은 전환 공격 불리(서브 직후 out-of-system) → 사이드아웃↑
    const attackPower = ATK_K * n(R(attacker).spike) * setMul * BLOCK_AVOID[atk] * qf * momFactor(at.momentum) * eg(att) * eff(at, attacker) * atkStyleMul * serveDisadv;
    const blk = blockEval(df, atk, R, rng);
    const firstBall = hop === 0; // 리시브 후 첫 공격(인시스템) — 서브한 팀의 블록이 미완성
    const blkStr = blk.str * (firstBall ? 0.74 : 1);
    if (E && blk.count > 0) {
      const netAt: Pt = { x: attackerHitXY.x, y: defSide === 'home' ? COURT.NET_Y + 0.2 : COURT.NET_Y - 0.2 };
      E.push({ t: 'block', side: defSide, players: blk.blockers.map((p) => p.name), positions: blk.blockers.map((p) => p.position), at: netAt, count: blk.count });
    }

    // 좋은 패스(높은 q)면 깔끔히 결정(범실↓→사이드아웃↑), 난조면 범실 급증. 기복·VQ가 낮춤
    const balancedDiscipline = at.style === 'balanced' ? 0.012 : 0; // 밸런스형: 기본기(범실↓)
    const clutchAtk = clutch ? clutchFocusAdj(attacker.traits) * 0.1 : 0; // 큰 고비 공격 안정(클러치↓err/새가슴↑err)
    const errP2 = clamp(0.16 - 0.09 * q + ATK_ERR[atk] - 0.05 * n(attacker.consistency) - 0.03 * n(attacker.vq) - balancedDiscipline - clutchAtk, 0.04, 0.28);
    const blockP = clamp(0.085 + 0.3 * (blkStr - attackPower), 0.02, 0.4); // 민감도 압축(parity)·기저로 평균 복원
    if (stats) stats.attacks++;
    const r1 = rng.next();
    if (r1 < errP2) { if (stats) stats.attackErrs++; if (trace) trace.push('    → 공격 범실 (상대 득점)'); if (E) { pushAttack('error', null); emitPoint(other(att), '공격 범실'); } return other(att); }
    if (r1 < errP2 + blockP) {
      // 공격방법(5.1): 영리한 공격수는 블록아웃/툴샷으로 살린다(VQ↑일수록)
      const blockOutP = clamp(0.12 + 0.35 * n(attacker.vq) - 0.15, 0.04, 0.4);
      if (rng.next() < blockOutP) { if (stats) stats.blockouts++; if (trace) trace.push(`    → 블록아웃(툴샷) 득점 [${sideKo(att)}]`); if (E) { pushAttack('blockout', null); emitPoint(att, '블록아웃'); } return att; }
      const stuffPref = df.style === 'attack' ? 0.04 : df.style === 'defense' ? -0.04 : 0;
      const stuffProb = clamp(0.46 + stuffPref + 0.55 * (blkStr - attackPower), 0.05, 0.8); // 기저 KOVO 정렬·민감도 압축
      if (rng.next() < stuffProb) { if (stats) stats.stuffs++; if (trace) trace.push(`    → 스터프 블록! [${sideKo(other(att))}] 득점`); if (E) { pushAttack('blocked', null); emitPoint(other(att), '스터프 블록'); } return other(att); }
      if (stats) stats.softblocks++;
      if (E) pushAttack('softblock', null);
      q = clamp(0.7 + rng.range(-0.1, 0.1), 0.4, 0.92);          // 소프트 블록 → 수비측 좋은 전환
      if (trace) trace.push(`    → 소프트 블록 (공 튕겨 [${sideKo(other(att))}] 전환, q ${q.toFixed(2)})`);
      att = other(att);
      continue;
    }

    const defStyleBonus = df.style === 'defense' ? 0.02 : df.style === 'attack' ? -0.01 : 0; // 수비형 디그↑ / 공격형 디그 소폭↓
    const digStr = strength(defenders(df), (r) => r.dig, R, df) * momFactor(df.momentum);
    // 기저 0.38 — KOVO 랠리 길이 정렬(공격시도 ~34/세트·디그 ~15/세트, 2026-06. 0.46은 랠리 과장)
    const digP = clamp(0.40 + defStyleBonus + 0.45 * (digStr - attackPower), 0.05, 0.9); // 민감도 압축(parity)·기저로 평균 복원
    if (rng.next() < digP) {
      if (stats) stats.digs++;
      q = clamp(0.4 + 0.4 * (digStr - attackPower) + rng.range(-0.1, 0.1), 0.1, 0.85);
      const d = defenders(df); const dg = d.length ? d.reduce((b, p) => (R(p).dig > R(b).dig ? p : b)) : attacker;
      if (trace) trace.push(`    → 디그 성공 [${sideKo(other(att))}] ${dg.name}(${dg.position}) (공 튕겨 전환, q ${q.toFixed(2)})`);
      if (E) { const dgXY = xyOf(defSide, df, dg); const course = pushAttack('dug', dgXY); E.push({ t: 'dig', side: defSide, player: dg.name, pos: dg.position, at: dgXY, ball: course, reach: dist(dgXY, course), ok: true }); }
      att = other(att);
      continue;
    }
    if (stats) stats.kills++;
    if (trace) trace.push(`    → 공격 성공(킬)! [${sideKo(att)}] ${attacker.name} 득점`);
    if (E) { pushAttack('kill', null); emitPoint(att, '공격 성공'); }
    return att;                                                 // 공격 성공(kill)
  }
  return att;
}
