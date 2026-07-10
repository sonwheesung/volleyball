// 상설 가드 — FA 오퍼 "선수 만족도" UI 셀렉터 (FA_SYSTEM §2.8.4 Phase 4). 검증=Fable / 구현·문서=Opus (2026-07-10).
//   npx tsx tools/_dv_faofferui.ts   (exit 0/1)
//
// 허위 오라클 방지(§2.8.4 검증):
//   (A) 위임 정합 — offerSatisfaction(셀렉터) == acceptProb(offerScore(ctx)) (엔진 직접). UI가 S곡선을 재구현하지 않음.
//   (B) 민감도 A/B — 같은 선수에 연봉↑/주전보장 on/years↑ 뒤집으면 만족도 score가 실제로 상승(단조). 기본 오퍼는 불변.
//   (C) 재료 정합 — buildMyOfferCtx의 teamOvr·posGap·asking·isOriginal이 동일 off로 독립 재계산한 값과 일치 +
//       행동 교차검증(만족도 score≥SIT_OUT ⇔ resolveFAMarket 단독 입찰이 서명).
//   (D) 별점·안개 — starsFromWeight 단조·[1,5] 클램프, PREF_STAR_AXES 5축, rand 표시 고정(0.5).
import './_gt_mock';

import { resetLeagueBase } from '../data/league';
import { setSalaryEra, marketVal } from '../data/awardSalary';
import { resolveFAMarket } from '../data/offseason';
import { assignFAGrades, askingPrice, offerScore, acceptProb, prefWeightsOf, SIT_OUT, type FAGrade } from '../engine/faMarket';
import { teamOverall } from '../engine/overall';
import { positionGap } from '../engine/aiGM';
import {
  buildMyOfferCtx, offerSatisfaction, resolveMyOfferSalary, askingFor,
  starsFromWeight, STAR_STEP, PREF_STAR_AXES, offerSalaryBounds, DISPLAY_RAND,
  type MyOfferInputs,
} from '../data/faOfferSatisfaction';
import type { FAOffer, Player, Position, TrainableStat } from '../types';
import { TRAINABLE_STATS } from '../engine/training';

const BIG_CASH = 99_999_999;
const round100 = (x: number) => Math.round(x / 100) * 100;
let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

function mk(id: string, pos: Position, salary: number, v = 76): Player {
  const potential = {} as Record<TrainableStat, number>;
  for (const s of TRAINABLE_STATS) potential[s] = 88;
  return {
    id, name: id, age: 29, position: pos, isForeign: false, height: 182,
    jump: v, agility: v, staminaMax: v, staminaRegen: v, reaction: v, positioning: v,
    focus: v, consistency: v, vq: v, skSpike: v, skBlock: v, skDig: v, skReceive: v, skSet: v, skServe: v,
    xp: {}, potential, talentBase: 1, catTalent: { physical: 1, skill: 1, mental: 1 },
    contract: { salary, years: 1, remaining: 0, signedAtAge: 28 }, clubTenure: 8, peakAge: 28,
    career: { seasons: 8, matches: 100, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0, assists: 0 },
  };
}

/** 합성 오프시즌: 타깃 FA 1명(A) + t0(내 팀, 몇 명) · t1(타 팀). */
function scenario() {
  const target = mk('target', 'OP', 40000);
  const t0 = [mk('t0a', 'OH', 15000), mk('t0b', 'MB', 15000), mk('t0c', 'S', 15000)];
  const t1 = [mk('t1a', 'OH', 15000), mk('t1b', 'OP', 15000)];
  const snapshot: Record<string, Player> = {};
  for (const p of [target, ...t0, ...t1]) snapshot[p.id] = p;
  return {
    snapshot, target,
    rosters: { t0: t0.map((p) => p.id), t1: t1.map((p) => p.id) } as Record<string, string[]>,
    pool: [target.id],
  };
}

/** 약체 시나리오: t0 전원 저능력(v58)·OP 만석(gap≤0)·저연봉 → 어떤 오퍼도 매력 바닥(sit-out 관측용). */
function weakScenario() {
  const target = mk('wt', 'OP', 20000, 58);
  const t0 = [mk('w0a', 'OP', 12000, 58), mk('w0b', 'OP', 12000, 58), mk('w0c', 'OH', 12000, 58)];
  const t1 = [mk('w1a', 'OH', 12000, 58)];
  const snapshot: Record<string, Player> = {};
  for (const p of [target, ...t0, ...t1]) snapshot[p.id] = p;
  return {
    snapshot, target,
    rosters: { t0: t0.map((p) => p.id), t1: t1.map((p) => p.id) } as Record<string, string[]>,
    pool: [target.id],
  };
}

