// 선수 특성 (TRAIT_SYSTEM). 순수 함수 + id 시드 결정론.
// 같은 OVR이라도 다르게 느껴지는 선수 — 숫자 뒤의 성격(②서사 + ④단장결정).
//
// ★ 결정론 원칙: 엔진은 player.traits(명시적 데이터)만 읽는다. id로 추론하지 않는다.
//   특성은 생성 시점(seed/rookies)에 rollTraits(id)로 부여되고, 엔진은 그 필드를 읽을 뿐.
//   → traits 없는 선수(합성 테스트)는 무영향 → 기존 결정론 골든 테스트 보존.

import type { Trait } from '../types';
import { strSeed } from './rng';

export interface TraitDef { name: string; desc: string; good: boolean; cat: '멘탈' | '성장' | '내구' | '플레이'; }

// ★ 특성 효과 계수 — 단일 소스(SSOT). 아래 접근자 함수와 TRAITS.desc(화면 표시 문구)가 **둘 다 이 상수만** 참조한다.
//   → 계수를 바꾸면 엔진 산출과 설명 문구가 동시에 따라가 드리프트가 원천 차단(가드 tools/_dv_traitcopy.ts가 대조).
//   야구천재 유저 건의(2026-07-11): "특성 설명에 실제 수치를 병기해달라" → 문구를 상수에서 문자열로 합성.
export const TRAIT_FX = {
  lateBloomerAging: 0.8,    // 노쇠 배수(↓ = 노쇠 느림)
  earlyDeclineAging: 1.25,  // 노쇠 배수(↑ = 노쇠 빠름)
  diligentTrain: 1.12,      // 훈련 성장 배수
  glassInjury: 1.7,         // 부상 확률 배수
  ironInjury: 0.55,         // 부상 확률 배수
  clutchFocus: 0.08,        // 큰 고비 집중 보정(+)
  bigGameFocus: 0.05,       // 큰 고비 집중 보정(+)
  chokeFocus: 0.08,         // 큰 고비 집중 보정(− 로 적용)
  serveMachineAggr: 0.06,   // 서브 적극성 보정(+)
  // ── 상시형(static) 신규 6종(2026-07-27, Phase 1) — 경기 내내 고정 배수. 접근자가 player.traits만 읽음(미부여=1배 무영향). ──
  bomberSpike: 1.05,        // 폭격기 스파이크 화력 배수(↑)
  bomberErr: 1.15,          // 폭격기 공격 범실 배수(↑ — 양날)
  digWallDig: 1.06,         // 수비벽 디그 성공 배수(↑)
  smartVq: 1.05,            // 꾀돌이 VQ 배수(↑)
  enduranceRegen: 1.12,     // 지구력 체력재생 배수(↑)
  tankStaminaMax: 1.08,     // 강철체력 최대 체력 배수(↑)
  maestroSet: 1.05,         // 황금손 세팅 승수 배수(↑ — 세터에 유효)
  // ── 반응형(reactive) 신규 3종(2026-07-27, Phase 2a) — 경기 중 사건→임시 버프. 소폭 placeholder(방향만 확정, 크기는 메인 튜닝). ──
  //   전부 ±10%/±0.10 하드캡 안(REACTIVE_SKILL_CAP·REACTIVE_FOCUS_CAP). reactiveSkillMult/reactiveFocusAdj가 참조.
  reactiveJokerAll: 1.04,   // 조커: 교체 투입 순간 전 스킬 배수(↑ · buff)
  reactiveFragileSpike: 0.97, // 유리멘탈: 블로킹 당한 뒤 스파이크 배수(↓ · debuff)
  reactiveFragileFocus: 0.05, // 유리멘탈: 집중 보정(− 로 적용 · debuff)
  reactiveBounceFocus: 0.05,  // 오뚝이: 막힘/범실 직후 집중 보정(+ · buff)
  // ── 반응형(reactive) 이벤트 발동형 4종(2026-07-27, Phase 2b) — 소폭 placeholder(방향만 확정, 크기는 메인 튜닝). 전부 ±10%/±0.10 캡 안. ──
  reactiveColdStartAll: 0.96, // 낯가림: 교체 투입 직후 전 스킬 배수(↓ · debuff · joker 상극)
  reactivePinchServe: 1.05,   // 핀치서버: 교체 서브 투입 후 서브 배수(↑ · buff)
  reactiveClutchSpike: 1.08,  // 대타승부사: 교체 후 첫 공격 스파이크 배수(↑ · buff · 1랠리)
  reactiveAceServe: 1.05,     // 에이스기세: 서브 에이스 성공 후 서브 배수(↑ · buff)
  // ── 경기 맥락 상시형(venue) 2종(2026-07-27, Phase 2d) — 홈/원정 고정 배수. 두 특성 공유(±3% placeholder). venueSkillMult 참조. ──
  venueBonus: 1.03,           // 유리한 코트(안방호랑이=홈·원정형=원정) 전 스킬 배수(↑)
  venuePenalty: 0.97,         // 불리한 코트(안방호랑이=원정·원정형=홈) 전 스킬 배수(↓)
  // ── 상태형(state-based) 5종(2026-07-27, Phase 3) — 경기 국면(현재 세트 점수·세트번호) 조건 충족 동안만 상시 배수. **연출 없음**(clutch식 조용한 국면 보정, §6.4 — reactiveEvents 미발행). stateSkillMult 참조. ±3% placeholder. ──
  closerMul: 1.03,            // 뒷심: 세트 후반(양팀 최고 점수 ≥20) 전 스킬 배수(↑)
  fastStartMul: 1.03,         // 초반집중: 세트 초반(양팀 최고 점수 ≤10) 전 스킬 배수(↑)
  comebackMul: 1.03,          // 역전의명수: 그 선수 팀이 뒤지는 동안 전 스킬 배수(↑)
  thinIceMul: 0.97,           // 살얼음: 그 선수 팀이 뒤지는 동안 전 스킬 배수(↓ — 양날 부정)
  tiebreakerMul: 1.03,        // 5세트의사나이: 현재 세트가 5세트면 전 스킬 배수(↑)
} as const;

