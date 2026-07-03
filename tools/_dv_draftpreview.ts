// 드래프트 클래스 프리뷰 검증 (FA §3.3 4단계) — 스포일러 금지·결정론·성적 기반 민감도.
import { createRng } from '../engine/rng';
import { makeProspect } from '../data/seed';
import { draftClassPreview } from '../data/draftPreview';
import type { Position, TrainableStat } from '../types';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
const rng = createRng(20260703);
const POS: Position[] = ['S', 'OH', 'OP', 'MB', 'L'];
const cls = Array.from({ length: 24 }, (_, i) => makeProspect(rng, `dp-${i}`, POS[i % 5]));

console.log('── 하드룰① 스포일러 금지: reveal 0이면 숨은 포텐과 무관 ──');
const clsMax = cls.map((p) => ({ ...p, potential: Object.fromEntries(Object.keys(p.potential).map((k) => [k, 99])) as Record<TrainableStat, number> }));
ok(JSON.stringify(draftClassPreview(cls, 0)) === JSON.stringify(draftClassPreview(clsMax, 0)), 'reveal 0: 숨은 포텐 바꿔도 프리뷰 불변(누출 0)');

console.log('── 결정론 · 구조 ──');
ok(JSON.stringify(draftClassPreview(cls, 0.5)) === JSON.stringify(draftClassPreview(cls, 0.5)), '같은 (클래스,reveal) → 동일');
const pv = draftClassPreview(cls, 0.5);
ok(typeof pv.headline === 'string' && pv.headline.length > 0, '헤드라인 존재');
ok(pv.notes.length >= 1 && pv.notes.some((n) => n.includes('최대어')), '최대어 노트 포함');
ok(draftClassPreview([], 0.5).notes.length === 0, '빈 클래스 → 노트 0(무예외)');

console.log('── 민감도: 강한 클래스 vs 약한 클래스 헤드라인 다름 ──');
// 전원 고능력(강) vs 전원 저능력(약)로 성적 인상 갈림 → 깊이 헤드라인 달라야.
const strongCls = Array.from({ length: 24 }, (_, i) => {
  const p = makeProspect(rng, `dps-${i}`, POS[i % 5]);
  return { ...p, skSpike: 70, skBlock: 70, skDig: 70, skReceive: 70, skSet: 70, skServe: 70, jump: 75, reaction: 70, positioning: 70 };
});
const weakCls = Array.from({ length: 24 }, (_, i) => {
  const p = makeProspect(rng, `dpw-${i}`, POS[i % 5]);
  return { ...p, skSpike: 30, skBlock: 30, skDig: 30, skReceive: 30, skSet: 30, skServe: 30, jump: 35, reaction: 35, positioning: 35 };
});
const hStrong = draftClassPreview(strongCls, 0.5).headline;
const hWeak = draftClassPreview(weakCls, 0.5).headline;
console.log(`  강="${hStrong}" · 약="${hWeak}"`);
ok(hStrong !== hWeak, '성적 강/약 클래스 헤드라인 갈림(도구 둔감 아님)');

console.log(fail === 0 ? '\n✅ PASS _dv_draftpreview' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
