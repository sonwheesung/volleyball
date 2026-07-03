// 코치 성향 직교성 검증 (STAFF_SYSTEM §8.1 phase① — 스칼라 지배 없음·팀 상황따라 최적이 바뀜).
//   npx tsx tools/_dv_coachtype.ts
// 핵심: 육성형은 어린 선수에, 즉전형은 주전에 우위(교차=직교) · 완성형은 장기 천장↑ · 노쇠억제형은 노장 보존 · 결정론·save-compat.
// ※ 원시 스탯 델타로 측정(overall은 양자화돼 미세차 못 봄 — 초판 실패서 교훈).
import { createRng } from '../engine/rng';
import { makePlayer } from '../data/seed';
import { evolvePlayer } from '../engine/progression';
import { staffEffects } from '../engine/staff';
import { SEASON_LENGTH } from '../engine/rollover';
import type { AssistantCoach, CoachType, CoachSpecialty, Player, TrainableStat, TrainingFocus } from '../types';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
const rng = createRng(20260703);
const FOCUS: TrainingFocus = { primary: [4, 5], secondary: [6, 7, 8] }; // 공격 중심(attack 코치 boost 발현 — skSpike primary)

const coach = (type: CoachType, specialty: CoachSpecialty = 'attack', rating = 90): AssistantCoach =>
  ({ id: `c-${type}`, name: type, age: 45, specialty, type, rating, salary: 0, teamId: null });

// 통제 선수 — age/peakAge/현재 skSpike/포텐만 지정, 나머지 무작위. xp 초기화(신선 성장).
function mkPlayer(age: number, peakAge: number, curSpike: number, potAll: number): Player {
  const base = makePlayer(rng, `ct-${age}-${peakAge}-${curSpike}-${potAll}`, 'OH', false, age);
  const pot = Object.fromEntries(Object.keys(base.potential).map((k) => [k, potAll])) as Player['potential'];
  return { ...base, age, peakAge, skSpike: curSpike, potential: pot, xp: {} };
}
const stat = (p: Player, s: TrainableStat): number => (p as unknown as Record<TrainableStat, number>)[s];
const delta = (p: Player, c: AssistantCoach, s: TrainableStat, seasons = 1): number => {
  let q = p;
  for (let i = 0; i < seasons; i++) q = evolvePlayer(q, FOCUS, SEASON_LENGTH, staffEffects([c]));
  return stat(q, s) - stat(p, s);
};

console.log('── 육성형 vs 즉전형: 나이 타깃 교차(직교성 핵심) ──');
const young = mkPlayer(20, 27, 55, 90);   // 전성기 전, 성장 여지
const prime = mkPlayer(29, 27, 55, 90);   // 전성기 이후(주전 베테랑), 여지 있음(ageMulSkill 0.4)
const dY = delta(young, coach('developer'), 'skSpike'), wY = delta(young, coach('winnow'), 'skSpike');
const dP = delta(prime, coach('developer'), 'skSpike'), wP = delta(prime, coach('winnow'), 'skSpike');
console.log(`  어린선수 skSpike 성장: 육성형 +${dY} vs 즉전형 +${wY}`);
console.log(`  주전(전성기+) skSpike 성장: 육성형 +${dP} vs 즉전형 +${wP}`);
ok(dY > wY, '어린 선수엔 육성형 > 즉전형');
ok(wP > dP, '주전(전성기+)엔 즉전형 > 육성형');
ok(!(dY > wY && dP > wP), '한 성향이 두 상황 모두 지배하지 않음(직교 — 팀 상황따라 최적이 바뀜)');

console.log('── 완성형: 장기 천장↑(포텐 상한을 더 올려 오래 보면 더 높이) ──');
const talent = mkPlayer(19, 28, 55, 78); // 포텐 78(99 클램프 회피) — finisher potBonus가 천장을 더 올림
const finF = delta(talent, coach('finisher'), 'skSpike', 8), devF = delta(talent, coach('developer'), 'skSpike', 8);
console.log(`  8시즌 skSpike 도달: 완성형 +${finF} vs 육성형 +${devF}`);
ok(finF > devF, '장기(8시즌)엔 완성형 천장이 육성형보다 높이 도달');

console.log('── 노쇠억제형 vs 회복특화형: 노장 신체 보존 ──');
const oldP = mkPlayer(33, 27, 85, 85); // 천장 도달(성장 여지 0) → 순수 노쇠. jump는 physical(33세 성장 0)
const antiJ = delta(oldP, coach('antiaging', 'stamina'), 'jump', 3), recoJ = delta(oldP, coach('recovery', 'stamina'), 'jump', 3);
console.log(`  노장 3시즌 jump 변화: 노쇠억제형 ${antiJ} vs 회복특화형 ${recoJ}`);
ok(antiJ > recoJ, '노장은 노쇠억제형이 회복특화형보다 신체(jump) 덜 하락');

console.log('── 결정론 · save-compat ──');
ok(delta(young, coach('developer'), 'skSpike') === delta(young, coach('developer'), 'skSpike'), '같은 (선수,코치) → 동일(결정론)');
const legacy: AssistantCoach = { id: 'lg', name: 'lg', age: 45, specialty: 'attack', rating: 90, salary: 0, teamId: null };
const eff = staffEffects([legacy]);
ok(Math.abs((eff.trainBoost[4] ?? 0) - (1 + 0.4 * 0.9)) < 1e-9 && (eff.boostBias?.[4] ?? undefined) === undefined, '레거시(type undefined) → 옛 flat 부스트·bias 없음(save-compat)');

console.log(fail === 0 ? '\n✅ PASS _dv_coachtype' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
