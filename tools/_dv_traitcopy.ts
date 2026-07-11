// 특성 설명 수치 대조 가드 (TRAIT_SYSTEM §표기 원칙, 2026-07-11) — 야구천재 유저 건의로 특성 desc에 실계수를 병기했다.
//   목적: **화면에 뜨는 설명의 수치 == 엔진이 실제로 쓰는 계수(TRAIT_FX)** 를 봉인해, 계수만 바꾸고 문구를 안 고치는(또는 반대)
//         드리프트를 원천 차단. desc는 TRAIT_FX에서 문자열로 합성되므로 정상 상태는 항상 일치 — 가드는 그 계약을 A/B로 증명한다.
//   허위 오라클 금지: 문구의 숫자를 인위로 틀리게(mutant) 만들면 가드가 FAIL 해야 한다(민감도 자가검증).
//   Usage: npx tsx tools/_dv_traitcopy.ts
import { TRAITS, TRAIT_FX } from '../engine/traits';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

// 계수 → 기대 표시 정수(설명 문구에 반드시 포함돼야 하는 수). 배수는 1.0 기준 증감%(정수), 가감 보정은 ×100 %p.
//  leader = null(효과 없음 — 숫자가 없고 "없음"이 있어야).
const R = Math.round;
const EXPECT: Record<string, number | null> = {
  clutch: R(TRAIT_FX.clutchFocus * 100),
  bigGame: R(TRAIT_FX.bigGameFocus * 100),
  choke: R(TRAIT_FX.chokeFocus * 100),
  lateBloomer: R((1 - TRAIT_FX.lateBloomerAging) * 100),
  earlyDecline: R((TRAIT_FX.earlyDeclineAging - 1) * 100),
  diligent: R((TRAIT_FX.diligentTrain - 1) * 100),
  glass: R((TRAIT_FX.glassInjury - 1) * 100),
  iron: R((1 - TRAIT_FX.ironInjury) * 100),
  serveMachine: R(TRAIT_FX.serveMachineAggr * 100),
  leader: null,
};

console.log('── 특성 설명 수치 == 엔진 계수 대조 ──');
for (const [t, def] of Object.entries(TRAITS)) {
  const exp = EXPECT[t];
  if (exp === null) {
    ok(/없음/.test(def.desc) && !/\d/.test(def.desc), `${def.name}(${t}): 효과 없음 — 숫자 없고 "없음" 명시  [${def.desc}]`);
  } else {
    ok(def.desc.includes(String(exp)), `${def.name}(${t}): 설명에 ${exp} 포함(계수 대조)  [${def.desc}]`);
  }
}

// 모든 특성이 EXPECT에 등록됐는지(새 특성 추가 시 누락 방지)
ok(Object.keys(TRAITS).every((t) => t in EXPECT), '모든 특성이 EXPECT 대조표에 등록됨(신규 특성 누락 방지)');

// ── A/B 자가검증(오라클 민감도) — 문구 숫자를 틀리게 만들면 대조가 깨져야 ──
console.log('\n── A/B 오라클 민감도(mutant는 잡히고 clean은 통과) ──');
{
  // diligent 정상 desc는 "12"를 포함(clean 통과). 이를 "99"로 바꾼 mutant는 포함 안 함(가드가 잡음).
  const exp = EXPECT.diligent as number;
  const clean = TRAITS.diligent.desc;
  const mutant = clean.replace(String(exp), '99');
  ok(clean.includes(String(exp)), `clean: diligent desc가 ${exp} 포함(정상 통과)`);
  ok(!mutant.includes(String(exp)), `mutant: 숫자를 99로 바꾸면 ${exp} 미포함 → 대조 FAIL 재현(오라클 이빨 증명)`);
  ok(mutant !== clean, 'mutant != clean(치환이 실제로 일어남)');
}

console.log(fail === 0 ? '\n✅ TRAITCOPY PASS (설명 수치 == 엔진 계수)' : `\n❌ TRAITCOPY FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
