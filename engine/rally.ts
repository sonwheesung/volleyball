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

/** 기세 → 능력 승수 (7.2). m∈[0,100]에서 0.96~1.04 — KOVO 세트 점수차(4~6)·듀스 비율 정렬(2026-06.
 *  이전 ±10%(0.90~1.10)는 스노볼 과강: 패자 평균 17.6·점수차 7.6·듀스 6%로 일방적 세트 과다였음) */
export const momFactor = (m: number) => 0.96 + 0.0008 * m;

// 공격 집중 지수 — spike^FOCUS로 에이스(외인 OP)에 스윙 몰림. KOVO 외인 아포짓 의존도(~25~30%) 재현.
// 2026-06-26 도입(구: 선형·OP 1.0 → OP 톱 3.26/세트 ~20%로 KOVO 미달). 확정 FOCUS 3.0·OP 2.0:
// OP 톱 ~4.3/세트(~27%)·KOVO 공격성공률 38.8% 불변·parity std 2.60(불변)·반등 100%. MATCH_SYSTEM 4장.
const ATK_FOCUS = 3.0;
const ATTACK_SHARE: Record<Position, number> = { OP: 2.0, OH: 0.9, MB: 0.6, S: 0.1, L: 0 };
const aspk = (R: Rate, p: Player) => Math.pow(n(R(p).spike), ATK_FOCUS); // 집중 적용 스파이크 가중
const CAP = 8; // 랠리 hop 상한(7.3)

// ── 체력 (7.1) ──
const STAM_FLOOR = 0.70;
const HOP_COST = 0.024;
export const STAM_REGEN_BASE = 0.005; // 랠리 사이 회복(2026-06-28 튜닝)
// 리베로 후위 수비 참여 소모(7.1, 2026-07-15) — 리베로는 공격 1.2·서브 1.0 같은 큰 소모가 구조적으로 없고(리시브 0.2·디그 0.4만),
//   체력/체젠 스탯이 높은 포지션이라 랠리간 회복이 소모를 거의 항상 이겨 타임아웃 체력이 상시 ~100%였다(실측 L 3세트+ 98.5%·≥99% 55.7%).
//   → 서브 리시브 프레임 밖에서도 **매 랠리 전 코트를 커버하는 후위 수비 참여**를 균일 소모로 모델(mult=0.16, drain 경유 = HOP_COST·체력스탯
//   정규화 상속). 균일 채널이라 분포를 좁혀 상시100%↓(≥99% 55.7%→21.6%)·최저 과하락 방지(3세트+ 89.8%·p5 73%). **리베로 표적**
//   (다른 포지션·HOP_COST·회복 상수 불변 → 타 밴드 Δ≤0.2%p 실측). 0 = 무보정(옛 동작 = A/B 가드 mutant). ENGINE_VERSION 10.
//   ⚙ 값은 프로덕션 고정 리터럴 0.16. `DV_LIBDEF` 환경변수는 **가드 전용 A/B 시임**(프로덕션 미설정 → 0.16, 결정론 무영향 —
//   simFinance FIN_OLD_UNIVERSE와 동일 패턴). `_dv_liberostam.ts`가 자식 프로세스에 `DV_LIBDEF=0`(=옛 무보정 mutant)을 줘 밴드 FAIL 민감도를 증명.
const LIBERO_DEFENSE_COST = process.env.DV_LIBDEF != null ? Number(process.env.DV_LIBDEF) : 0.16;
const INJ_EFF = 0.5; // 부상 시 효율 배수(9.3)
// 부상 발동 중 실제 코트 교체(중상)로 승격되는 비율 — placeholder(측정으로 튜닝, 1.3d). 대부분은 참고 뛴다(×0.5).
//   ⚙ 값은 프로덕션 고정 리터럴 0.12. `DV_SEVFRAC` 환경변수는 **가드 전용 A/B 시임**(프로덕션 미설정 → 0.12, 결정론 무영향 —
//   DV_LIBDEF·FIN_OLD_UNIVERSE와 동일 패턴). `_dv_injurysub.ts`가 자식 프로세스에 `DV_SEVFRAC=1.0`(=전건 중상 mutant)을 줘 (d) 게이트 FAIL 민감도를 증명.
const SEVERE_INJURY_FRAC = process.env.DV_SEVFRAC != null ? Number(process.env.DV_SEVFRAC) : 0.12;

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
  pendingSevere?: string[];    // 이번 랠리에 중상(부상 교체 대기) 판정된 공격수 id — match.ts가 랠리 후 소비(FIVB 예외적 교체, 1.3d). 없으면(간이 시뮬) 교체 없음
}

export type Rate = (p: Player) => Ratings;

/** 득점 종결 방식 — 경기 보드가 "지어내지 않고" 사실대로 그리기 위한 기록(결정론 무영향) */
export type PointHow =
  | 'ace' | 'serveErr' | 'recvErr' | 'fault'      // 서브 국면
  | 'miscErr'                                      // 볼핸들링(더블컨택·캐치·네트터치)
  | 'kill' | 'blockout' | 'stuff' | 'atkErr' | 'tip' // 공격 국면(tip=페인트 득점)
  | 'cap';                                         // 랠리 상한 도달(킬 취급)

