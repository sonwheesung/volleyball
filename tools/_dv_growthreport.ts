// 성장 리포트 셀렉터 검증 (TRAINING §성장리포트, 2026-07-04) — growthReport가 15종 원본 스탯(선수 상세 표시값)
// 변화를 정확히 diff하는지 + 빈도 측정(모든 스탯이라 매 구간 충분히 뜨는지). A/B·오라클·결정론.
//   npx tsx tools/_dv_growthreport.ts
import { resetLeagueBase, LEAGUE, currentRosters, evolveOnDay, getPlayer } from '../data/league';
import { growthReport } from '../data/growthReport';
import { growthOutlook } from '../data/growthOutlook';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

resetLeagueBase();
const team = LEAGUE.teams[0].id;

console.log('── 구간 가드 ──');
ok(growthReport(team, 5, 5).length === 0, '0폭 구간(from==to) → 빈 리포트');
ok(growthReport(team, 10, 5).length === 0, '역구간(to<from) → 빈 리포트');
ok(growthReport(team, -1, 20).length === 0, 'from<0 → 빈 리포트(미초기화 방어)');

console.log('── 시즌 성장 검출 ──');
const season = growthReport(team, 0, 160);
ok(season.length > 0, `시즌(0→160) 성장 검출 — 변화 선수 ${season.length}명`);
const totalDeltas = season.reduce((n, p) => n + p.deltas.length, 0);
ok(totalDeltas > 0, `총 스탯 변화 ${totalDeltas}건`);
ok(season.some((p) => p.deltas.some((d) => d.delta > 0)), '성장(+) 최소 1건');

console.log('── 오라클 자가대조(리포트 delta == evolveOnDay 원본 스탯 diff) ──');
let mismatch = 0, checked = 0;
const KEY: Record<string, string> = {
  '점프력': 'jump', '민첩성': 'agility', '체력': 'staminaMax', '체젠': 'staminaRegen',
  '반응속도': 'reaction', '위치선정': 'positioning', '집중력': 'focus', '기복': 'consistency', 'VQ': 'vq',
  '공격기술': 'skSpike', '블로킹기술': 'skBlock', '디그기술': 'skDig', '리시브기술': 'skReceive', '세팅기술': 'skSet', '서브기술': 'skServe',
};
for (const pg of season) {
  const b = evolveOnDay(pg.id, 0) as unknown as Record<string, number>;
  const a = evolveOnDay(pg.id, 160) as unknown as Record<string, number>;
  for (const d of pg.deltas) {
    checked++;
    const expect = a[KEY[d.label]] - b[KEY[d.label]];
    if (expect !== d.delta || !Number.isInteger(d.delta)) mismatch++;
  }
}
ok(mismatch === 0, `모든 delta가 원본 스탯 정수 diff와 일치(${checked}건 대조, 불일치 ${mismatch})`);

console.log('── 결정론 ──');
ok(JSON.stringify(growthReport(team, 0, 160)) === JSON.stringify(season), '반복 호출 동일(결정론)');

// 빈도 측정 — 경기 간격(~4일) 구간별 평균 변화(모든 스탯이라 "1개도 없다" 해소되는지)
console.log('── 빈도(경기 간격 4일 기준, 전 팀 평균) ──');
let intervalsWithChange = 0, intervals = 0, deltaSum = 0;
for (const t of LEAGUE.teams) {
  for (let d = 0; d + 4 <= 160; d += 4) {
    const rep = growthReport(t.id, d, d + 4);
    intervals++;
    const dc = rep.reduce((n, p) => n + p.deltas.length, 0);
    if (dc > 0) intervalsWithChange++;
    deltaSum += dc;
  }
}
console.log(`  구간 ${intervals}개 · 변화 있는 구간 ${intervalsWithChange} (${(100 * intervalsWithChange / intervals).toFixed(0)}%) · 구간당 평균 ${(deltaSum / intervals).toFixed(2)}건`);
ok(intervalsWithChange / intervals > 0.3, '경기 간격 구간의 30%+ 에서 변화 발생(충분한 체감)');

console.log('\n── 시즌 샘플(앞 4명) ──');
for (const p of season.slice(0, 4)) {
  console.log(`  ${p.name}: ${p.deltas.map((d) => `${d.label} ${d.delta > 0 ? '+' + d.delta : d.delta}`).join(' · ')}`);
}

// 성장 상태(추상 표시, GPT ③) — 전 리그 선수 분류 분포·결정론
console.log('\n── 성장 상태(growthOutlook) 분포·결정론 ──');
const allIds = LEAGUE.teams.flatMap((t) => currentRosters()[t.id] ?? []);
const dist: Record<string, number> = {};
let detOk = true;
for (const id of allIds) {
  const pl = getPlayer(id); if (!pl) continue;
  const o1 = growthOutlook(pl), o2 = growthOutlook(pl);
  if (o1.label !== o2.label) detOk = false;
  dist[o1.label] = (dist[o1.label] ?? 0) + 1;
}
console.log('  ' + Object.entries(dist).map(([k, v]) => `${k} ${v}`).join(' · '));
ok(detOk, '성장 상태 결정론(동일 입력 동일 라벨)');
ok(Object.keys(dist).length >= 2, '라벨이 최소 2종 이상 분포(전원 동일 아님)');

console.log(fail === 0 ? '\n✅ 성장 리포트(모든 스탯) 검증 통과' : `\n❌ ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
