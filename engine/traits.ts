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
} as const;

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
};

// 등장 가중치 — 좋은 특성이 흔하고 부정 특성은 드물게(도박은 성립하되 희소)
const POOL: { t: Trait; w: number }[] = [
  { t: 'clutch', w: 10 }, { t: 'bigGame', w: 8 }, { t: 'lateBloomer', w: 7 },
  { t: 'iron', w: 8 }, { t: 'serveMachine', w: 8 }, { t: 'leader', w: 7 }, { t: 'diligent', w: 9 },
  { t: 'choke', w: 5 }, { t: 'earlyDecline', w: 4 }, { t: 'glass', w: 5 },
];
const TOTAL_W = POOL.reduce((s, x) => s + x.w, 0);

const frac = (s: string) => (strSeed(s) % 100000) / 100000; // 0..1 결정론

function pickWeighted(s: string, exclude: Set<Trait>): Trait | null {
  const avail = POOL.filter((x) => !exclude.has(x.t));
  if (!avail.length) return null;
  const total = avail.reduce((a, x) => a + x.w, 0);
  let t = frac(s) * total;
  for (const x of avail) { t -= x.w; if (t <= 0) return x.t; }
  return avail[avail.length - 1].t;
}

/** id 결정론으로 특성 부여 — 대부분 0개, 가끔 1개, 드물게 2개(희소가 특별) */
export function rollTraits(id: string): Trait[] {
  const r = frac('trait:' + id);
  const count = r < 0.55 ? 0 : r < 0.85 ? 1 : 2;
  const out: Trait[] = [];
  const used = new Set<Trait>();
  for (let k = 0; k < count; k++) {
    const t = pickWeighted(`trait:${id}:${k}`, used);
    if (t) { out.push(t); used.add(t); }
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
