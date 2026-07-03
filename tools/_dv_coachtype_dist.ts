// 코치 성향 배정 검증 (STAFF §8.1 phase①b) — 결정론 배정·분야별 균등·시드풀 전원 유효·재생성 일치.
import { coachTypeFor, SPECIALTY_TYPES } from '../engine/staff';
import { resetLeagueBase, currentCoachPool, LEAGUE, teamAssistants } from '../data/league';
import type { CoachSpecialty } from '../types';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
const SPECS: CoachSpecialty[] = ['attack', 'defense', 'stamina', 'setter', 'mental'];

console.log('── 분야별 균등 배정(id 시드, N=6000) ──');
for (const sp of SPECS) {
  const types = SPECIALTY_TYPES[sp];
  const cnt: Record<string, number> = {};
  const N = 6000;
  for (let i = 0; i < N; i++) { const t = coachTypeFor(`d-${sp}-${i}`, sp)!; cnt[t] = (cnt[t] ?? 0) + 1; }
  const shares = types.map((t) => (cnt[t] ?? 0) / N);
  const exp = 1 / types.length;
  const even = shares.every((s) => Math.abs(s - exp) < 0.06);
  console.log(`  ${sp}: ${types.map((t, i) => `${t} ${(shares[i] * 100).toFixed(0)}%`).join(' · ')}`);
  ok(shares.every((s) => s > 0) && even, `${sp} 성향 균등(기대 ${(exp * 100).toFixed(0)}% ±6%p, 전 성향 등장)`);
  ok(types.every((t) => (cnt[t] ?? 0) > 0), `${sp} 모든 성향 배정됨`);
}

console.log('── 결정론 ──');
ok(coachTypeFor('coach_p123', 'attack') === coachTypeFor('coach_p123', 'attack'), '같은 id·분야 → 동일 성향');

console.log('── 시드 풀: 전원 유효 성향 배정 + 재생성 일치 ──');
resetLeagueBase();
const a1 = currentCoachPool().assistants;
ok(a1.length > 0, '시드 전문코치 존재');
ok(a1.every((a) => a.type !== undefined && SPECIALTY_TYPES[a.specialty].includes(a.type)), '시드 전문코치 전원 분야에 맞는 유효 성향(undefined 없음)');
const before = a1.map((a) => `${a.id}:${a.type}`).sort().join(',');
resetLeagueBase();
const after = currentCoachPool().assistants.map((a) => `${a.id}:${a.type}`).sort().join(',');
ok(before === after, '시드 재생성 시 성향 동일(결정론)');

console.log('── AI 팀 코치도 성향 보유(허위오라클 방지 — 미배정 시 밸런스 A/B가 vacuous) ──');
// 발견 케이스: ai-ac-* 기본 스태프에 type 누락 → 시뮬 전 팀이 레거시 → ON==OFF 거짓 균형. 이 가드가 재발 차단.
resetLeagueBase();
let aiTyped = 0, aiTotal = 0;
for (const t of LEAGUE.teams) for (const a of teamAssistants(t.id)) { aiTotal++; if (a.type && SPECIALTY_TYPES[a.specialty].includes(a.type)) aiTyped++; }
console.log(`  AI 팀 코치 ${aiTyped}/${aiTotal} 성향 보유`);
ok(aiTotal > 0 && aiTyped === aiTotal, 'AI 팀 기본 코치 전원 유효 성향(시뮬서 실제 성향 효과 발현)');

console.log(fail === 0 ? '\n✅ PASS _dv_coachtype_dist' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
