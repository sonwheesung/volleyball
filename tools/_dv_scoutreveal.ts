// 스카우터 부분 포텐 공개 검증 (FA §3.3 3단계) — 개수·정밀도·상한(≤50%)·포지션우선·결정론·스카우터의존.
import { createRng } from '../engine/rng';
import { makeProspect } from '../data/seed';
import { revealedPotential, revealedCount, revealedPotentialAvg } from '../data/prospectScout';
import type { Position } from '../types';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
const rng = createRng(20260703);
const POS: Position[] = ['S', 'OH', 'OP', 'MB', 'L'];
const ps = POS.map((pos, i) => makeProspect(rng, `sr-${i}`, pos));

console.log('── 개수 = reveal 함수 (0.2미만=0 · 최고=≤3=50% · 단조) ──');
ok(revealedCount('MB', 0.0) === 0 && revealedCount('MB', 0.15) === 0, 'reveal<0.2 → 0개(스카우터 없음/약함)');
ok(revealedCount('MB', 0.92) === 3, '최고 스카우터 → 3개(윗단 6중 50% 상한)');
ok(revealedCount('MB', 0.92) <= 3 && revealedCount('OH', 1) <= 3, '전 구간 ≤3(절반은 늘 은닉)');
ok(revealedCount('L', 0.92) === 2, '리베로는 핵심 2개뿐 → 최대 2(포지션 키수 상한)');
const mono = revealedCount('OH', 0.3) <= revealedCount('OH', 0.6) && revealedCount('OH', 0.6) <= revealedCount('OH', 0.92);
ok(mono, 'reveal↑ → 공개 개수 단조 증가');

console.log('── 포지션 핵심 우선 공개 ──');
const mb = ps.find((p) => p.position === 'MB')!;
const mbRev = revealedPotential(mb, 0.5); // 2개
ok(mbRev.length === 2 && mbRev[0].key === 'block' && mbRev[1].key === 'spike', 'MB reveal0.5 → 블로킹·공격(핵심순)');
const l = ps.find((p) => p.position === 'L')!;
ok(revealedPotential(l, 0.92).every((r) => r.key === 'dig' || r.key === 'receive'), '리베로 → 디그·리시브만');

console.log('── 정밀도(범위→등급↑ 축소→최상급 정확) ──');
const oh = ps.find((p) => p.position === 'OH')!;
const rLow = revealedPotential(oh, 0.4)[0];
const rHigh = revealedPotential(oh, 0.92)[0];
const width = (t: string) => (t.includes('~') ? Number(t.split('~')[1]) - Number(t.split('~')[0]) : 0);
ok(!rLow.exact && width(rLow.text) > 0, '낮은 등급 → 범위 표시');
ok(rHigh.exact && !rHigh.text.includes('~'), '최상급(≥0.92) → 정확치');
ok(width(revealedPotential(oh, 0.4)[0].text) > width(revealedPotential(oh, 0.7)[0].text), '등급↑ → 범위 축소');

console.log('── 결정론 · 스카우터 의존 · AI 평균 ──');
ok(JSON.stringify(revealedPotential(mb, 0.6)) === JSON.stringify(revealedPotential(mb, 0.6)), '같은 (선수,reveal) → 동일(결정론)');
ok(revealedPotentialAvg(mb, 0.1) === null, 'reveal 약하면 avg=null(천장 못 봄)');
ok(typeof revealedPotentialAvg(mb, 0.92) === 'number', '최고 스카우터면 avg=숫자(AI 부분포텐 입력)');
// 공개된 값은 실제 미래 rating과 일치(정확 등급)
ok(revealedPotential(mb, 0.95)[0].value >= 0 && revealedPotential(mb, 0.95)[0].value <= 99, '공개 포텐값 0~99 범위');

console.log(fail === 0 ? '\n✅ PASS _dv_scoutreveal' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
