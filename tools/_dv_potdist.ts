// 현재↔포텐 분포 측정 (FA_SYSTEM §3.3 2단계) — corr(현재,maxPot) + 극단 이상치(대기만성/반짝) %.
// 목표: corr 0.62~0.66 · 대기만성(현재 하위25% & 포텐 상위25%) ~4% · 반짝(현재 상위25% & 포텐 하위25%) ~4%.
import { createRng } from '../engine/rng';
import { makeProspect } from '../data/seed';
import { overallRaw } from '../engine/overall';
import type { Position } from '../types';

const N = 20000;
const POS: Position[] = ['S', 'OH', 'OP', 'MB', 'L'];

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length; const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxy / Math.sqrt(sxx * syy);
}
const quantile = (sorted: number[], q: number): number => sorted[Math.floor(sorted.length * q)];

const rng = createRng(20260703);
const ps = Array.from({ length: N }, (_, i) => makeProspect(rng, `pd-${i}`, POS[i % 5]));
const cur = ps.map((p) => overallRaw(p));
// 포텐 = "미래 OVR"(전 스탯이 천장일 때의 OVR) — maxPot(단일 스탯 max)보다 의미 있는 천장 신호.
const pot = ps.map((p) => overallRaw({ ...p, ...p.potential }));

const corr = pearson(cur, pot);
const curSorted = [...cur].sort((a, b) => a - b);
const potSorted = [...pot].sort((a, b) => a - b);
const gap = ps.map((_, i) => pot[i] - cur[i]); // 성장폭(미래OVR − 현재OVR)
const gapSorted = [...gap].sort((a, b) => a - b);
const curP40 = quantile(curSorted, 0.40), curP60 = quantile(curSorted, 0.60);
const potP40 = quantile(potSorted, 0.40), potP60 = quantile(potSorted, 0.60);

// 이상치 = "놀라움" 사분면: 대기만성=저현재(하위40%)·고미래(상위40%)=숨은 보석 · 반짝=고현재(상위40%)·저미래(하위40%)=bust
let lateBloomer = 0, flash = 0;
for (let i = 0; i < N; i++) {
  if (cur[i] <= curP40 && pot[i] >= potP60) lateBloomer++;
  if (cur[i] >= curP60 && pot[i] <= potP40) flash++;
}
const lbPct = (lateBloomer / N) * 100, flPct = (flash / N) * 100;

console.log(`corr(현재,미래OVR) = ${corr.toFixed(3)}   (목표 0.62~0.66)`);
console.log(`현재 min/med/max = ${curSorted[0].toFixed(1)} / ${quantile(curSorted, 0.5).toFixed(1)} / ${curSorted[N - 1].toFixed(1)}`);
console.log(`미래OVR min/med/max = ${potSorted[0].toFixed(0)} / ${quantile(potSorted, 0.5).toFixed(0)} / ${potSorted[N - 1].toFixed(0)}`);
console.log(`성장폭 min/med/max = ${gapSorted[0].toFixed(0)} / ${quantile(gapSorted, 0.5).toFixed(0)} / ${gapSorted[N - 1].toFixed(0)}`);
console.log(`대기만성(저현재·고미래) = ${lbPct.toFixed(1)}%   반짝(고현재·저미래) = ${flPct.toFixed(1)}%   (놀라움 사분면)`);

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
ok(corr >= 0.45 && corr <= 0.62, `corr ∈ [0.45,0.62] (대체로 비례·역산 불가) — 실측 ${corr.toFixed(3)}`);
ok(lbPct >= 2.5, `대기만성(숨은 보석) 존재 ≥2.5% — 실측 ${lbPct.toFixed(1)}%`);
ok(flPct >= 2.5, `반짝(bust) 존재 ≥2.5% — 실측 ${flPct.toFixed(1)}%`);
console.log(fail === 0 ? '\n✅ PASS _dv_potdist' : `\n(측정 — 튜닝 대상 ${fail}건)`);
process.exit(fail === 0 ? 0 : 1);
