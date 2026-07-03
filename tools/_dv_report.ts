// 스카우트 리포트 검증 (FA §3.3 4단계) — 두 하드룰(스포일러/날조 금지)·결정론·A/B 민감도.
import { createRng } from '../engine/rng';
import { makeProspect } from '../data/seed';
import { prospectReport } from '../data/prospectReport';
import { revealedPotential } from '../data/prospectScout';
import type { Position, TrainableStat } from '../types';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
const rng = createRng(20260703);
const POS: Position[] = ['S', 'OH', 'OP', 'MB', 'L'];
const N = 20000;
const ps = Array.from({ length: N }, (_, i) => makeProspect(rng, `rp-${i}`, POS[i % 5]));

console.log('── 하드룰① 스포일러 금지: 숨은 포텐은 리포트에 안 샘 ──');
// 미공개 상태(reveal 0)에서 숨은 포텐을 전부 99로 바꿔도 리포트 불변(천장 안 흘림).
let leak = 0;
for (const p of ps.slice(0, 4000)) {
  const pMax = { ...p, potential: Object.fromEntries(Object.keys(p.potential).map((k) => [k, 99])) as Record<TrainableStat, number> };
  if (JSON.stringify(prospectReport(p, 0)) !== JSON.stringify(prospectReport(pMax, 0))) leak++;
}
ok(leak === 0, `reveal 0: 숨은 포텐 변경이 리포트에 누출 0 (실측 누출 ${leak})`);
// reveal 0이면 잠재력 문장은 항상 "안갯속"(포텐 주장 없음).
ok(ps.slice(0, 500).every((p) => prospectReport(p, 0).some((l) => l.includes('안갯속'))), 'reveal 0: 잠재력=안갯속(포텐 주장 안 함)');

console.log('── 하드룰① 공개분만 근거: 성장 여지 문장의 항목 ⊆ 공개된 포텐 ──');
let overclaim = 0;
for (const p of ps.slice(0, 4000)) {
  const revLabels = new Set(revealedPotential(p, 0.92).map((r) => r.label));
  const growLine = prospectReport(p, 0.92).find((l) => l.startsWith('스카우트 평:') && l.includes('성장 여지'));
  if (growLine) {
    const claimed = growLine.replace('스카우트 평:', '').replace('쪽 성장 여지가 크다.', '').trim().split('·');
    if (!claimed.every((c) => revLabels.has(c))) overclaim++;
  }
}
ok(overclaim === 0, `성장 여지 주장은 공개된 포텐 항목만 (초과주장 ${overclaim})`);

console.log('── 하드룰② 날조 금지: 데이터 없는 성격/배경 단어 미출현 ──');
const BANNED = ['성실', '노력파', '근성', '리더십', '멘탈이 강', '인성', '착실', '헌신', '이타적'];
let fab = 0;
for (const p of ps.slice(0, 4000)) {
  const txt = prospectReport(p, 0.92).join(' ');
  if (BANNED.some((b) => txt.includes(b))) fab++;
}
ok(fab === 0, `성격/배경 날조 단어 미출현 (위반 ${fab})`);

console.log('── reveal↑ → 잠재력 문장이 안갯속에서 벗어남 ──');
const foggyRate = (r: number) => ps.slice(0, 2000).filter((p) => prospectReport(p, r).some((l) => l.includes('안갯속'))).length / 2000;
console.log(`  안갯속 비율: reveal0=${foggyRate(0).toFixed(2)} · 0.5=${foggyRate(0.5).toFixed(2)} · 0.92=${foggyRate(0.92).toFixed(2)}`);
ok(foggyRate(0) === 1 && foggyRate(0.92) < 0.2, 'reveal↑ → 안갯속 감소(스카우터가 천장 밝힘)');

console.log('── A/B 민감도(도구 둔감 아님) + 결정론 ──');
// 성적 좋은 선수 vs 나쁜 선수 → 전반 인상 문장 다름.
const hi = ps.map((p) => ({ p, s: prospectReport(p, 0.5)[0] }));
const distinctOpeners = new Set(hi.map((x) => x.s)).size;
ok(distinctOpeners >= 3, `전반 인상 문장이 성적 따라 갈림(고유 ${distinctOpeners}종)`);
ok(JSON.stringify(prospectReport(ps[7], 0.6)) === JSON.stringify(prospectReport(ps[7], 0.6)), '같은 (선수,reveal) → 동일(결정론)');

console.log(fail === 0 ? '\n✅ PASS _dv_report' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
