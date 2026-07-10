// 유망주 등급 라벨 검증 (UI_RULES DL-4 / ② UX 개선) — 누출0·reveal 단조·라벨 분포·결정론·A/B.
import { generateDraftClass } from '../data/draftClass';
import { prospectGrade, prospectGradeLabel, GRADE_LABEL, visibleGrowth, type ProspectGrade } from '../data/prospectGrade';
import type { Player, TrainableStat } from '../types';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

const all: Player[] = [];
for (let season = 1; season <= 400 && all.length < 12000; season++) all.push(...generateDraftClass(season, 40));
all.length = Math.min(all.length, 12000);
const N = all.length;
console.log(`N=${N}`);

// ── 누출 0: 숨은 포텐을 전부 99로 바꿔도 reveal 0 등급 불변(스포일러 금지 핵심) ──
console.log('── 누출 0(reveal 0에서 숨은 포텐 무관) ──');
let leak = 0;
for (const p of all.slice(0, 2000)) {
  const pMax = { ...p, potential: Object.fromEntries(Object.keys(p.potential).map((k) => [k, 99])) as Record<TrainableStat, number> };
  if (prospectGrade(p, 0) !== prospectGrade(pMax, 0)) leak++;
}
ok(leak === 0, `reveal 0: 숨은 포텐 변이(→99) 시 등급 불변 (누출 ${leak}건)`);
// reveal 공개 시엔 공개된 포텐이 반영돼 달라질 수 있어야(스카우터 효과 실재) — 최소 1건
let differsAtReveal = 0;
for (const p of all.slice(0, 2000)) {
  const pMax = { ...p, potential: Object.fromEntries(Object.keys(p.potential).map((k) => [k, 99])) as Record<TrainableStat, number> };
  if (visibleGrowth(p, 1) !== visibleGrowth(pMax, 1)) differsAtReveal++;
}
ok(differsAtReveal > 0, `reveal 1: 공개 포텐 변이 시 상승여지 달라짐(스카우터 효과 실재) — ${differsAtReveal}건`);

// ── reveal 단조: 공개도↑ → develop 비율 단조 증가(상승여지가 보일수록 육성 라벨↑) ──
console.log('── reveal 단조(develop 비율) ──');
const developRate = (r: number) => all.filter((p) => prospectGrade(p, r) === 'develop').length / N * 100;
const d05 = developRate(0.05), d3 = developRate(0.3), d6 = developRate(0.6), d10 = developRate(1);
console.log(`  develop%: reveal0.05=${d05.toFixed(1)} · 0.3=${d3.toFixed(1)} · 0.6=${d6.toFixed(1)} · 1.0=${d10.toFixed(1)}`);
ok(d05 <= d3 + 0.01 && d3 <= d6 + 0.01 && d6 <= d10 + 0.01, 'develop 비율이 reveal에 단조 증가(안개 내장)');
// ready(현재만)는 reveal 무관 일정
const readyRate = (r: number) => all.filter((p) => prospectGrade(p, r) === 'ready').length / N * 100;
ok(Math.abs(readyRate(0.05) - readyRate(1)) < 0.01, 'ready 비율은 reveal 무관(현재 강함은 늘 보임)');

// ── 라벨 분포(N≥10,000) — 한쪽 쏠림 없음(어떤 라벨도 0%도 60%도 아님) ──
console.log('── 라벨 분포(reveal 1.0) ──');
const cnt: Record<ProspectGrade, number> = { ready: 0, develop: 0, project: 0, unknown: 0 };
for (const p of all) cnt[prospectGrade(p, 1)]++;
for (const g of Object.keys(cnt) as ProspectGrade[]) console.log(`  ${GRADE_LABEL[g]}: ${(cnt[g] / N * 100).toFixed(1)}%`);
ok((Object.values(cnt) as number[]).every((c) => c / N >= 0.03 && c / N <= 0.6), '모든 라벨 3%~60%(쏠림 없음)');

// ── 결정론 ──
console.log('── 결정론 ──');
ok(prospectGradeLabel(all[7], 0.6) === prospectGradeLabel(all[7], 0.6), '같은 (선수,reveal) → 동일 라벨');

console.log(fail === 0 ? '\n✅ PASS _dv_prospectgrade' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