export interface RallyOutcome { winner: Side; how: PointHow; byId?: string; recvId?: string; setId?: string } // byId=종결 선수(킬/팁/블록아웃/cap=공격수·stuff=블로커·ace=서버). recvId=서브 리시버(박스 recvAtt 귀속자). setId=종결 공격에 어시(assist) 귀속된 세터 — 보드가 같은 선수를 그리게

/** 한 점의 터치 1건 — 엔진이 실제로 누가 만졌나를 순서대로 기록(보드가 그대로 재생 → 디그/세트/공격 박스 일치).
 *  좌표 없음(보드가 합성). rng 추가 소비 0(이미 정해진 선수 id를 push만) → 결과 바이트 중립. */
export type TouchAct = 'serve' | 'recv' | 'set' | 'atk' | 'dig';
export interface TouchEvent { act: TouchAct; side: Side; id: string }

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

/** 디그 성공 귀속자 — 후위 수비수 중 dig 레이팅 가중 추첨(현실 분산, 리베로 1위 유지). 전역 best-dig
 *  독식(리베로 87.7%)을 흩어 박스 디그가 실제 배구처럼 보이게. 승패엔 무관(전용 digRng·귀속만). */
function pickByDig(dDef: Player[], R: Rate, rng: Rng): Player {
  if (dDef.length === 0) throw new Error('pickByDig: empty defenders'); // 호출부가 보장
  // 가중 = dig^2 — 특화 디거(리베로)를 분명한 1위로, 그래도 후위 OH/OP·세터가 유의미 분담(정성 타깃).
  const w = dDef.map((p) => Math.max(1, n(R(p).dig)) ** 2);
  const sum = w.reduce((a, b) => a + b, 0);
  let r = rng.next() * sum;
  for (let i = 0; i < dDef.length; i++) { r -= w[i]; if (r < 0) return dDef[i]; }
  return dDef[dDef.length - 1];
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

/** 부상 판정(9.3·1.3d) — 노쇠·체력 고갈 시 ↑. 경기 한정(시즌 영향 없음 — 결정론 격리, INJURY 0.1장).
 *  호출부: playRally 공격 스윙 직후(공격수=six[] 멤버)만. **리베로는 공격하지 않으므로 여기 도달 불가**
 *  (호출부 드리프트 방어 주석 — 리베로 부상 교체 로직 불필요). 흔한 경우는 참고 뛴다(injured Set → ×0.5),
 *  드물게(SEVERE_INJURY_FRAC) 중상만 실제 교체 대기열(pendingSevere)에 올린다. 심각도 판정은 **기존 rng 스트림**(결정론). */
function maybeInjure(t: RallyTeam, p: Player, rng: Rng, stats?: RallyStats): void {
  if (t.injured.has(p.id)) return;
  const frac = t.stam.get(p.id) ?? 1;
  const ageF = 1 + Math.max(0, p.age - 30) * 0.15;
  const tiredF = 1 + (1 - frac) * 1.5;
  if (rng.next() < 0.0006 * ageF * tiredF) {
    t.injured.add(p.id);                            // 흔한 경우: 참고 뛴다(효율 ×0.5)
    const severe = rng.next() < SEVERE_INJURY_FRAC; // 심각도 게이트 — 발동마다 항상 rng 소비(pendingSevere 유무와 무관·결정론)
    if (stats) { stats.injuries++; if (severe) stats.injurySevere++; } // 계측(rng 무관·결과 불변)
    if (severe) t.pendingSevere?.push(p.id);        // 중상만 match.ts가 랠리 후 실제 교체(1.3d)
  }
}

function strength(players: Player[], pick: (r: Ratings) => number, R: Rate, t: RallyTeam): number {
  if (players.length === 0) return 0.4;
  const vals = players.map((p) => n(pick(R(p))) * eff(t, p));
  const max = Math.max(...vals);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return 0.5 * max + 0.5 * avg;
}

const teamVQ = (t: RallyTeam) => t.six.reduce((s, p) => s + p.vq, 0) / t.six.length / 100;

/** 서브 타입 선택 (2장) — 서브 능력·집중력·감독 성향이 공격성을 정한다.
 *  큰 고비(clutch)엔 안전 서브로 — 에이스도 범실도 줄어 종반이 길어진다(듀스의 재료) */
function chooseServe(p: Player, style: CoachStyle, rng: Rng, clutch = false): ServeT {
  const styleAdj = style === 'attack' ? 0.12 : style === 'defense' ? -0.05 : 0;
  const clutchAdj = clutch ? -0.14 : 0; // 세트포인트 접전 — 코치도 선수도 "일단 넣고 보자"
  const aggr = n(p.skServe) * 0.6 + 0.2 * n(p.focus) + styleAdj + clutchAdj + serveAggrAdj(p.traits) + rng.range(-0.12, 0.12);
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
    for (const p of fr) if (p.position === 'MB') pool.push({ p, w: aspk(R, p) });
    if (!pool.length) for (const p of fr) pool.push({ p, w: ATTACK_SHARE[p.position] * aspk(R, p) });
  } else if (atk === 'back') {
    for (const p of bk) if (p.position === 'OH' || p.position === 'OP') pool.push({ p, w: ATTACK_SHARE[p.position] * aspk(R, p) });
    if (!pool.length) for (const p of fr) pool.push({ p, w: ATTACK_SHARE[p.position] * aspk(R, p) });
  } else {
    for (const p of fr) if (p.position !== 'MB' && p.position !== 'S') pool.push({ p, w: ATTACK_SHARE[p.position] * aspk(R, p) });
    if (!pool.length) for (const p of fr) pool.push({ p, w: ATTACK_SHARE[p.position] * aspk(R, p) });
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
  tips: number; tipKills: number; // 페인트(연타) 시도·득점
  // 세트(토스) 선택 분석 — 센터 토스(속공/시간차)를 패스 품질별로
  atkQuick: number; atkTempo: number; atkOpen: number; atkBack: number;
  atkQuickA: number; atkQuickB: number; atkSlide: number; // 속공 세부(A퀵/B퀵/이동속공)
  goodAtk: number; goodCenter: number;   // 좋은 패스(q≥0.6)에서 공격수·센터 비중
  badAtk: number; badCenter: number;     // 난조 패스(q<0.45)에서
  srvSafe: number; srvFloat: number; srvJump: number; srvSpike: number; // 서브 타입 분포
  // 패스 품질(q) 계측 — 서브 리시브(인플레이만, 셰이크 제외)와 랠리 중 전환 품질
  recvQSum: number; recvQN: number;      // 서브 리시브 품질 합·건수
  recvGood: number; recvOk: number; recvPoor: number; recvChance: number; // 분포 q≥0.6 / 0.45~0.6 / 0.32~0.45 / <0.32
  // 랠리 중 전환 품질을 종류별로 분리(소프트블록이 평균을 끌어올리는 효과 분리 측정)
  digRegSum: number; digRegN: number;    // 일반 디그(기저 0.40)
  digTipSum: number; digTipN: number;    // 팁(페인트) 디그(기저 0.55)
  digSoftSum: number; digSoftN: number;  // 소프트 블록 전환(기저 0.70)
  injuries: number; injurySevere: number; // 부상 관측(1.3d) — 발동(참고뛰기+중상) 총건·중상(교체 승격) 건. rng 무관·결과 불변(계측 전용)
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
  tips: 0, tipKills: 0,
  atkQuick: 0, atkTempo: 0, atkOpen: 0, atkBack: 0,
  atkQuickA: 0, atkQuickB: 0, atkSlide: 0,
  goodAtk: 0, goodCenter: 0, badAtk: 0, badCenter: 0,
  srvSafe: 0, srvFloat: 0, srvJump: 0, srvSpike: 0,
  recvQSum: 0, recvQN: 0,
  recvGood: 0, recvOk: 0, recvPoor: 0, recvChance: 0,
  digRegSum: 0, digRegN: 0,
  digTipSum: 0, digTipN: 0,
  digSoftSum: 0, digSoftN: 0,
  injuries: 0, injurySevere: 0,
});

