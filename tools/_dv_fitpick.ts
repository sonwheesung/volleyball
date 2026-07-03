// AI 로스터적합 성향 픽 검증 (STAFF §8.1 phase④) — 팀 나이 프로필에 맞는 성향·다양성(메타 아님)·결정론.
import { resetLeagueBase, LEAGUE, teamAssistants, getTeamPlayers } from '../data/league';
import type { CoachSpecialty, CoachType } from '../types';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
resetLeagueBase();

const expected = (sp: CoachSpecialty, avg: number): CoachType => {
  const young = avg < 25.5, old = avg >= 27.5;
  if (sp === 'stamina') return old ? 'antiaging' : 'recovery';
  if (sp === 'mental') return old ? 'stable' : 'clutch';
  return young ? 'developer' : old ? 'winnow' : 'finisher';
};

console.log('── AI 코치 성향 = 로스터 나이 적합 ──');
let mismatch = 0;
const usedTypes = new Set<CoachType>();
for (const t of LEAGUE.teams) {
  const ages = getTeamPlayers(t.id).map((p) => p.age);
  const avg = ages.reduce((s, a) => s + a, 0) / ages.length;
  for (const a of teamAssistants(t.id)) {
    usedTypes.add(a.type!);
    if (a.type !== expected(a.specialty, avg)) { mismatch++; console.error(`    ✗ ${t.name} ${a.specialty} type=${a.type} 기대=${expected(a.specialty, avg)} (avg ${avg.toFixed(1)})`); }
  }
}
ok(mismatch === 0, 'AI 전 팀 코치 성향이 로스터 나이 규칙과 일치');

console.log('── 성향 다양성(메타 아님 — 한 성향이 리그를 지배하지 않음) ──');
console.log(`  리그 등장 성향: ${[...usedTypes].join(', ')}`);
ok(usedTypes.size >= 3, `AI 선택 성향이 3종 이상 다양(실측 ${usedTypes.size}종 — 나이 다른 팀이 다른 성향)`);

console.log('── 나이 극단 팀 대조(어린 vs 노장) ──');
const withAvg = LEAGUE.teams.map((t) => ({ t, avg: getTeamPlayers(t.id).reduce((s, p) => s + p.age, 0) / getTeamPlayers(t.id).length }));
const youngest = withAvg.sort((a, b) => a.avg - b.avg)[0];
const oldest = withAvg[withAvg.length - 1];
const skillType = (teamId: string) => teamAssistants(teamId).find((a) => ['attack', 'defense', 'setter'].includes(a.specialty))?.type;
console.log(`  최연소 ${youngest.t.name}(${youngest.avg.toFixed(1)}) 기량코치=${skillType(youngest.t.id)} · 최고령 ${oldest.t.name}(${oldest.avg.toFixed(1)}) 기량코치=${skillType(oldest.t.id)}`);
ok(youngest.avg >= 27.5 || skillType(youngest.t.id) !== 'winnow', '최연소 팀은 즉전형(winnow) 아님(육성 지향)');
ok(oldest.avg < 25.5 || skillType(oldest.t.id) !== 'developer', '최고령 팀은 육성형(developer) 아님(즉전 지향)');

console.log('── 결정론 ──');
resetLeagueBase();
const snap1 = LEAGUE.teams.map((t) => teamAssistants(t.id).map((a) => a.type).join(',')).join('|');
resetLeagueBase();
const snap2 = LEAGUE.teams.map((t) => teamAssistants(t.id).map((a) => a.type).join(',')).join('|');
ok(snap1 === snap2, '재생성 시 fit-pick 동일(결정론)');

console.log(fail === 0 ? '\n✅ PASS _dv_fitpick' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
