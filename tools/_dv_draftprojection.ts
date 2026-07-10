// 예상 지명 순위 검증 (UI_RULES DL-5 / ⑥ UX 개선) — reveal↑=밴드 폭 단조 감소·결정론·A/B.
import { generateDraftClass } from '../data/draftClass';
import { consensusOrder, projectionBand, bandHalfWidth, pickTimingBadge } from '../data/draftProjection';
import type { Player } from '../types';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

const cls: Player[] = generateDraftClass(3, 40);
const size = cls.length;

// ── reveal↑ = 밴드 폭 단조 감소(안개) ──
console.log('── 밴드 폭 reveal 단조 감소 ──');
const REVEALS = [0.05, 0.3, 0.5, 0.7, 0.92, 1];
let mono = true;
for (let rank = 0; rank < size; rank++) {
  let prev = Infinity;
  for (const r of REVEALS) {
    const w = projectionBand(rank, size, r).width;
    if (w > prev) mono = false; // reveal↑인데 폭이 커지면 위반
    prev = w;
  }
}
ok(mono, '모든 rank에서 reveal↑일수록 밴드 폭 단조 감소(또는 동일)');
console.log(`  bandHalfWidth: 0.05=${bandHalfWidth(0.05)} 0.3=${bandHalfWidth(0.3)} 0.5=${bandHalfWidth(0.5)} 0.7=${bandHalfWidth(0.7)} 0.92=${bandHalfWidth(0.92)}`);
ok(bandHalfWidth(0.05) >= bandHalfWidth(0.3) && bandHalfWidth(0.3) >= bandHalfWidth(0.5) && bandHalfWidth(0.5) >= bandHalfWidth(0.7) && bandHalfWidth(0.7) >= bandHalfWidth(0.92), 'bandHalfWidth 단조 감소');

// ── 텍스트 분포(정밀 reveal=1) — 상위=좁은 순위, 후순위=라운드 밴드 ──
console.log('── 밴드 텍스트 예시(reveal 1.0) ──');
const rank = consensusOrder(cls, 1);
const sortedIds = [...rank.entries()].sort((a, b) => a[1] - b[1]).map((e) => e[0]);
for (const idx of [0, 3, 8, 15, 22, 30]) {
  const id = sortedIds[idx]; if (!id) continue;
  console.log(`  rank ${idx}: "${projectionBand(idx, size, 1).text}"`);
}
ok(projectionBand(0, size, 1).text === '예상 1~3순위', 'rank0(reveal1) = 예상 1~3순위');
ok(projectionBand(0, size, 0.05).text === '순위 불명', 'rank0(reveal0.05) = 순위 불명(안개)');

// ── 괴리 배지 ──
console.log('── 예상↔실제 괴리 배지 ──');
const band10 = projectionBand(10, size, 1); // reveal1, hw=1 → [9,11]
ok(pickTimingBadge(5, band10) === '이른', 'rank10 예상인데 5번째 지명 → 이른');
ok(pickTimingBadge(20, band10) === '늦은', 'rank10 예상인데 20번째 지명 → 늦은');
ok(pickTimingBadge(10, band10) === null, '예상 범위 내 → 배지 없음');
ok(pickTimingBadge(5, projectionBand(10, size, 0.05)) === null, '순위 불명이면 괴리 판정 안 함');

// ── A/B: 컨센서스 정렬이 가치 기반(무작위 아님) — 상위 rank가 하위보다 가치 큼 ──
console.log('── A/B(정렬이 가치 기반) ──');
import('../data/draftAI').then(({ aiProspectValue }) => {
  const top = aiProspectValue(cls.find((p) => rank.get(p.id) === 0)!, 1);
  const bot = aiProspectValue(cls.find((p) => rank.get(p.id) === size - 1)!, 1);
  ok(top > bot, `rank0 가치(${top.toFixed(1)}) > rank마지막 가치(${bot.toFixed(1)})`);

  // ── 결정론 ──
  console.log('── 결정론 ──');
  const a = consensusOrder(cls, 0.6), b = consensusOrder(cls, 0.6);
  ok([...a.entries()].every(([k, v]) => b.get(k) === v), '같은 (클래스,reveal) → 동일 순위');

  console.log(fail === 0 ? '\n✅ PASS _dv_draftprojection' : `\n❌ FAIL ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
});