// 반응형 유효 배수 하드캡(스노볼 방지 — 스택/중복 포함 절대 초과 금지). ±10% / ±0.10.
export const REACTIVE_SKILL_CAP = 0.10; // reactiveSkillMult ∈ [0.90, 1.10]
export const REACTIVE_FOCUS_CAP = 0.10; // reactiveFocusAdj ∈ [−0.10, +0.10]
/** 스킬 배수 하드캡 clamp — 임의로 큰 계수도 [0.90, 1.10]로 봉인(가드 _dv_reactive (e)가 극단값 주입 검증). */
export const reactiveClampSkill = (m: number): number => Math.max(1 - REACTIVE_SKILL_CAP, Math.min(1 + REACTIVE_SKILL_CAP, m));
/** 집중 보정 하드캡 clamp — [−0.10, +0.10]로 봉인. */
export const reactiveClampFocus = (a: number): number => Math.max(-REACTIVE_FOCUS_CAP, Math.min(REACTIVE_FOCUS_CAP, a));

// 계수 → 표시 % 변환(문구용). 배수는 1.0 기준 증감%, 가감 보정은 ×100 %p. 반올림 정수라 문구=계수 대조가 명확.
const upPct = (m: number) => `+${Math.round((m - 1) * 100)}%`;   // 1.12 → +12% · 1.7 → +70%
const fastPct = (m: number) => `${Math.round((m - 1) * 100)}%`;  // 1.25 → 25%
const slowPct = (m: number) => `${Math.round((1 - m) * 100)}%`;  // 0.8 → 20%
const cutPct = (m: number) => `−${Math.round((1 - m) * 100)}%`;  // 0.55 → −45%
const addPP = (a: number) => `+${Math.round(a * 100)}%`;         // 0.08 → +8%
const cutPP = (a: number) => `−${Math.round(a * 100)}%`;         // 0.08 → −8%

