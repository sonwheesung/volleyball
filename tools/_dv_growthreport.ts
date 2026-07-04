// 성장 리포트 셀렉터 검증 (TRAINING §성장리포트, 2026-07-04) — growthReport가 카드 표시값(deriveRatings 정수)
// 변화를 정확히 diff하는지. A/B: 0구간=빈, 시즌구간=성장 검출 · 오라클 자가대조 · 결정론.
//   npx tsx tools/_dv_growthreport.ts
import { resetLeagueBase, LEAGUE, currentRosters, evolveOnDay } from '../data/league';
import { deriveRatings } from '../engine/ratings';
import { growthReport } from '../data/growthReport';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

resetLeagueBase();
const team = LEAGUE.teams[0].id;
const ids = currentRosters()[team] ?? [];

console.log('── 구간 가드 ──');
ok(growthReport(team, 5, 5).length === 0, '0폭 구간(from==to) → 빈 리포트');
ok(growthReport(team, 10, 5).length === 0, '역구간(to<from) → 빈 리포트');
ok(growthReport(team, -1, 20).length === 0, 'from<0 → 빈 리포트(미초기화 방어)');

console.log('── 시즌 성장 검출 ──');
const season = growthReport(team, 0, 160);
ok(season.length > 0, `시즌(0→160) 성장 검출 — 변화 선수 ${season.length}명`);
const totalDeltas = season.reduce((n, p) => n + p.deltas.length, 0);
ok(totalDeltas > 0, `총 스탯 변화 ${totalDeltas}건`);
const anyUp = season.some((p) => p.deltas.some((d) => d.delta > 0));
ok(anyUp, '성장(+) 최소 1건(유망주 성장)');

console.log('── 오라클 자가대조(리포트 delta == deriveRatings 재계산 diff) ──');
const LABELS: Record<string, keyof ReturnType<typeof deriveRatings>> = {
  '스파이크': 'spike', '블로킹': 'block', '디그': 'dig', '리시브': 'receive', '세팅': 'set', '서브': 'serve',
};
let mismatch = 0, checked = 0;
for (const pg of season) {
  const rb = deriveRatings(evolveOnDay(pg.id, 0)!);
  const ra = deriveRatings(evolveOnDay(pg.id, 160)!);
  for (const d of pg.deltas) {
    checked++;
    const k = LABELS[d.label];
    const expect = ra[k] - rb[k];
    if (expect !== d.delta || !Number.isInteger(d.delta)) mismatch++;
  }
}
ok(mismatch === 0, `모든 delta가 deriveRatings 정수 diff와 일치(${checked}건 대조, 불일치 ${mismatch})`);

console.log('── 결정론 ──');
ok(JSON.stringify(growthReport(team, 0, 160)) === JSON.stringify(season), '반복 호출 동일(결정론)');

console.log('── 변화 없는 선수 제외 ──');
ok(season.every((p) => p.deltas.length > 0), 'delta 0인 선수는 리포트에 없음');

console.log('\n── 샘플(앞 6명) ──');
for (const p of season.slice(0, 6)) {
  console.log(`  ${p.name}: ${p.deltas.map((d) => `${d.label} ${d.delta > 0 ? '+' + d.delta : d.delta}`).join(' · ')}`);
}

console.log(fail === 0 ? '\n✅ 성장 리포트 검증 통과' : `\n❌ ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
