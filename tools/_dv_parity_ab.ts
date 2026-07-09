// Phase3 parity A/B 매칭쌍 비교(2026-07-10) — simLeague 출력 2개(BEFORE=HEAD, AFTER=Phase3)를 파싱해
// 유니버스별 지표(같은 시드=매칭쌍)의 diff와 요약 대조를 낸다. 부익부(topShare·teamsWon·dynasty·persistR) 초점.
//   npx tsx tools/_dv_parity_ab.ts <before.txt> <after.txt>
import { readFileSync } from 'fs';

interface Row { u: number; parityStd: number; dynasty: number; won: number; N: number; top: number; r: number; }
// 라인 예: "u  0: parityStd 6.1  dynasty 11  won 5/8  top 32%  r 0.20  반등O"
function parse(path: string): Row[] {
  const rows: Row[] = [];
  for (const ln of readFileSync(path, 'utf8').split('\n')) {
    const m = ln.match(/u\s*(\d+):\s*parityStd\s*([\d.]+)\s+dynasty\s*(\d+)\s+won\s*(\d+)\/(\d+)\s+top\s*(\d+)%\s+r\s*(-?[\d.]+)/);
    if (m) rows.push({ u: +m[1], parityStd: +m[2], dynasty: +m[3], won: +m[4], N: +m[5], top: +m[6], r: +m[7] });
  }
  return rows;
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
// 매칭쌍 t(df=n-1): d=after-before per universe
function pairedT(before: number[], after: number[]) {
  const d = after.map((x, i) => x - before[i]);
  const md = mean(d), sdd = sd(d), n = d.length;
  return { md, t: md / (sdd / Math.sqrt(n)), n, df: n - 1 };
}

const [bPath, aPath] = process.argv.slice(2);
const B = parse(bPath), A = parse(aPath);
console.log(`BEFORE ${B.length}유니버스, AFTER ${A.length}유니버스`);
if (B.length !== A.length || B.length === 0) { console.log('❌ 유니버스 수 불일치/0 — 매칭 불가'); process.exit(1); }

// 임계 t(양측 α.05) — df별 정확값 사용(소표본 과대플래그 방지). df=11→2.201, df=23→2.069.
function critT(df: number): number {
  const tbl: Record<number, number> = { 5: 2.571, 8: 2.306, 10: 2.228, 11: 2.201, 12: 2.179, 15: 2.131, 19: 2.093, 20: 2.086, 23: 2.069, 24: 2.064, 29: 2.045, 30: 2.042, 40: 2.021, 60: 2.000 };
  const ks = Object.keys(tbl).map(Number).sort((a, b) => a - b);
  for (const k of ks) if (df <= k) return tbl[k];
  return 1.96;
}
const CRIT = critT(B.length - 1);
console.log(`(임계 t df=${B.length - 1}: ${CRIT})`);
const keys: Array<[string, keyof Row, 'up-bad' | 'down-bad']> = [
  ['parityStd(↑=불균형)', 'parityStd', 'up-bad'],
  ['dynasty(↑=왕조고착)', 'dynasty', 'up-bad'],
  ['topShare%(↑=부익부)', 'top', 'up-bad'],
  ['teamsWon(↓=과점)', 'won', 'down-bad'],
  ['persistR(↑=서열고착)', 'r', 'up-bad'],
];
console.log('\n지표'.padEnd(24) + 'BEFORE'.padEnd(16) + 'AFTER'.padEnd(16) + 'Δ(평균)'.padEnd(12) + 't(df' + (B.length - 1) + ')'.padEnd(6) + '  판정');
let regress = 0;
for (const [label, k, dir] of keys) {
  const b = B.map((r) => r[k]), a = A.map((r) => r[k]);
  const { md, t } = pairedT(b, a);
  const bad = Math.abs(t) >= CRIT && ((dir === 'up-bad' && md > 0) || (dir === 'down-bad' && md < 0));
  if (bad) regress++;
  const verdict = Math.abs(t) < CRIT ? '비유의(OK)' : bad ? '⚠악화' : '유의개선';
  console.log(
    label.padEnd(22) +
    `${mean(b).toFixed(2)}±${sd(b).toFixed(2)}`.padEnd(16) +
    `${mean(a).toFixed(2)}±${sd(a).toFixed(2)}`.padEnd(16) +
    `${md >= 0 ? '+' : ''}${md.toFixed(2)}`.padEnd(12) +
    `${t >= 0 ? '+' : ''}${t.toFixed(2)}`.padEnd(8) + '  ' + verdict,
  );
}
// 전팀우승 유니버스 비율(부익부 핵심) — N은 출력에서 읽음(팀 수 가정 금지)
const allWonB = B.filter((r) => r.won >= r.N).length / B.length * 100;
const allWonA = A.filter((r) => r.won >= r.N).length / A.length * 100;
console.log(`\n전팀우승 유니버스(won≥N=${A[0]?.N}): BEFORE ${allWonB.toFixed(0)}% → AFTER ${allWonA.toFixed(0)}%  (↓면 과점 심화)`);

console.log(regress === 0
  ? '\n✅ 비회귀 — 부익부/왕조 지표 유의미 악화 0건 (임계 t=' + CRIT + ')'
  : `\n❌ ${regress}개 지표 유의미 악화 — Phase3 재검토 필요`);
process.exit(regress === 0 ? 0 : 1);