export const TRAITS: Record<Trait, TraitDef> = {
  clutch:       { name: '클러치', desc: `듀스·매치포인트 같은 큰 고비에 집중력이 오른다 (${addPP(TRAIT_FX.clutchFocus)})`, good: true, cat: '멘탈' },
  bigGame:      { name: '큰경기형', desc: `중요한 순간 집중력이 오른다 (${addPP(TRAIT_FX.bigGameFocus)})`, good: true, cat: '멘탈' },
  choke:        { name: '새가슴', desc: `접전 고비에 집중력이 흔들린다 (${cutPP(TRAIT_FX.chokeFocus)})`, good: false, cat: '멘탈' },
  lateBloomer:  { name: '대기만성', desc: `전성기가 길다 — 신체 능력 하락이 ${slowPct(TRAIT_FX.lateBloomerAging)} 느리다`, good: true, cat: '성장' },
  earlyDecline: { name: '짧은전성기', desc: `전성기가 짧다 — 신체 능력 하락이 ${fastPct(TRAIT_FX.earlyDeclineAging)} 빠르다`, good: false, cat: '성장' },
  diligent:     { name: '노력형', desc: `훈련 효율이 높아 더 빨리 성장한다 (${upPct(TRAIT_FX.diligentTrain)})`, good: true, cat: '성장' },
  glass:        { name: '유리몸', desc: `부상이 잦다 — 부상 확률 ${upPct(TRAIT_FX.glassInjury)}`, good: false, cat: '내구' },
  iron:         { name: '철강', desc: `좀처럼 다치지 않는다 — 부상 확률 ${cutPct(TRAIT_FX.ironInjury)}`, good: true, cat: '내구' },
  serveMachine: { name: '서브머신', desc: `공격적인 서브를 즐긴다 — 서브 적극성 ${addPP(TRAIT_FX.serveMachineAggr)}`, good: true, cat: '플레이' },
  leader:       { name: '리더', desc: '팀의 정신적 지주 (경기 효과는 없음)', good: true, cat: '플레이' },
  // ── 상시형 신규 6종 — desc는 TRAIT_FX에서 문자열 합성(하드코딩 금지, 가드 _dv_traitcopy가 대조). 폭격기는 두 값 병기 ──
  bomber:       { name: '폭격기', desc: `강타로 몰아붙인다 — 스파이크 ${upPct(TRAIT_FX.bomberSpike)}·공격 범실 ${upPct(TRAIT_FX.bomberErr)}`, good: true, cat: '플레이' },
  digWall:      { name: '수비벽', desc: `코트 수비 범위가 넓다 — 디그 ${upPct(TRAIT_FX.digWallDig)}`, good: true, cat: '플레이' },
  smart:        { name: '꾀돌이', desc: `코트를 읽는 배구 IQ — VQ ${upPct(TRAIT_FX.smartVq)}`, good: true, cat: '멘탈' },
  endurance:    { name: '지구력', desc: `좀처럼 지치지 않는다 — 체력재생 ${upPct(TRAIT_FX.enduranceRegen)}`, good: true, cat: '내구' },
  tank:         { name: '강철체력', desc: `버티는 최대 체력 — 최대 체력 ${upPct(TRAIT_FX.tankStaminaMax)}`, good: true, cat: '내구' },
  maestro:      { name: '황금손', desc: `팀 공격을 살리는 토스 — 세팅 ${upPct(TRAIT_FX.maestroSet)}`, good: true, cat: '플레이' },
  // ── 반응형 신규 3종(2026-07-27, Phase 2a) — desc는 TRAIT_FX에서 문자열 합성(가드 _dv_traitcopy 대조). 5랠리 지속·타임아웃/세트끝 해제. ──
  joker:        { name: '조커', desc: `교체로 들어가면 잠깐 살아난다 — 투입 직후 전 능력 ${upPct(TRAIT_FX.reactiveJokerAll)} (5랠리)`, good: true, cat: '플레이' },
  fragile:      { name: '유리멘탈', desc: `블로킹에 막히면 잠깐 흔들린다 — 스파이크 ${cutPct(TRAIT_FX.reactiveFragileSpike)}·집중 ${cutPP(TRAIT_FX.reactiveFragileFocus)} (5랠리)`, good: false, cat: '멘탈' },
  bounce:       { name: '오뚝이', desc: `막히거나 실수해도 곧 다시 집중한다 — 집중 ${addPP(TRAIT_FX.reactiveBounceFocus)} (5랠리)`, good: true, cat: '멘탈' },
  // ── 반응형 이벤트 발동형 4종(2026-07-27, Phase 2b) — desc는 TRAIT_FX에서 문자열 합성(가드 _dv_traitcopy 대조). ──
  coldStart:    { name: '낯가림', desc: `교체로 들어가면 잠깐 적응이 안 된다 — 투입 직후 전 능력 ${cutPct(TRAIT_FX.reactiveColdStartAll)} (5랠리)`, good: false, cat: '플레이' },
  pinchServer:  { name: '핀치서버', desc: `교체 서브로 들어가면 서브가 매섭다 — 서브 ${upPct(TRAIT_FX.reactivePinchServe)} (5랠리)`, good: true, cat: '플레이' },
  clutchSub:    { name: '대타승부사', desc: `교체 투입 후 첫 공격에 힘이 실린다 — 스파이크 ${upPct(TRAIT_FX.reactiveClutchSpike)} (첫 공격)`, good: true, cat: '멘탈' },
  aceStreak:    { name: '에이스기세', desc: `서브 에이스를 터뜨리면 기세가 오른다 — 서브 ${upPct(TRAIT_FX.reactiveAceServe)} (5랠리)`, good: true, cat: '멘탈' },
  // ── 경기 맥락 상시형 2종(2026-07-27, Phase 2d) — desc는 TRAIT_FX 합성(하드코딩 금지, 가드 _dv_traitcopy 대조). 홈/원정 양쪽 병기. ──
  homeTiger:    { name: '안방 호랑이', desc: `홈에서 강하다 — 홈 전 능력 ${upPct(TRAIT_FX.venueBonus)}·원정 ${cutPct(TRAIT_FX.venuePenalty)}`, good: true, cat: '멘탈' },
  awayWarrior:  { name: '원정형', desc: `원정에서 강하다 — 원정 전 능력 ${upPct(TRAIT_FX.venueBonus)}·홈 ${cutPct(TRAIT_FX.venuePenalty)}`, good: true, cat: '멘탈' },
  // ── 상태형 5종(2026-07-27, Phase 3) — desc는 TRAIT_FX 합성(하드코딩 금지, 가드 _dv_traitcopy 대조). 조건을 문구에 명시. 연출 없음(조용한 국면 보정, §6.4). ──
  closer:       { name: '뒷심', desc: `막판에 강해진다 — 세트 후반(양팀 20점+) 전 능력 ${upPct(TRAIT_FX.closerMul)}`, good: true, cat: '멘탈' },
  fastStart:    { name: '초반집중', desc: `시작부터 몰아친다 — 세트 초반(10점 이하) 전 능력 ${upPct(TRAIT_FX.fastStartMul)}`, good: true, cat: '멘탈' },
  comeback:     { name: '역전의명수', desc: `뒤질수록 힘을 낸다 — 뒤지는 동안 전 능력 ${upPct(TRAIT_FX.comebackMul)}`, good: true, cat: '멘탈' },
  thinIce:      { name: '살얼음', desc: `끌려가면 흔들린다 — 뒤지는 동안 전 능력 ${cutPct(TRAIT_FX.thinIceMul)}`, good: false, cat: '멘탈' },
  tiebreaker:   { name: '5세트의 사나이', desc: `마지막 세트에 강하다 — 5세트에 전 능력 ${upPct(TRAIT_FX.tiebreakerMul)}`, good: true, cat: '멘탈' },
};