/** 선수별 박스스코어 싱크 — 실제 스윙 단위 귀속(통계 재구성 아님). 선택적(비우면 무영향·결과 불변).
 *  rng를 추가로 소비하지 않으므로(이미 정해진 attacker/server/setter/digger/blocker에 카운트만)
 *  밸런스·결정론 무관 — tele/stats 싱크와 동일한 안전모델. 공격 시도(atkAtt)는 디그로 살아난
 *  공격까지 포함 → 성공률(atkKill/atkAtt)이 실제 KOVO 분모(~45~55%)와 일치. */
export interface BoxLine {
  atkAtt: number; atkKill: number; atkErr: number; atkBlocked: number; // 공격: 시도/성공/범실/차단당함
  srvAtt: number; srvAce: number; srvErr: number;                       // 서브: 시도/에이스/범실. srvAce = FIVB 공식 inclusive(노터치 direct + 리시브범실 indirect) ≠ stats.aces(how='ace' direct만)
  blockPt: number; digSucc: number; assist: number;                     // 블록 득점/디그 성공/세트(어시)
  recvAtt: number; recvGood: number; recvErr: number;                   // 리시브: 시도/정확(q≥0.45=KOVO 정확 리시브, 세터 공격 전개 가능)/실패(에이스+셰이크). KOVO 효율=(정확−실패)/시도
}
export type BoxSink = Map<string, BoxLine>;
export const emptyBox = (): BoxLine => ({
  atkAtt: 0, atkKill: 0, atkErr: 0, atkBlocked: 0, srvAtt: 0, srvAce: 0, srvErr: 0, blockPt: 0, digSucc: 0, assist: 0,
  recvAtt: 0, recvGood: 0, recvErr: 0,
});

/**
 * 한 랠리를 끝까지 시뮬 → 득점한 쪽 반환.
 * @param edge 팀별 능력 배수(홈 어드밴티지 등)
 * @param stats 선택적 통계 싱크(있으면 이벤트 카운트, 없으면 무영향)
 */
