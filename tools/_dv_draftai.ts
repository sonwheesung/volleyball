// AI 드래프트 평가 검증 (FA §3.3 3b-value) — 전지적 maxPot 제거·단조·특급률·**포텐 누출 없음**.
import { createRng } from '../engine/rng';
import { makeProspect } from '../data/seed';
import { aiProspectValue, AI_SUPER_PV } from '../data/draftAI';
import { potentialEstimate } from '../data/prospectScout';
import type { Position, TrainableStat } from '../types';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
const rng = createRng(20260703);
const POS: Position[] = ['S', 'OH', 'OP', 'MB', 'L'];
const N = 20000;
const ps = Array.from({ length: N }, (_, i) => makeProspect(rng, `da-${i}`, POS[i % 5]));

console.log('── 포텐 누출 없음: reveal 0이면 숨은 포텐과 무관(공정성 핵심) ──');
// 같은 선수의 potential만 전부 99로 바꿔도 reveal 0에서 추정/가치 불변(천장 안 흘림)
const p = ps[1];
const pMaxPot = { ...p, potential: Object.fromEntries(Object.keys(p.potential).map((k) => [k, 99])) as Record<TrainableStat, number> };
ok(potentialEstimate(p, 0) === potentialEstimate(pMaxPot, 0), 'reveal 0: potentialEstimate가 숨은 포텐 무관(누출 0)');
ok(aiProspectValue(p, 0) === aiProspectValue(pMaxPot, 0), 'reveal 0: aiProspectValue가 숨은 포텐 무관(누출 0)');
ok(potentialEstimate(p, 0.92) !== potentialEstimate(pMaxPot, 0.92), 'reveal 0.92: 포텐 공개되면 값 달라짐(스카우터 효과 실재)');

console.log('── reveal 단조(스카우터 좋을수록 천장 더 봄) ──');
const mean = (r: number) => ps.reduce((s, q) => s + aiProspectValue(q, r), 0) / N;
const m0 = mean(0.05), m5 = mean(0.5), m9 = mean(0.92);
console.log(`  평균 가치: reveal0.05=${m0.toFixed(1)} · 0.5=${m5.toFixed(1)} · 0.92=${m9.toFixed(1)}`);
ok(m0 < m5 && m5 < m9, '평균 가치 reveal에 단조 증가');

console.log('── 특급률(최고 스카우터 ≈ 옛 12%) ──');
const superRate = (r: number) => ps.filter((q) => aiProspectValue(q, r) >= AI_SUPER_PV).length / N * 100;
console.log(`  특급률: reveal0.05=${superRate(0.05).toFixed(1)}% · 0.5=${superRate(0.5).toFixed(1)}% · 0.92=${superRate(0.92).toFixed(1)}%`);
ok(superRate(0.92) >= 8 && superRate(0.92) <= 14, `최고 reveal 특급률 8~14%(옛 12% 근접) — 실측 ${superRate(0.92).toFixed(1)}%`);
ok(superRate(0.05) < superRate(0.92), '스카우터 약하면 특급 덜 발견(전지적 아님)');

console.log('── 결정론 ──');
ok(aiProspectValue(p, 0.6) === aiProspectValue(p, 0.6), '같은 (선수,reveal) → 동일');

console.log(fail === 0 ? '\n✅ PASS _dv_draftai' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