// 등장 가중치 — 좋은 특성이 흔하고 부정 특성은 드물게(도박은 성립하되 희소)
const POOL: { t: Trait; w: number }[] = [
  { t: 'clutch', w: 10 }, { t: 'bigGame', w: 8 }, { t: 'lateBloomer', w: 7 },
  { t: 'iron', w: 8 }, { t: 'serveMachine', w: 8 }, { t: 'leader', w: 7 }, { t: 'diligent', w: 9 },
  // 상시형 신규 6종(2026-07-27, Phase 1) — 전부 good, w=7(부정 가중은 불변 — 보유율은 메인이 재측정)
  { t: 'bomber', w: 7 }, { t: 'digWall', w: 7 }, { t: 'smart', w: 7 },
  { t: 'endurance', w: 7 }, { t: 'tank', w: 7 }, { t: 'maestro', w: 7 },
  // 반응형 신규 3종(2026-07-27, Phase 2a) — good(조커/오뚝이) w=5, bad(유리멘탈) w=2. 추가 후 부정 보유율은 메인이 재측정·튜닝(§6.3).
  { t: 'joker', w: 5 }, { t: 'bounce', w: 5 },
  // 반응형 이벤트 발동형 4종(2026-07-27, Phase 2b) — good 3종(pinchServer/clutchSub/aceStreak) w=4, bad(coldStart) w=2. 부정 보유율은 메인이 재측정.
  { t: 'pinchServer', w: 4 }, { t: 'clutchSub', w: 4 }, { t: 'aceStreak', w: 4 },
  // 경기 맥락 상시형 2종(2026-07-27, Phase 2d) — 둘 다 good(양날), 각 w=5. 부정 보유율 영향 미미(재측정은 메인).
  { t: 'homeTiger', w: 5 }, { t: 'awayWarrior', w: 5 },
  // 상태형 5종(2026-07-27, Phase 3) — good 4종(closer/comeback/fastStart/tiebreaker) 각 w=4, bad(thinIce) w=2. 부정 보유율은 메인 재측정.
  { t: 'closer', w: 4 }, { t: 'comeback', w: 4 }, { t: 'fastStart', w: 4 }, { t: 'tiebreaker', w: 4 },
  { t: 'choke', w: 4 }, { t: 'earlyDecline', w: 3 }, { t: 'glass', w: 4 }, { t: 'fragile', w: 2 }, { t: 'coldStart', w: 2 }, { t: 'thinIce', w: 2 }, // 부정 가중 — fragile(유리멘탈)·coldStart(낯가림)=반응형 부정·thinIce(살얼음)=상태형 부정 각 w=2
];
const TOTAL_W = POOL.reduce((s, x) => s + x.w, 0);