function inputsFor(offer: FAOffer): { inp: MyOfferInputs; grade: FAGrade; sc: ReturnType<typeof scenario> } {
  const sc = scenario();
  const grade = assignFAGrades([sc.target]).get(sc.target.id) ?? 'A';
  const inp: MyOfferInputs = {
    player: sc.target, myTeam: 't0', snapshot: sc.snapshot, myRosterIds: sc.rosters.t0,
    prevTeamOf: { [sc.target.id]: 't1' }, prestige: 0, grade, repMult: 1, offer, bonds: {},
  };
  return { inp, grade, sc };
}

resetLeagueBase();
setSalaryEra(66);

const DEFAULT: FAOffer = { salary: 'auto', years: 2, starterGuarantee: false, promises: {} };

// ── (A) 위임 정합 ──
console.log('── (A) 만족도 = 엔진 acceptProb(offerScore(ctx)) 위임 ──');
{
  const { inp } = inputsFor({ salary: 42000, years: 3, starterGuarantee: true, promises: {} });
  const ctx = buildMyOfferCtx(inp);
  const sat = offerSatisfaction(inp);
  ok(sat.score === offerScore(ctx), `score == 엔진 offerScore(ctx) (${sat.score} vs ${offerScore(ctx)})`);
  ok(sat.prob === acceptProb(offerScore(ctx)), 'prob == 엔진 acceptProb(offerScore) — S곡선 재구현 아님');
  ok(sat.prob === acceptProb(sat.score), 'prob == acceptProb(score) (내부 일관)');
  ok(ctx.rand === DISPLAY_RAND && DISPLAY_RAND === 0.5, 'rand 표시 고정 0.5');
  ok(sat.prob >= 0 && sat.prob <= 1, 'prob ∈ [0,1]');
}

// ── (B) 민감도 A/B (score 단조) ──
console.log('── (B) 입력 민감도 — 연봉↑·주전보장·다년이 만족도 score를 올린다 ──');
{
  const ask = askingFor(inputsFor(DEFAULT).inp);
  const lowSal = offerSatisfaction(inputsFor({ salary: round100(ask * 0.8), years: 2, starterGuarantee: false, promises: {} }).inp).score;
  const hiSal = offerSatisfaction(inputsFor({ salary: round100(ask * 1.2), years: 2, starterGuarantee: false, promises: {} }).inp).score;
  ok(hiSal > lowSal, `연봉↑ → score↑ (${lowSal.toFixed(4)} → ${hiSal.toFixed(4)})`);

  const baseGuar = offerSatisfaction(inputsFor({ salary: round100(ask), years: 2, starterGuarantee: false, promises: {} }).inp).score;
  const onGuar = offerSatisfaction(inputsFor({ salary: round100(ask), years: 2, starterGuarantee: true, promises: {} }).inp).score;
  ok(onGuar > baseGuar, `주전보장 on → score↑ (${baseGuar.toFixed(4)} → ${onGuar.toFixed(4)})`);

  const y2 = offerSatisfaction(inputsFor({ salary: round100(ask), years: 2, starterGuarantee: false, promises: {} }).inp).score;
  const y4 = offerSatisfaction(inputsFor({ salary: round100(ask), years: 4, starterGuarantee: false, promises: {} }).inp).score;
  ok(y4 > y2, `다년(2→4) → score↑ (${y2.toFixed(4)} → ${y4.toFixed(4)})`);

  // 기본 오퍼(auto·2년·무보장)는 동일 입력이면 값 불변(결정론)
  const a = offerSatisfaction(inputsFor(DEFAULT).inp).score;
  const b = offerSatisfaction(inputsFor(DEFAULT).inp).score;
  ok(a === b, '동일 기본 오퍼 → 만족도 동일(결정론)');
}