export function playRally(serving: Side, home: RallyTeam, away: RallyTeam, R: Rate, rng: Rng, edge: Edge = NO_EDGE, stats?: RallyStats, trace?: string[], pos?: PosStats, tele?: Tele, clutch = false, chasing: Side | null = null, box?: BoxSink, boxRng?: Rng, touchSink?: TouchEvent[], digRng?: Rng): RallyOutcome {
  const teamOf = (s: Side) => (s === 'home' ? home : away);
  const tch = touchSink ? (act: TouchAct, side: Side, p: Player | null | undefined) => { if (p) touchSink.push({ act, side, id: p.id }); } : null; // 터치 기록(중립·rng 무관)
  const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');
  const eg = (s: Side) => (s === 'home' ? edge.home : edge.away);
  // 박스 기록(선택) — 맵에 카운트만, rng 무관. 비우면 모든 호출이 no-op → 결과 바이트 불변.
  const bx = box ? (id: string, f: (l: BoxLine) => void) => { let l = box.get(id); if (!l) { l = emptyBox(); box.set(id, l); } f(l); } : null;
  // 리시브 귀속용 선택 — 누가 받았는지는 q(팀 리시브력 기반)·승패에 영향 없음(라벨일 뿐)이라
  // 별도 boxRng로 뽑는다(본 rng 불간섭 → 경기 결과 바이트 불변). W형(리베로+OH) 리시브력 가중.
  const pickRecv = boxRng ? (t: RallyTeam): Player | null => {
    const rc = receivers(t);
    if (!rc.length) return null;
    let tot = 0; const w = rc.map((p) => { const x = Math.max(0.01, n(R(p).receive)); tot += x; return x; });
    let r = boxRng.next() * tot;
    for (let i = 0; i < rc.length; i++) { r -= w[i]; if (r <= 0) return rc[i]; }
    return rc[rc.length - 1];
  } : null;

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

  // 리베로 후위 수비 참여 소모(7.1) — 서브 리시브 프레임 밖에서도 매 랠리 전 코트를 커버하며 움직인다(균일).
  //   서브/공격/블록의 큰 소모가 없는 리베로가 회복만 쌓여 상시 100%로 남던 현상 교정. 균일 채널이라 분포를 좁혀
  //   (calm 경기 리베로도 후반엔 100% 아래로) 상시100%↓·최저 과하락 방지. 양 팀 리베로에 대칭 적용.
  if (serv.libero) drain(serv, serv.libero, LIBERO_DEFENSE_COST);
  if (recv.libero) drain(recv, recv.libero, LIBERO_DEFENSE_COST);

  // ── 서브 (2장) ── 타입별 (에이스·범실·난이도) 트레이드오프
  const sp = server(serv);
  tch?.('serve', serving, sp);
  drain(serv, sp, 1);
  const st = chooseServe(sp, serv.style, rng, clutch);
  const svPow = n(R(sp).serve) * momFactor(serv.momentum) * eg(serving) * eff(serv, sp);
  const recvSkill = strength(receivers(recv), (r) => r.receive, R, recv) * momFactor(recv.momentum) * eg(recvSide);
  for (const p of receivers(recv)) drain(recv, p, 0.2); // 리시브 라인도 체력을 쓴다(7.1) — 수비 전담도 지친다
  // 실력차 민감도 0.09 — KOVO 정렬로 무작위성(랠리·기세)을 줄인 만큼 격차 전달을 압축(parity, 2026-06)
  const aceP = clamp(SERVE_ACE[st] * (0.5 + svPow) + 0.09 * (svPow - recvSkill), 0.003, 0.18);
  const spFocus = n(sp.focus) + (clutch ? clutchFocusAdj(sp.traits) : 0); // 큰 고비: 클러치↑·새가슴↓
  const errP = clamp(SERVE_ERR[st] * (1.3 - 0.5 * spFocus) * (serv.style === 'balanced' ? 0.92 : 1), 0.01, 0.24);
  if (stats) {
    stats.rallies++; stats.serves++;
    if (st === 'safe') stats.srvSafe++; else if (st === 'float') stats.srvFloat++;
    else if (st === 'jumpfloat') stats.srvJump++; else stats.srvSpike++;
  }
  bx?.(sp.id, (l) => { l.srvAtt++; });
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

  let recvPlayer: Player | null = null; // 서브 리시버(박스 recvAtt 귀속자) — 모든 종결 return에 recvId로 실어 보드와 일치
  const s0 = rng.next();
  if (s0 < aceP) {
    if (stats) stats.aces++; bx?.(sp.id, (l) => { l.srvAce++; });
    { const rv = pickRecv?.(recv); recvPlayer = rv ?? null; tch?.('recv', recvSide, rv); if (rv) bx?.(rv.id, (l) => { l.recvAtt++; l.recvErr++; }); } // 에이스 = 리시브 실패
    if (trace) trace.push('  → 서브 에이스! (서브팀 득점)');
    if (E && passer) {
      const land = serveLanding(recvSide, passerXY, srvTarget, 'ace', sj);
      E.push({ t: 'serve', side: serving, player: sp.name, pos: sp.position, serveType: st, from: srvFrom, target: srvTarget, landing: land, errMargin: dist(srvTarget, land), outcome: 'ace', rating: R(sp).serve, eff: eff(serv, sp) });
      E.push({ t: 'receive', side: recvSide, player: passer.name, pos: passer.position, at: passerXY, ball: land, reach: dist(passerXY, land), result: 'ace', q: 0, rating: R(passer).receive, eff: eff(recv, passer) });
      emitPoint(serving, '서브 에이스');
    }
    return { winner: serving, how: 'ace', byId: sp.id, recvId: recvPlayer?.id };
  }
  if (s0 < aceP + errP) {
    if (stats) stats.serveErrs++; bx?.(sp.id, (l) => { l.srvErr++; }); if (trace) trace.push('  → 서브 범실 (리시브팀 득점)');
    if (E && passer) {
      const land = serveLanding(recvSide, passerXY, srvTarget, 'fault', sj);
      E.push({ t: 'serve', side: serving, player: sp.name, pos: sp.position, serveType: st, from: srvFrom, target: srvTarget, landing: land, errMargin: dist(srvTarget, land), outcome: 'fault', rating: R(sp).serve, eff: eff(serv, sp) });
      emitPoint(recvSide, '서브 범실');
    }
    return { winner: recvSide, how: 'serveErr' };
  }

  // ── 포지션 폴트 (1.4) — 받는 팀만 (FIVB 2025-2028 Rule 7.4 + KOVO 25-26 채택) ──
  //   서브 순간 서브 팀 전원은 위치 자유(오버랩 면제) → 오버랩 폴트는 받는 팀만 성립.
  //   서브 팀 판정 제거·받는 팀만 굴리되 계수 2배(0.012→0.024·상한 0.02→0.04)로 총 기대 폴트율 보존
  //   (KOVO 상대범실 분포 정렬 유지). rng 소비 2→1회로 감소 → ENGINE_VERSION 7.
  {
    const t = teamOf(recvSide);
    if (rng.next() < clamp(0.024 * (1 - teamVQ(t)), 0, 0.04)) { if (stats) stats.faults++; return { winner: other(recvSide), how: 'fault' }; }
  }

  // ── 랠리 루프 (4·5·6장) ── 서브 난이도만큼 첫 리시브 품질 하락
  let att = recvSide;
  // 큰 고비(세트포인트 접전): 리시브 라인이 이를 악문다 — 사이드아웃 안정 → 듀스가 생기는 메커니즘(KOVO 듀스 12~18% 정렬)
  // 쫓는 팀(1~2점 뒤 종반)은 한 번 더 — 동점 도달의 재료. 접전 한정이라 고무줄 최소.
  const crunchRecv = (clutch ? 0.09 : 0) + (chasing === recvSide ? 0.06 : 0);
  let q = clamp(0.58 + crunchRecv + 0.45 * (recvSkill - svPow) - SERVE_DIFF[st] + rng.range(-0.15, 0.15), 0.08, 0.98); // 민감도 압축(parity)
  // 리시브 범실(기타 범실군) — 난조 리시브일수록 공이 죽어 서브팀 직접 득점(에이스와 별개 기록)
  const recvErrP = clamp(0.10 - 0.13 * q, 0.005, 0.10);
  if (rng.next() < recvErrP) {
    if (stats) stats.recvErrs++;
    bx?.(sp.id, (l) => { l.srvAce++; }); // FIVB/NCAA 공식: 리시브 범실이 기장되면 서버에게 서비스 에이스(indirect ace) — 개인 박스는 공식 정의로 inclusive. stats.aces(=how='ace' 노터치 direct)와 별개(2026-07-06, 발견=사용자 실관전·도메인=Fable 5 FIVB출처·수정=Opus)
    { const rv = pickRecv?.(recv); recvPlayer = rv ?? null; tch?.('recv', recvSide, rv); if (rv) bx?.(rv.id, (l) => { l.recvAtt++; l.recvErr++; }); } // 셰이크 = 리시브 실패(공식도 리시버에 리시브 범실 기장 — 서버 에이스와 둘 다 기록)
    if (trace) trace.push(`리시브 범실 [${sideKo(recvSide)}] (서브팀 득점)`);
    if (E && passer) {
      const land = serveLanding(recvSide, passerXY, srvTarget, 'in', sj, 0.05);
      E.push({ t: 'serve', side: serving, player: sp.name, pos: sp.position, serveType: st, from: srvFrom, target: srvTarget, landing: land, errMargin: dist(srvTarget, land), outcome: 'in', rating: R(sp).serve, eff: eff(serv, sp) });
      E.push({ t: 'receive', side: recvSide, player: passer.name, pos: passer.position, at: passerXY, ball: land, reach: dist(passerXY, land), result: 'shank', q: 0, rating: R(passer).receive, eff: eff(recv, passer) });
      emitPoint(serving, '리시브 범실');
    }
    return { winner: serving, how: 'recvErr', recvId: recvPlayer?.id };
  }
  if (stats) { // 인플레이 리시브 품질 계측(셰이크=recvErr는 위에서 이미 빠짐) — 결과 불변
    stats.recvQSum += q; stats.recvQN++;
    if (q >= 0.6) stats.recvGood++; else if (q >= 0.45) stats.recvOk++; else if (q >= CHANCE_Q) stats.recvPoor++; else stats.recvChance++;
  }
  { const rv = pickRecv?.(recv); recvPlayer = rv ?? null; tch?.('recv', recvSide, rv); if (rv) bx?.(rv.id, (l) => { l.recvAtt++; if (q >= 0.45) l.recvGood++; }); } // 정확 리시브(q≥0.45=KOVO 정확, 세터 공격 전개 가능 A+B패스) → 효율=(정확−실패)/시도
  if (trace) trace.push(`리시브 [${sideKo(recvSide)}] 품질 ${q.toFixed(2)} (${qLabel(q)})`);
  if (E && passer) {
    const land = serveLanding(recvSide, passerXY, srvTarget, 'in', sj, q);
    E.push({ t: 'serve', side: serving, player: sp.name, pos: sp.position, serveType: st, from: srvFrom, target: srvTarget, landing: land, errMargin: dist(srvTarget, land), outcome: 'in', rating: R(sp).serve, eff: eff(serv, sp) });
    E.push({ t: 'receive', side: recvSide, player: passer.name, pos: passer.position, at: passerXY, ball: land, reach: dist(passerXY, land), result: q >= 0.6 ? 'good' : q >= 0.4 ? 'poor' : 'shank', q, rating: R(passer).receive, eff: eff(recv, passer) });
  }

  let lastDigger: Player | null = null; // 직전 전환에서 1구를 디그한 선수(공수 전환 시 갱신) — 어시 귀속용
  for (let hop = 0; hop < CAP; hop++) {
    const at = teamOf(att);
    const df = teamOf(other(att));
    const setter = setterOf(at);
    tch?.('set', att, setter); // 세트(토스) 터치 — 볼핸들링 범실이면 세트에서 끝(공격 없음)
    drain(at, setter, 0.3); // 토스도 체력을 쓴다(7.1) — 세터는 모든 2구를 따라다닌다(빈도 최다·강도 낮음)
    const setQ = n(R(setter).set) * eff(at, setter);
    // 볼핸들링 범실(기타 범실군) — 더블컨택·캐치·네트터치. 세터 기복↓·난조 패스일수록↑
    const miscP = clamp(0.042 - 0.022 * n(setter.consistency) - 0.012 * q, 0.006, 0.06);
    if (rng.next() < miscP) {
      if (stats) stats.miscErrs++;
      if (trace) trace.push(`  볼핸들링 범실 [${sideKo(att)}] (상대 득점)`);
      if (E) emitPoint(other(att), '핸들링 범실');
      return { winner: other(att), how: 'miscErr', recvId: recvPlayer?.id };
    }
    const atk = chooseAtk(q, setQ, n(setter.vq), at.style, rng);
    const attacker = pickAttacker(at, atk, R, rng);
    tch?.('atk', att, attacker); // 공격 스윙 터치 — 모든 스윙(디그로 살아난 비종결 포함)
    // 어시 귀속자 — 지정 세터가 직전 1구를 디그했으면(더블컨택 불가) **실제 세트한 선수**(비상 세터 = 디거·공격수
    //   제외 최고 skSet, 보통 전위 OH). 아니면 지정 세터. set 품질·체력·rng는 지정 세터 유지(밸런스 바이트 불변) —
    //   귀속(어시·setId)만 실제 세터로. 공격수 제외가 핵심: 최고 skSet이 곧 종결 공격수면 더블컨택이라 보드가 못 그림(디그 재모델과 같은 결).
    const assistSetter = (lastDigger && lastDigger.id === setter.id)
      ? (at.six.filter((p) => p.id !== setter.id && p.id !== attacker.id).reduce<Player | null>((b, p) => (!b || p.skSet > b.skSet ? p : b), null) ?? setter)
      : setter;
    drain(at, attacker, 1.2); // 스파이크 점프가 가장 힘들다(7.1) — 리시브 면제 공격수(OP)도 지치게
    maybeInjure(at, attacker, rng, stats);
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
      E!.push({ t: 'attack', side: attSide, player: attacker.name, pos: attacker.position, atk, quickKind, from: attackerHitXY, course, result, rating: R(attacker).spike, eff: eff(at, attacker) });
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
      E.push({ t: 'set', side: attSide, player: setter.name, pos: setter.position, from: xyOf(attSide, at, setter), target: toss.target, landing: toss.landing, atk, quickKind, offTarget: toss.offTarget, inSystem, rating: R(setter).set, eff: eff(at, setter) });
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
    const chaseAtk = chasing === att ? 0.04 : 0; // 쫓는 팀은 종반 범실을 아낀다(동점 도달 메커니즘)
    const errP2 = clamp(0.16 - 0.09 * q + ATK_ERR[atk] - 0.05 * n(attacker.consistency) - 0.03 * n(attacker.vq) - balancedDiscipline - clutchAtk - chaseAtk, 0.04, 0.28);
    const blockP = clamp(0.085 + 0.3 * (blkStr - attackPower), 0.02, 0.4); // 민감도 압축(parity)·기저로 평균 복원
    if (stats) stats.attacks++;
    bx?.(attacker.id, (l) => { l.atkAtt++; }); // 모든 스윙 = 시도(디그로 살아난 공격 포함 → 성공률 분모 현실화)

    // ── 페인트(팁/연타, 5.1) — 벽이 잘 섰고 영리한 공격수일수록 블록 너머 빈 공간에 살짝.
    //    블록 무력화(스터프/블록아웃 없음). 수비가 읽으면 쉬운 디그, 못 읽으면 톡 떨어져 득점.
    const defStyleBonus = df.style === 'defense' ? 0.02 : df.style === 'attack' ? -0.01 : 0; // 수비형 디그↑
    const digStr = strength(defenders(df), (r) => r.dig, R, df) * momFactor(df.momentum);
    const tipP = clamp((0.06 + 0.28 * (blkStr - attackPower)) * (0.62 + 0.42 * n(attacker.vq)), 0.015, 0.14); // 민감도 압축(parity — 평균 빈도 유지)
    if (atk !== 'quick' && rng.next() < tipP) {
      if (stats) stats.tips++;
      if (rng.next() < 0.09) { // 팁 범실(네트 터치·아웃) — 실측 여자배구 ~10%(2026-06-11 정렬)
        if (stats) stats.attackErrs++;
        bx?.(attacker.id, (l) => { l.atkErr++; });
        if (trace) trace.push('    → 페인트 범실 (상대 득점)');
        if (E) { pushAttack('error', null); emitPoint(other(att), '공격 범실'); }
        return { winner: other(att), how: 'atkErr', recvId: recvPlayer?.id };
      }
      const tipDigP = clamp(0.6 + 0.38 * (digStr - 0.45) - 0.07 * n(attacker.vq) + defStyleBonus, 0.2, 0.88); // 민감도 압축(parity) · 기저 0.6 = 실측 정렬(킬 ~30%·지속 ~60%)
      if (rng.next() < tipDigP) { // 읽혔다 — 얕은 수비가 살림(좋은 전환)
        if (stats) stats.digs++;
        q = clamp(0.55 + 0.3 * (digStr - 0.45) + rng.range(-0.1, 0.1), 0.2, 0.9);
        if (stats) { stats.digTipSum += q; stats.digTipN++; }
        // 팁 디그도 정식 디그(stats.digs 포함) — 귀속(box·touches)을 클린 디그와 동일하게(digSucc==stats.digs, 보드 정합).
        const dDefT = defenders(df);
        const dgT = digRng && dDefT.length ? pickByDig(dDefT, R, digRng) : (dDefT[0] ?? attacker);
        lastDigger = dgT; // 다음 hop 어시 귀속용(세터가 디그하면 비상 세터로)
        tch?.('dig', other(att), dgT);
        bx?.(dgT.id, (l) => { l.digSucc++; });
        if (trace) trace.push(`    → 페인트 읽힘! 디그 [${sideKo(other(att))}] ${dgT.name} (전환, q ${q.toFixed(2)})`);
        if (E) pushAttack('dug', null);
        att = other(att);
        continue;
      }
      if (stats) { stats.kills++; stats.tipKills++; } // KOVO 집계상 팁도 공격 득점
      bx?.(attacker.id, (l) => { l.atkKill++; }); bx?.(assistSetter.id, (l) => { l.assist++; });
      if (trace) trace.push(`    → 페인트 득점! [${sideKo(att)}] ${attacker.name} (블록·수비 사이 톡)`);
      if (E) { pushAttack('kill', null); emitPoint(att, '페인트'); }
      return { winner: att, how: 'tip', byId: attacker.id, recvId: recvPlayer?.id, setId: assistSetter.id };
    }
    const r1 = rng.next();
    if (r1 < errP2) { if (stats) stats.attackErrs++; bx?.(attacker.id, (l) => { l.atkErr++; }); if (trace) trace.push('    → 공격 범실 (상대 득점)'); if (E) { pushAttack('error', null); emitPoint(other(att), '공격 범실'); } return { winner: other(att), how: 'atkErr', recvId: recvPlayer?.id }; }
    if (r1 < errP2 + blockP) {
      // 공격방법(5.1): 영리한 공격수는 블록아웃/툴샷으로 살린다(VQ↑일수록)
      // 실효 = 0.35×VQ − 0.03. 두 리터럴(0.12−0.15)을 합치지 않는다 — 합치면 부동소수점 1 ULP가
      // 달라져 결정론(같은 시드=같은 결과·세이브 리플레이)이 깨진다(2026-06-12 확인).
      const blockOutP = clamp(0.12 + 0.35 * n(attacker.vq) - 0.15, 0.04, 0.4);
      if (rng.next() < blockOutP) { if (stats) stats.blockouts++; bx?.(attacker.id, (l) => { l.atkKill++; }); bx?.(assistSetter.id, (l) => { l.assist++; }); if (trace) trace.push(`    → 블록아웃(툴샷) 득점 [${sideKo(att)}]`); if (E) { pushAttack('blockout', null); emitPoint(att, '블록아웃'); } return { winner: att, how: 'blockout', byId: attacker.id, recvId: recvPlayer?.id, setId: assistSetter.id }; }
      const stuffPref = df.style === 'attack' ? 0.04 : df.style === 'defense' ? -0.04 : 0;
      const stuffProb = clamp(0.55 + stuffPref + 0.55 * (blkStr - attackPower), 0.05, 0.8); // 기저 KOVO 정렬(팁 도입분 보정)·민감도 압축
      if (rng.next() < stuffProb) { if (stats) stats.stuffs++; bx?.(attacker.id, (l) => { l.atkBlocked++; }); if (blk.blockers[0]) bx?.(blk.blockers[0].id, (l) => { l.blockPt++; }); if (trace) trace.push(`    → 스터프 블록! [${sideKo(other(att))}] 득점`); if (E) { pushAttack('blocked', null); emitPoint(other(att), '스터프 블록'); } return { winner: other(att), how: 'stuff', byId: blk.blockers[0]?.id, recvId: recvPlayer?.id }; }
      if (stats) stats.softblocks++;
      if (E) pushAttack('softblock', null);
      q = clamp(0.7 + rng.range(-0.1, 0.1), 0.4, 0.92);          // 소프트 블록 → 수비측 좋은 전환
      if (stats) { stats.digSoftSum += q; stats.digSoftN++; }
      // 소프트블록 전환도 수비측이 공을 만진다 → 보드 정합용 dig 터치(처리자=pickByDig). 단 digSucc는 안 셈
      //   (softblocks는 stats.digs와 별개 집계 → 보존식 digSucc==stats.digs 유지). 보드는 이 전환의 처리자를 그린다.
      const dDefS = defenders(df);
      const dgS = digRng && dDefS.length ? pickByDig(dDefS, R, digRng) : (dDefS[0] ?? attacker);
      lastDigger = dgS; // 다음 hop 어시 귀속용
      tch?.('dig', other(att), dgS);
      if (trace) trace.push(`    → 소프트 블록 (공 튕겨 [${sideKo(other(att))}] ${dgS.name} 전환, q ${q.toFixed(2)})`);
      att = other(att);
      continue;
    }

    // 기저 0.38 — KOVO 랠리 길이 정렬(공격시도 ~34/세트·디그 ~15/세트, 2026-06. 0.46은 랠리 과장)
    const digP = clamp(0.40 + defStyleBonus + 0.45 * (digStr - attackPower), 0.05, 0.9); // 민감도 압축(parity)·기저로 평균 복원
    // 디그는 시도 자체가 체력을 쓴다(성공/실패 무관 — 몸을 던진다). 디거 = 후위 최고 디그
    const dDef = defenders(df);
    const dg0 = dDef.length ? dDef.reduce((b, p) => (R(p).dig > R(b).dig ? p : b)) : attacker;
    drain(df, dg0, 0.4); // 체력 소모는 기존 best-dig(dg0)에 — 메인 rng·승패 바이트 불변(귀속만 분산, 2026-06-24 결정)
    if (rng.next() < digP) {
      if (stats) stats.digs++;
      q = clamp(0.4 + 0.4 * (digStr - attackPower) + rng.range(-0.1, 0.1), 0.1, 0.85);
      if (stats) { stats.digRegSum += q; stats.digRegN++; }
      // 귀속(box·touches·telemetry) = 후위 수비수 dig 가중 추첨(digRng 전용 스트림 — 메인·boxRng 불간섭).
      // 리베로가 dig 최고라 최다지만 독식 아님(현실 분산). 디그 성공마다 항상 소비(box 유무 무관) → 결정론.
      const dg = digRng ? pickByDig(dDef, R, digRng) : dg0;
      lastDigger = dg; // 다음 hop 어시 귀속용(세터가 디그하면 비상 세터로)
      tch?.('dig', other(att), dg); // 디그 성공 터치(공수 전환) — 박스 digSucc 귀속자와 동일
      bx?.(dg.id, (l) => { l.digSucc++; });
      if (trace) trace.push(`    → 디그 성공 [${sideKo(other(att))}] ${dg.name}(${dg.position}) (공 튕겨 전환, q ${q.toFixed(2)})`);
      if (E) { const dgXY = xyOf(defSide, df, dg); const course = pushAttack('dug', dgXY); E.push({ t: 'dig', side: defSide, player: dg.name, pos: dg.position, at: dgXY, ball: course, reach: dist(dgXY, course), ok: true, rating: R(dg).dig, eff: eff(df, dg) }); }
      att = other(att);
      continue;
    }
    if (stats) stats.kills++;
    bx?.(attacker.id, (l) => { l.atkKill++; }); bx?.(assistSetter.id, (l) => { l.assist++; });
    if (trace) trace.push(`    → 공격 성공(킬)! [${sideKo(att)}] ${attacker.name} 득점`);
    if (E) { pushAttack('kill', null); emitPoint(att, '공격 성공'); }
    return { winner: att, how: 'kill', byId: attacker.id, recvId: recvPlayer?.id, setId: assistSetter.id }; // 공격 성공(kill)
  }
  return { winner: att, how: 'cap', recvId: recvPlayer?.id }; // 랠리 상한 강제종결 — 박스 미귀속(특정 공격수 없음), byId 생략
}