const frac = (s: string) => (strSeed(s) % 100000) / 100000; // 0..1 결정론

// 상극(대립) 특성 — 한 선수에 같이 부여 금지(서로 상쇄돼 무의미)
export const ANTAGONISTS: Partial<Record<Trait, readonly Trait[]>> = {
  clutch: ['choke'],
  bigGame: ['choke'],
  choke: ['clutch', 'bigGame'],
  lateBloomer: ['earlyDecline'],
  earlyDecline: ['lateBloomer'],
  iron: ['glass'],
  glass: ['iron'],
  // 반응형 상극(2026-07-27, Phase 2a) — 유리멘탈(막히면 흔들림) ↔ 오뚝이(막혀도 다시 집중): 서로 상쇄돼 무의미
  fragile: ['bounce'],
  bounce: ['fragile'],
  // 반응형 상극(2026-07-27, Phase 2b) — 조커(교체 투입 시 살아남 buff) ↔ 낯가림(교체 투입 시 적응 못 함 debuff): 같은 트리거의 정반대 → 상쇄
  joker: ['coldStart'],
  coldStart: ['joker'],
  // 경기 맥락 상극(2026-07-27, Phase 2d) — 안방호랑이(홈↑원정↓) ↔ 원정형(원정↑홈↓): 서로 정반대 → 같이 부여하면 상쇄돼 무의미
  homeTiger: ['awayWarrior'],
  awayWarrior: ['homeTiger'],
  // 상태형 상극(2026-07-27, Phase 3) — 뒷심(세트 후반↑) ↔ 초반집중(세트 초반↑): 반대 국면 · 역전의명수(뒤지면↑) ↔ 살얼음(뒤지면↓): 같은 국면 정반대 → 상쇄
  closer: ['fastStart'],
  fastStart: ['closer'],
  comeback: ['thinIce'],
  thinIce: ['comeback'],
};