// ── (C) 재료 정합 + 행동 교차검증 ──
console.log('── (C) OfferCtx 재료 == 독립 재계산 + resolveFAMarket 서명 교차검증 ──');
{
  const { inp, grade, sc } = inputsFor({ salary: 42000, years: 2, starterGuarantee: false, promises: {} });
  const ctx = buildMyOfferCtx(inp);
  const get = (id: string) => sc.snapshot[id];
  const expOvr = teamOverall(sc.rosters.t0.map(get).filter((p): p is Player => !!p));
  const expGap = positionGap(sc.rosters.t0, get)[sc.target.position];
  const expAsk = round100(askingPrice(marketVal(sc.target), grade) * 1);
  ok(ctx.teamOvr === expOvr, `teamOvr == teamOverall(내 로스터) (${ctx.teamOvr} vs ${expOvr})`);
  ok(ctx.posGap === expGap, `posGap == positionGap()[pos] (${ctx.posGap} vs ${expGap})`);
  ok(ctx.asking === expAsk, `asking == round100(askingPrice×rep) (${ctx.asking} vs ${expAsk})`);
  ok(ctx.isOriginal === false, 'isOriginal == (prevTeamOf===myTeam) = false(prev=t1)');
  ok(resolveMyOfferSalary({ salary: 'auto', years: 2, starterGuarantee: false, promises: {} }, expAsk) === expAsk,
    "'auto' 오퍼 연봉 == asking(비공격적)");

  // 행동 교차검증: 단독 입찰이라 score≥SIT_OUT ⇔ 서명(fallback), score<SIT_OUT ⇔ 잔류.
  //   ⇒ 표시 만족도 score가 엔진 서명 여부를 예측. 강한 오퍼(위 main 시나리오) vs 약체·구멍없음·박봉(sit-out) 시나리오로 양쪽 관측.
  const runFAOn = (s: ReturnType<typeof scenario>, prevTeam: string, offer: FAOffer) => {
    const res = resolveFAMarket(
      { snapshot: s.snapshot, rosters: s.rosters, pool: s.pool },
      't0', [s.target.id], false, [], { [s.target.id]: prevTeam }, 1, { t0: 0, t1: 0 }, undefined, BIG_CASH, [],
      { [s.target.id]: offer },
    );
    return res.signedByMe.includes(s.target.id);
  };
  // 강한 오퍼 → 서명 (main: 준수한 팀·구멍 있음)
  const hiOffer: FAOffer = { salary: round100(expAsk * 1.6), years: 2, starterGuarantee: true, promises: {} };
  const hiScore = offerSatisfaction(inputsFor(hiOffer).inp).score;
  ok(hiScore >= SIT_OUT && runFAOn(scenario(), 't1', hiOffer), `강한 오퍼: 만족도 score(${hiScore.toFixed(3)})≥SIT_OUT ⇒ 서명`);

  // 약체 팀·해당 포지션 만석(gap≤0)·박봉 → 최고 점수도 바닥 → 잔류(sit-out)
  const weak = weakScenario();
  const weakGrade = assignFAGrades([weak.target]).get(weak.target.id) ?? 'A';
  const weakAsk = askingFor({ player: weak.target, grade: weakGrade, repMult: 1 });
  const loOffer: FAOffer = { salary: round100(weakAsk * 0.6), years: 2, starterGuarantee: false, promises: {} };
  const loInp: MyOfferInputs = {
    player: weak.target, myTeam: 't0', snapshot: weak.snapshot, myRosterIds: weak.rosters.t0,
    prevTeamOf: { [weak.target.id]: 't1' }, prestige: 0, grade: weakGrade, repMult: 1, offer: loOffer, bonds: {},
  };
  const loScore = offerSatisfaction(loInp).score;
  ok(loScore < SIT_OUT && !runFAOn(weakScenario(), 't1', loOffer), `약체·박봉 오퍼: 만족도 score(${loScore.toFixed(3)})<SIT_OUT ⇒ 미서명(잔류)`);
}

// ── (D) 별점·안개·범위 ──
console.log('── (D) 성향 별점 매핑·범위 ──');
{
  ok(starsFromWeight(0) === 1 && starsFromWeight(-1) === 1, '하한 클램프 = ★1');
  ok(starsFromWeight(0.55) === 5 && starsFromWeight(1) === 5, '상한 클램프 = ★5');
  let mono = true, prev = 0;
  for (let w = 0; w <= 0.6; w += 0.02) { const s = starsFromWeight(w); if (s < prev) mono = false; prev = s; }
  ok(mono, '가중치↑ → ★ 단조 비감소');
  ok(STAR_STEP === 0.11, `STAR_STEP=${STAR_STEP}`);
  ok(PREF_STAR_AXES.length === 5, 'PREF_STAR_AXES 5축(돈/우승/출전/의리/연고)');
  const w = prefWeightsOf(mk('x', 'OH', 10000));
  for (const ax of PREF_STAR_AXES) ok(typeof w[ax.key] === 'number', `축 ${ax.label}(${ax.key}) = FAWeights 키`);
  const b = offerSalaryBounds(40000, mk('y', 'OH', 10000), 100000);
  ok(b.min < b.max && b.step > 0, `연봉 범위 유효 (min ${b.min} < max ${b.max}, step ${b.step})`);
}

console.log(fail === 0 ? '\n✅ PASS — FA 오퍼 만족도 UI 셀렉터 가드 통과' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
