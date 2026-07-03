// 아마추어 성적표 검증 (FA_SYSTEM §3.3, 스카우팅 2.0 1단계) — 역산불가·특급빛남·결정론·스카우터무관 + A/B(노이즈).
// 추정 금지: corr 밴드를 실측해 게이트. 밴드 밖이면 노이즈/인플레 재튜닝.
import { createRng } from '../engine/rng';
import { makeProspect } from '../data/seed';
import { overallRaw } from '../engine/overall';
import { amateurRecord, amateurScore } from '../data/amateurRecord';
import type { Position } from '../types';

const N = 20000;
const POS: Position[] = ['S', 'OH', 'OP', 'MB', 'L'];

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxy / Math.sqrt(sxx * syy);
}

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

const rng = createRng(20260703);
const players = Array.from({ length: N }, (_, i) => makeProspect(rng, `am-${i}`, POS[i % 5]));

const score = players.map((p) => amateurScore(p));
const scoreClean = players.map((p) => amateurScore(p, true));
const cur = players.map((p) => overallRaw(p));
const maxPot = players.map((p) => Math.max(...Object.values(p.potential)));

const cScoreCur = pearson(score, cur);
const cScorePot = pearson(score, maxPot);
const cCleanCur = pearson(scoreClean, cur);
const cCurPot = pearson(cur, maxPot);
const r2 = cScoreCur * cScoreCur;

console.log('── 상관 실측 (N=' + N + ') ──');
console.log(`  corr(성적,현재)=${cScoreCur.toFixed(3)} · corr(성적,포텐)=${cScorePot.toFixed(3)} · R²(성적→현재)=${r2.toFixed(3)}`);
console.log(`  [A/B] 노이즈無 corr(성적,현재)=${cCleanCur.toFixed(3)} · (참고)corr(현재,포텐)=${cCurPot.toFixed(3)}`);

console.log('── 역산 불가 게이트 ──');
ok(cScoreCur >= 0.40 && cScoreCur <= 0.60, `corr(성적,현재) ∈ [0.40,0.60] (목표 ~0.5) — 실측 ${cScoreCur.toFixed(3)}`);
ok(cScorePot <= 0.35, `corr(성적,포텐) ≤ 0.35 (천장 거의 안 샘) — 실측 ${cScorePot.toFixed(3)}`);
ok(r2 < 0.35, `R²(성적→현재) < 0.35 (성적만으로 현재 역산 불가) — 실측 ${r2.toFixed(3)}`);
ok(cCleanCur - cScoreCur >= 0.12, `A/B: 노이즈가 상관 유의 하락(clean ${cCleanCur.toFixed(2)} → noisy ${cScoreCur.toFixed(2)}, Δ≥0.12)`);

console.log('── 특급 빛남 ──');
const idx = [...players.keys()];
const byScore = [...idx].sort((a, b) => score[b] - score[a]);
const curTop10 = new Set([...idx].sort((a, b) => cur[b] - cur[a]).slice(0, Math.floor(N * 0.10)));
const top5 = byScore.slice(0, Math.floor(N * 0.05));
const hit = top5.filter((i) => curTop10.has(i)).length / top5.length;
console.log(`  성적top5% → 실제 현재top10% 적중 ${(hit * 100).toFixed(0)}% (무작위 10%)`);
ok(hit >= 0.30, `특급 빛남: 성적 상위가 실제 현재 상위와 유의 겹침(≥30% ≫ 10%)`);

console.log('── 결정론 · 스카우터 무관 ──');
ok(JSON.stringify(amateurRecord(players[0])) === JSON.stringify(amateurRecord(players[0])), '같은 선수 → 같은 성적표(비트 일치)');
ok(amateurRecord.length === 1, '스카우터·팀 무관: amateurRecord(p)의 필수 인자는 p뿐(reveal/team 인자 없음 — 노이즈 seed=id만)');

console.log('── 육안 샘플(포지션별 1명, 현재OVR·성적표) ──');
for (const pos of POS) {
  const p = players.find((q) => q.position === pos)!;
  const rec = amateurRecord(p);
  const box = rec.stats.map((s) => `${s.label} ${s.value}${s.unit}`).join(' · ');
  console.log(`  [${pos}] 현재OVR ${overallRaw(p).toFixed(0)} · ${rec.leagueLabel} — ${box}`);
}

console.log(fail === 0 ? '\n✅ PASS _dv_amateur' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
