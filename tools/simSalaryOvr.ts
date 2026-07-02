// 연봉 ↔ OVR 정합 측정 — 표시 OVR과 연봉(서명 시점 고착)의 상관·역전·루키캡 절벽을 대표본으로.
//   npx tsx tools/simSalaryOvr.ts [리시드=200]
import { LEAGUE, reseedLeague, getEvolvedTeamPlayers } from '../data/league';
import { overall, overallRaw, displayOvr } from '../engine/overall';
import { marketValue } from '../engine/salary';
import { MED_REF } from '../engine/overall'; // 보정 측정은 시대 0 기준
import type { Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
const K = Math.max(1, Number(process.argv[2]) || 200);

interface Row { disp: number; raw: number; salary: number; market: number; age: number; signedAtAge: number; }
const rows: Row[] = [];

for (let k = 0; k < K; k++) {
  reseedLeague(3000 + k * 11, 777);
  for (const t of LEAGUE.teams) {
    for (const p of getEvolvedTeamPlayers(t.id, 0) as Player[]) {
      rows.push({
        disp: displayOvr(overallRaw(p)),
        raw: overall(p),
        salary: p.contract.salary,
        market: marketValue(p, MED_REF),
        age: p.age,
        signedAtAge: p.contract.signedAtAge,
      });
    }
  }
}

function corr(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxy / Math.sqrt(sxx * syy);
}
const f100 = (won: number) => (won / 10000).toFixed(2) + '억';

const sal = rows.map((r) => r.salary);
log(`\n═══ 연봉 ↔ OVR 정합 — 리시드 ${K} (선수 ${rows.length.toLocaleString()}) ═══\n`);
log(`▸ 상관`);
log(`  r(표시 OVR, 연봉)   = ${corr(rows.map((r) => r.disp), sal).toFixed(3)}`);
log(`  r(시장가치, 연봉)    = ${corr(rows.map((r) => r.market), sal).toFixed(3)}  (시장가치는 현재 능력+나이)`);
log(`  r(표시 OVR, 시장가치) = ${corr(rows.map((r) => r.disp), rows.map((r) => r.market)).toFixed(3)}`);

// 역전: 비슷한 표시 OVR(±2)인데 연봉이 2배 이상 차이
let invPairs = 0, sampled = 0;
const sorted = [...rows].sort((a, b) => a.disp - b.disp);
for (let i = 0; i < sorted.length - 1; i += 97) { // 듬성듬성 표본
  for (let j = i + 1; j < Math.min(i + 40, sorted.length); j++) {
    if (Math.abs(sorted[i].disp - sorted[j].disp) <= 2) {
      sampled++;
      const hi = Math.max(sorted[i].salary, sorted[j].salary), lo = Math.max(1, Math.min(sorted[i].salary, sorted[j].salary));
      if (hi / lo >= 2) invPairs++;
    }
  }
}
log(`\n▸ 같은 표시 OVR(±2) 쌍 중 연봉 2배+ 차이: ${(invPairs / Math.max(1, sampled) * 100).toFixed(1)}% (표본 ${sampled})`);

// 루키캡 절벽: 22세 서명 vs 23세 서명 연봉
const signed22 = rows.filter((r) => r.signedAtAge <= 22).map((r) => r.salary);
const signed23 = rows.filter((r) => r.signedAtAge >= 23).map((r) => r.salary);
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
log(`\n▸ 루키캡 절벽`);
log(`  signedAtAge ≤22 평균 연봉: ${f100(mean(signed22))} (n=${signed22.length})`);
log(`  signedAtAge ≥23 평균 연봉: ${f100(mean(signed23))} (n=${signed23.length})`);

// 사용자 사례: 어린(≤24) 저OVR(<60) 고연봉(>1.2억) 빈도
const weird = rows.filter((r) => r.age <= 24 && r.disp < 60 && r.salary > 12000);
log(`\n▸ 어린(≤24)·저표시OVR(<60)·고연봉(>1.2억): ${weird.length}명 (${(weird.length / rows.length * 100).toFixed(1)}%)`);
log('');