function pickWeighted(s: string, exclude: Set<Trait>): Trait | null {
  const avail = POOL.filter((x) => !exclude.has(x.t));
  if (!avail.length) return null;
  const total = avail.reduce((a, x) => a + x.w, 0);
  let t = frac(s) * total;
  for (const x of avail) { t -= x.w; if (t <= 0) return x.t; }
  return avail[avail.length - 1].t;
}

/** id 결정론으로 특성 부여 — 전원 1~3개(1개 흔함·3개 드묾), 중복·상극 없음 */
export function rollTraits(id: string): Trait[] {
  const r = frac('trait:' + id);
  const count = r < 0.60 ? 1 : r < 0.90 ? 2 : 3;
  const out: Trait[] = [];
  const used = new Set<Trait>();
  for (let k = 0; k < count; k++) {
    const t = pickWeighted(`trait:${id}:${k}`, used);
    if (!t) break;
    out.push(t);
    used.add(t);
    for (const a of ANTAGONISTS[t] ?? []) used.add(a); // 상극 동시부여 금지
  }
  return out;
}

// ─── 효과 접근자 (traits 기반, 기본 무효과) ───
const has = (traits: Trait[] | undefined, t: Trait): boolean => !!traits && traits.includes(t);

/** 노쇠 배수 — 대기만성 둔화, 짧은전성기 가속 (aging.ts) */
export function agingTraitMult(traits?: Trait[]): number {
  let m = 1;
  if (has(traits, 'lateBloomer')) m *= TRAIT_FX.lateBloomerAging;
  if (has(traits, 'earlyDecline')) m *= TRAIT_FX.earlyDeclineAging;
  return m;
}

/** 훈련 성장 배수 — 노력형 (training.ts) */
export function trainTraitMult(traits?: Trait[]): number {
  return has(traits, 'diligent') ? TRAIT_FX.diligentTrain : 1;
}

/** 부상 확률 배수 — 유리몸↑·철강↓ (injury P4) */
export function injuryTraitMult(traits?: Trait[]): number {
  let m = 1;
  if (has(traits, 'glass')) m *= TRAIT_FX.glassInjury;
  if (has(traits, 'iron')) m *= TRAIT_FX.ironInjury;
  return m;
}

/** 클러치 상황(듀스/매치포인트) 집중 보정 — 클러치/큰경기↑·새가슴↓ (rally clutch 한정) */
export function clutchFocusAdj(traits?: Trait[]): number {
  let a = 0;
  if (has(traits, 'clutch')) a += TRAIT_FX.clutchFocus;
  if (has(traits, 'bigGame')) a += TRAIT_FX.bigGameFocus;
  if (has(traits, 'choke')) a -= TRAIT_FX.chokeFocus;
  return a;
}

/** 서브 공격성 보정 — 서브머신 (rally chooseServe, 상시) */
export function serveAggrAdj(traits?: Trait[]): number {
  return has(traits, 'serveMachine') ? TRAIT_FX.serveMachineAggr : 0;
}

