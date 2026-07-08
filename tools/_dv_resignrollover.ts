// 이음매 상설 가드 — 인시즌 재계약 override "다음 시즌부터 발효"(FA_SYSTEM §2.5c). 검증=Fable / 구현·문서=Opus (2026-07-08).
//   npx tsx tools/_dv_resignrollover.ts   (exit 0/1)
//
// 불변식: 재계약 3택(표준/후하게/짧게) 각각 override→롤오버→재직 시즌 수 == option.years.
//   특히 '1년' 재계약이 정확히 1시즌 재직(구 버그: 발효 0시즌 no-op·즉시 만료). override 없는 경로는 정상 −1 불변.
// A/B: 선차감 재도입 모사(override.remaining을 years−1로 미리 깎아 넣음 = 구 동작) → tenure=years−1 < years (가드 이빨).
import './_gt_mock';

import { rolloverPlayer } from '../engine/rollover';
import { resignOptions } from '../engine/salary';
import type { Contract, Player, Position, TrainableStat, TrainingFocus } from '../types';
import { TRAINABLE_STATS } from '../engine/training';

const FOCUS: TrainingFocus = { primary: [1, 2], secondary: [3, 4, 5] };
const MED = 66;
const MARKET = 42000;
let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

function mk(id: string, age: number, pos: Position = 'OH', v = 76): Player {
  const potential = {} as Record<TrainableStat, number>;
  for (const s of TRAINABLE_STATS) potential[s] = 88;
  return {
    id, name: id, age, position: pos, isForeign: false, height: 182,
    jump: v, agility: v, staminaMax: v, staminaRegen: v, reaction: v, positioning: v,
    focus: v, consistency: v, vq: v, skSpike: v, skBlock: v, skDig: v, skReceive: v, skSet: v, skServe: v,
    xp: {}, potential, talentBase: 1, catTalent: { physical: 1, skill: 1, mental: 1 },
    contract: { salary: 30000, years: 1, remaining: 1, signedAtAge: age },
    clubTenure: 5, peakAge: 28,
    // 재직 만료 시 FA(remaining 0)로 가야 카운트가 깔끔(영건 자동연장이 새 계약을 씌우면 오염) → career≥FIRST_FA_SEASONS(6).
    career: { seasons: 10, matches: 100, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0, assists: 0 },
  };
}

/** override를 최초 롤오버로 적용한 뒤, 재직(계약 잔여>0) 시즌 수를 실제 rolloverPlayer로 센다. */
function tenureSeasons(p0: Player, override: Contract): number {
  let p = rolloverPlayer(p0, FOCUS, MED, override); // endSeason 최초 롤오버 = override 발효(선차감 생략)
  let seasons = 0;
  // 병리적 무한루프 방지 캡(정상 ≤5)
  for (let g = 0; g < 30 && p.contract.remaining > 0; g++) {
    seasons++;
    p = rolloverPlayer(p, FOCUS, MED); // override 없는 정상 롤오버 — 잔여 −1
  }
  return seasons;
}

// ── ① 3택 각각 재직 시즌 수 == years (UI가 만드는 override 형태: remaining=years) ──
console.log('── ① 재계약 3택 override → 재직 시즌 수 == years ──');
for (const [lbl, age] of [['어림(25세)', 25], ['중간(29세)', 29], ['노장(33세)', 33]] as const) {
  const p = mk(`p-${age}`, age);
  const opts = resignOptions(p, MARKET);
  for (const o of opts) {
    // contracts.tsx:85 와 동일하게 override 조립: remaining = years
    const override: Contract = { salary: o.salary, years: o.years, remaining: o.years, signedAtAge: p.age };
    const tenure = tenureSeasons(p, override);
    ok(tenure === o.years, `${lbl} ${o.label}(${o.years}년) → 재직 ${tenure}시즌 (== ${o.years})`);
  }
}

// ── ②(headline) '1년' 재계약이 정확히 1시즌 재직 (구 버그: 0시즌 no-op) ──
console.log("── ② '1년' 재계약 = 1시즌 재직 (구 버그 회귀) ──");
{
  const p = mk('one-yr', 34);
  const override: Contract = { salary: 30000, years: 1, remaining: 1, signedAtAge: p.age };
  ok(tenureSeasons(p, override) === 1, "1년 재계약 → 정확히 1시즌 재직(발효 0시즌 no-op 아님)");
}

// ── ③ override 없는 경로 불변 (정상 −1 · FA 공시 · 영건 자동연장) ──
console.log('── ③ override 없는 롤오버 경로 불변 ──');
{
  // 다년 계약: remaining 2 → 1 (선차감 유지)
  const p2 = { ...mk('norm', 29), contract: { salary: 30000, years: 3, remaining: 2, signedAtAge: 27 } as Contract };
  ok(rolloverPlayer(p2, FOCUS, MED).contract.remaining === 1, '정상 계약 remaining 2 → 1 (override 없으면 선차감 유지)');
  // 만료+FA자격: remaining 1 → 0 (FA 공시)
  const pFa = { ...mk('fa', 30), contract: { salary: 30000, years: 1, remaining: 1, signedAtAge: 29 } as Contract };
  ok(rolloverPlayer(pFa, FOCUS, MED).contract.remaining === 0, '만료+FA자격(career 10) → remaining 0 (FA 공시)');
  // 만료+영건(career<6): 자동연장 → remaining > 0 (새 계약)
  const pYoung: Player = { ...mk('young', 21), career: { ...mk('young', 21).career, seasons: 3 }, contract: { salary: 20000, years: 1, remaining: 1, signedAtAge: 20 } as Contract };
  ok(rolloverPlayer(pYoung, FOCUS, MED).contract.remaining > 0, '만료+영건(career 3) → 자동연장(remaining>0)');
}

// ── ④ A/B — 선차감 재도입 모사(override.remaining=years−1) → tenure = years−1 < years (가드 이빨) ──
console.log('── ④ A/B: 선차감 재도입 모사 → 재직 −1 (가드 이빨) ──');
{
  const p = mk('ab', 27);
  const years = 3;
  const real: Contract = { salary: 30000, years, remaining: years, signedAtAge: p.age };
  const preFix: Contract = { salary: 30000, years, remaining: years - 1, signedAtAge: p.age }; // 구 동작(최초 선차감) 모사
  const tReal = tenureSeasons(p, real);
  const tPre = tenureSeasons(p, preFix);
  ok(tReal === years, `[real] 발효규칙 → ${years}년 재계약 재직 ${tReal}시즌 (== ${years})`);
  ok(tPre === years - 1 && tPre < tReal, `[A/B] 선차감 모사 → 재직 ${tPre}시즌 (< ${tReal}) — 메트릭이 두 동작을 구별(이빨 존재)`);
}

console.log(fail === 0 ? '\n✅ PASS — 인시즌 재계약 발효 규칙 가드 전항 통과' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
