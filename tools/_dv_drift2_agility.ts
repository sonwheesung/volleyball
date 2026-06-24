// 드리프트 2차 — agility 노쇠 여부 실측 (문서 TRAINING_SYSTEM §1.6 표 vs engine/aging.ts).
// 문서 §1.6 표(line 195~196)는 민첩(agility)을 "유지/상승(경험)…노쇠 없음" 그룹에 둔다.
// 그러나 engine/aging.ts:15 DECAY_STATS = [jump, agility, staminaMax, staminaRegen] — agility 포함.
// CLAUDE.md 5.1("민첩성 — 노쇠 시 하락")·aging.ts 주석은 agility를 하락 신체스탯으로 본다.
// → §1.6 표가 내부 모순(드리프트). 본 도구가 실측으로 확정.
//   npx tsx tools/_dv_drift2_agility.ts
// A/B 대조군: 비-신체(reaction·positioning)는 Δ0 이어야(노쇠 대상 아님) → 도구가 하락/비하락 구분 입증.

import { applyAgingDay, DECAY_STATS } from '../engine/aging';
import { createRng } from '../engine/rng';
import type { Player } from '../types';

function mk(age: number): Player {
  return {
    id: 'x', name: 'T', age, position: 'OH', isForeign: false,
    height: 180, jump: 80, agility: 80, staminaMax: 80, staminaRegen: 80,
    reaction: 70, positioning: 70, focus: 70, consistency: 70, vq: 70,
    skSpike: 70, skBlock: 70, skDig: 70, skReceive: 70, skSet: 50, skServe: 70,
    peakAge: 27, xp: {}, potential: {} as any, talentBase: 1, catTalent: { physical: 1, skill: 1, mental: 1 },
    traits: [], career: { seasons: 10, matches: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, assists: 0 },
    contract: { salary: 10000, years: 2, remaining: 2, signedAtAge: age, signedSeason: 0 },
    clubTenure: 5,
  } as any;
}

let p = mk(35);
const rng = createRng(12345);
const jump0 = p.jump, agi0 = p.agility, react0 = p.reaction, pos0 = p.positioning;
for (let s = 0; s < 3; s++) {
  for (let d = 0; d < 164; d++) p = applyAgingDay(p, rng);
  p = { ...p, age: p.age + 1 };
}
console.log(`35→38세 3시즌(164일×3) 노쇠 후:`);
console.log(`  jump        ${jump0} → ${p.jump}  (Δ${p.jump - jump0})  ← 하락 신체스탯(기대)`);
console.log(`  agility     ${agi0} → ${p.agility}  (Δ${p.agility - agi0})  ← 문서 §1.6 표: "노쇠 없음" 주장 ⚠`);
console.log(`  reaction    ${react0} → ${p.reaction}  (Δ${p.reaction - react0})  ← A/B 대조군(비신체, Δ0 기대)`);
console.log(`  positioning ${pos0} → ${p.positioning}  (Δ${p.positioning - pos0})  ← A/B 대조군(비신체, Δ0 기대)`);
const drift = p.agility < agi0;
console.log(`\n${drift ? '⚠ 드리프트 확인' : '일치'}: agility Δ=${p.agility - agi0} ${drift ? '< 0 → code는 노쇠시킴 = 문서 §1.6 표 틀림(CLAUDE.md 5.1·code가 정본)' : ''}`);
console.log(`A/B 자가검증: reaction/positioning Δ0 = 도구가 하락/비하락 정확 구분`);

// ── 상수 멤버십 가드(사각 닫기): 문서 표가 손으로 나열하는 노쇠 그룹을 코드 상수에서 직접 읽어 대조 ──
// 정본 = engine/aging.ts DECAY_STATS. 문서 표(§1.6·STAFF §1)는 이 집합과 1:1이어야 한다.
const CANON = new Set<string>(DECAY_STATS as unknown as string[]);
const memberOk = CANON.has('agility');                              // 민첩 ∈ 노쇠 그룹(정본)
const measuredDecays = ['jump', 'agility', 'staminaMax', 'staminaRegen'];
const measuredKeeps = ['reaction', 'positioning'];
// 실측: 노쇠 그룹은 전부 하락(Δ<0), 비노쇠 대조군은 불변(Δ0)
const reMk = (age: number) => { let q = mk(age); const r = createRng(777); for (let s = 0; s < 3; s++) { for (let d = 0; d < 164; d++) q = applyAgingDay(q, r); q = { ...q, age: q.age + 1 }; } return q; };
const aged = reMk(35);
const base = mk(35) as any;
const decayMeasured = measuredDecays.every((s) => (aged as any)[s] < base[s]);
const keepMeasured = measuredKeeps.every((s) => (aged as any)[s] === base[s]);
// 멤버십 정합: 실측 하락 집합 == DECAY_STATS 집합
const membershipMatch = measuredDecays.every((s) => CANON.has(s)) && CANON.size === measuredDecays.length;
const ab = memberOk && decayMeasured && keepMeasured && membershipMatch;
console.log(`\n=== 상수 멤버십 가드(문서 enum ↔ DECAY_STATS) ===`);
console.log(`  DECAY_STATS = [${[...CANON].join(', ')}]`);
console.log(`  민첩∈노쇠그룹=${memberOk} · 노쇠4종 실측하락=${decayMeasured} · 대조군(반응·위치) 불변=${keepMeasured} · 집합일치=${membershipMatch}`);
const pass = drift && ab;
console.log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'} (drift실측=${drift} · 멤버십/AB=${ab})`);
if (!pass) process.exit(1);