// ─── 상시형(static) 신규 6종 접근자 — 미부여 시 전부 1배(무영향 → 결정론 골든 보존). injuryTraitMult 패턴 ───
/** 스파이크 화력 배수 — 폭격기 (rally 공격 성공 판정) */
export function spikeTraitMult(traits?: Trait[]): number {
  return has(traits, 'bomber') ? TRAIT_FX.bomberSpike : 1;
}
/** 공격 범실 배수 — 폭격기(양날) (rally 공격 범실 판정) */
export function attackErrTraitMult(traits?: Trait[]): number {
  return has(traits, 'bomber') ? TRAIT_FX.bomberErr : 1;
}
/** 디그 성공 배수 — 수비벽 (rally 디그 성공 판정) */
export function digTraitMult(traits?: Trait[]): number {
  return has(traits, 'digWall') ? TRAIT_FX.digWallDig : 1;
}
/** VQ 배수 — 꾀돌이 (rally 포지션 폴트/판단) */
export function vqTraitMult(traits?: Trait[]): number {
  return has(traits, 'smart') ? TRAIT_FX.smartVq : 1;
}
/** 체력재생 배수 — 지구력 (match recover) */
export function staminaRegenTraitMult(traits?: Trait[]): number {
  return has(traits, 'endurance') ? TRAIT_FX.enduranceRegen : 1;
}
/** 최대 체력 배수 — 강철체력 (rally drain 분모 = 체력 소모율↓) */
export function staminaMaxTraitMult(traits?: Trait[]): number {
  return has(traits, 'tank') ? TRAIT_FX.tankStaminaMax : 1;
}
/** 세팅 승수 배수 — 황금손 (rally setMul, 세터 유효) */
export function setTraitMult(traits?: Trait[]): number {
  return has(traits, 'maestro') ? TRAIT_FX.maestroSet : 1;
}

// ─── 경기 맥락 상시형(venue) 2종 접근자(2026-07-27, Phase 2d, TRAIT_SYSTEM §6.5) ───
//   상시형이지만 배수가 traits뿐 아니라 경기 맥락(홈/원정)에도 의존. reactiveSkillMult과 같은 층에 한 겹 곱.
//   미부여=1배(무영향 → 결정론 골든 보존). home/away는 경기 입력에서 결정 → rng 무소비.
/** 홈/원정 고정 배수 — 안방호랑이(홈↑원정↓)·원정형(원정↑홈↓). isHome=이 선수 팀이 그 경기 홈이냐. 미부여=1배. */
export function venueSkillMult(traits: Trait[] | undefined, isHome: boolean): number {
  let m = 1;
  if (has(traits, 'homeTiger')) m *= isHome ? TRAIT_FX.venueBonus : TRAIT_FX.venuePenalty;
  if (has(traits, 'awayWarrior')) m *= isHome ? TRAIT_FX.venuePenalty : TRAIT_FX.venueBonus;
  return m;
}

// ─── 상태형(state-based) 5종 접근자(2026-07-27, Phase 3, TRAIT_SYSTEM §6.4) ───
//   반응형 activeBuffs를 쓰지 않고, clutch처럼 **현재 랠리의 경기 국면**(현재 세트 home/away 점수·setNo)을 산출에 넘겨
//   조건 충족 동안만 상시 배수를 곱한다. **연출 없음**(reactiveEvents 미발행 — 보드 무변화, 조용한 국면 보정). match.ts가
//   랠리 직전 점수(h,a,setNo)로 StateCtx를 만들어 playRally에 넘긴다(venue와 같은 층에 한 겹 곱). 미부여·조건 미충족=1배
//   (무영향 → 결정론 골든 보존). ctx는 경기 입력(점수/세트) 파생 → rng 무소비. 스택: 선수당 최대 3특성(rollTraits)이라
//   곱 레이어 ≤3(정적×venue×state 등) + 상극(closer↔fastStart·comeback↔thinIce)으로 같은 방향 이중 곱 차단.
export interface StateCtx { homeScore: number; awayScore: number; setNo: number }
/** 경기 국면 조건부 상시 배수 — isHome=이 선수 팀이 그 경기 홈이냐(comeback/thinIce의 "내 점수" 선택). 미부여·미충족=1배. */
export function stateSkillMult(traits: Trait[] | undefined, ctx: StateCtx, isHome: boolean): number {
  if (!traits) return 1;
  let m = 1;
  const top = Math.max(ctx.homeScore, ctx.awayScore);
  const myScore = isHome ? ctx.homeScore : ctx.awayScore;
  const oppScore = isHome ? ctx.awayScore : ctx.homeScore;
  const behind = myScore < oppScore;
  if (has(traits, 'closer') && top >= 20) m *= TRAIT_FX.closerMul;        // 세트 후반
  if (has(traits, 'fastStart') && top <= 10) m *= TRAIT_FX.fastStartMul;  // 세트 초반
  if (has(traits, 'comeback') && behind) m *= TRAIT_FX.comebackMul;       // 뒤지는 팀
  if (has(traits, 'thinIce') && behind) m *= TRAIT_FX.thinIceMul;         // 뒤지는 팀(부정)
  if (has(traits, 'tiebreaker') && ctx.setNo === 5) m *= TRAIT_FX.tiebreakerMul; // 5세트
  return m;
}

// ─── 반응형(reactive) 신규 레이어(2026-07-27, Phase 2a, TRAIT_SYSTEM §6.3) ───
//   경기 중 사건(교체 투입·블로킹 당함·범실)→임시 버프. 신규 엔진 임시상태(저장 안 함, 시드 재생으로 재계산).
//   RallyTeam.activeBuffs: Map<playerId, ActiveBuff>(선수당 최대 1개 — Map 덮어쓰기로 강제). match.ts가 방아쇠 판정·지속/해제,
//   rally.ts가 아래 두 접근자로 효과 적용. 미부여 선수는 activeBuffs에 엔트리 없음 → undefined → 1배/0(무영향, 결정론 골든 보존).
export type ReactiveSkill = 'spike' | 'serve' | 'dig' | 'receive' | 'block' | 'set';
export interface ActiveBuff { trait: Trait; kind: 'buff' | 'debuff'; left: number }

/** 활성 버프의 스킬 배수 — 없으면 1배. **±10% 하드캡 clamp**(스노볼 방지). 조커=전스킬↑·유리멘탈=스파이크↓. */
export function reactiveSkillMult(buff: ActiveBuff | undefined, skill: ReactiveSkill): number {
  if (!buff) return 1;
  let m = 1;
  switch (buff.trait) {
    case 'joker': m = TRAIT_FX.reactiveJokerAll; break;                 // 전 스킬 ↑
    case 'coldStart': m = TRAIT_FX.reactiveColdStartAll; break;         // 전 스킬 ↓(낯가림 · joker 반대)
    case 'fragile': if (skill === 'spike') m = TRAIT_FX.reactiveFragileSpike; break; // 스파이크만 ↓
    case 'pinchServer': if (skill === 'serve') m = TRAIT_FX.reactivePinchServe; break; // 서브만 ↑
    case 'aceStreak': if (skill === 'serve') m = TRAIT_FX.reactiveAceServe; break;     // 서브만 ↑
    case 'clutchSub': if (skill === 'spike') m = TRAIT_FX.reactiveClutchSpike; break;  // 스파이크만 ↑(교체 후 첫 공격)
    // bounce: 스킬 배수 없음(집중 보정만) → reactiveFocusAdj에서 처리
  }
  return reactiveClampSkill(m);
}

/** 활성 버프의 집중(focus) 보정 ± — 없으면 0. **±0.10 하드캡 clamp**. clutchFocusAdj와 같은 층(서브 정확·공격 안정). */
export function reactiveFocusAdj(buff: ActiveBuff | undefined): number {
  if (!buff) return 0;
  let a = 0;
  if (buff.trait === 'fragile') a = -TRAIT_FX.reactiveFragileFocus;   // 집중 흔들림(−)
  else if (buff.trait === 'bounce') a = TRAIT_FX.reactiveBounceFocus; // 다시 집중(+)
  return reactiveClampFocus(a);
}

/** 반응형 버프 맵 지속 감소(랠리 1회 소비) — left−−, 0 이하 제거. 순수(입력 맵 변이). 만료된 수를 반환(관측용).
 *  match.ts 랠리 루프가 매 랠리 후 호출 · 가드 _dv_reactive (c)가 5랠리 만료를 이 함수로 직접 검증(프로덕션 경로 동일). */
export function tickReactiveBuffs(buffs: Map<string, ActiveBuff>): number {
  let expired = 0;
  for (const [id, b] of buffs) { b.left--; if (b.left <= 0) { buffs.delete(id); expired++; } }
  return expired;
}
