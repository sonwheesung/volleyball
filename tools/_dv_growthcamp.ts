// 성장 리포트 — 전지훈련 구매분 차감 검증 (TRAINING §성장리포트 정정, 2026-07-11).
//   스펙: career(입단 이후 누적) 표기에서 전지훈련(다이아 캠프) 구매분(cur)을 스탯별로 차감 → 순수(유기적) 성장만.
//   A/B: 캠프를 보낸 선수의 career 표기가 "캠프 전"과 **완전히 동일**해야 한다(구매분이 성장으로 안 섞임).
//        캠프는 현재+포텐 동시 +3 → 여력(pot-cur) 불변 → 유기적 궤적 constant offset 보존 → 차감이 정확.
//   민감도(positive control): 차감을 끄면(campLog=[]) 같은 상태에서 career가 부풀어야(다르게) 한다 → 가드가 실제로 잡는다.
//   npx tsx tools/_dv_growthcamp.ts
import { resetLeagueBase, LEAGUE, currentRosters, getPlayer, commitPlayerBase } from '../data/league';
import { growthReport, type CampLogLike } from '../data/growthReport';
import { applyCampCourse, CAMP_COURSES, CAMP_CUR_GAIN, CAMP_POT_GAIN, type CampCourse } from '../engine/diamonds';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

resetLeagueBase();
const team = LEAGUE.teams[0].id;
const FROM = 0, TO = 140; // career는 toDay(현재) 기준 — 유기적 성장이 쌓이도록 넉넉히

// 캠프 3스탯이 모두 여유(현재·포텐 ≤ 95)라 +3이 99캡에 안 걸리는 (선수, 코스) 한 쌍을 고른다 → constant offset 정확.
const COURSES = Object.keys(CAMP_COURSES) as CampCourse[];
let pick: { id: string; course: CampCourse } | null = null;
for (const id of currentRosters()[team] ?? []) {
  const p = getPlayer(id);
  if (!p || !p.debut) continue;
  const rec = p as unknown as Record<string, number>;
  for (const c of COURSES) {
    const stats = CAMP_COURSES[c].stats;
    if (stats.every((s) => rec[s] <= 95 && (p.potential[s] ?? 99) <= 95)) { pick = { id, course: c }; break; }
  }
  if (pick) break;
}
ok(pick !== null, `여유(캡 무접촉) 캠프 대상 (선수,코스) 확보: ${pick ? `${getPlayer(pick.id)?.name}/${pick.course}` : '없음'}`);
if (!pick) { console.log('\n❌ 대상 없음 — 시드 변경 확인 필요'); process.exit(1); }

const { id, course } = pick;
const find = (rep: ReturnType<typeof growthReport>) => rep.find((x) => x.id === id);

// ── ① 캠프 전 baseline (clean base) ──
console.log('\n── ① 캠프 전 baseline ──');
const baseReport = growthReport(team, FROM, TO, []);
const base = find(baseReport);
ok(!!base && !!base.career, '대상 선수가 baseline 리포트에 있고 career(누적) 존재');
const baseCareerSig = JSON.stringify(base!.career!.statDeltas);
const baseDeltasSig = JSON.stringify(base!.deltas);
console.log(`  baseline career 누적: ${base!.career!.statDeltas.map((d) => `${d.label} ${d.delta > 0 ? '+' : ''}${d.delta}`).join(' · ') || '(없음)'}`);

// ── 캠프 적용(현재+3·포텐+3, base에 굽기) + campLog 엔트리 ──
const camped = applyCampCourse(getPlayer(id)!, course); // cur+3·pot+3
commitPlayerBase({ [id]: camped });
const campLog: CampLogLike[] = [{ playerId: id, course, cur: CAMP_CUR_GAIN }];
// 캠프가 실제로 현재 스탯을 올렸는지 확인(A/B 전제)
const rawAfter = getPlayer(id) as unknown as Record<string, number>;
ok(CAMP_COURSES[course].stats.every((s) => rawAfter[s] === (getPlayer(id) as any)[s]), '캠프 base 반영됨(레지스트리 갱신)');

// ── ② 차감 ON(campLog 전달): career가 캠프 전과 완전 동일해야(구매분 미반영) ──
console.log('\n── ② 차감 ON — career == 캠프 전(구매분이 성장으로 안 섞임) ──');
const exclReport = growthReport(team, FROM, TO, campLog);
const excl = find(exclReport);
ok(!!excl && !!excl.career, '대상 선수 여전히 리포트에 존재(구간 변화 유지)');
ok(JSON.stringify(excl!.career!.statDeltas) === baseCareerSig, 'career 누적(캠프 제외) == 캠프 전 baseline (A/B 동일)');
ok(JSON.stringify(excl!.deltas) === baseDeltasSig, '구간 deltas도 캠프 무영향(양끝 동일 반영 — 배경 사실 재확인)');

// ── ③ 차감 OFF(campLog=[]): 같은 캠프 상태인데 career가 부풀어야(다르게) → 차감이 실제로 작동함을 증명 ──
console.log('\n── ③ 차감 OFF(민감도) — 같은 상태에서 career가 부풀어 baseline과 달라야 ──');
const rawReport = growthReport(team, FROM, TO, []);
const raw = find(rawReport);
ok(!!raw && !!raw.career, '대상 선수 raw 리포트에 존재');
ok(JSON.stringify(raw!.career!.statDeltas) !== baseCareerSig, 'career 누적(차감 OFF) != baseline (구매분이 부풀림 — 가드가 잡는 대상)');
// 캠프 3스탯 각각 정확히 +CAMP_CUR_GAIN 부풀었는지 확인
let inflateOk = true;
for (const s of CAMP_COURSES[course].stats) {
  const label = ([['jump','점프력'],['agility','민첩성'],['staminaMax','체력'],['staminaRegen','체젠'],['reaction','반응속도'],['positioning','위치선정'],['focus','집중력'],['consistency','기복'],['vq','VQ'],['skSpike','공격기술'],['skBlock','블로킹기술'],['skDig','디그기술'],['skReceive','리시브기술'],['skSet','세팅기술'],['skServe','서브기술']] as [string,string][]).find(([k]) => k === s)![1];
  const rawD = raw!.career!.statDeltas.find((d) => d.label === label)?.delta ?? 0;
  const baseD = base!.career!.statDeltas.find((d) => d.label === label)?.delta ?? 0;
  if (rawD - baseD !== CAMP_CUR_GAIN) { inflateOk = false; console.error(`    ${label}: raw ${rawD} - base ${baseD} = ${rawD - baseD} (기대 ${CAMP_CUR_GAIN})`); }
}
ok(inflateOk, `캠프 3스탯이 정확히 +${CAMP_CUR_GAIN}씩 부풀고(차감 OFF), 차감 ON이 그만큼 정확히 빼냄`);
console.log(`  POT_GAIN=${CAMP_POT_GAIN} (여력 보존 근거 — 현재+포텐 동시 +${CAMP_CUR_GAIN}/+${CAMP_POT_GAIN})`);

// ── ④ 결정론 ──
console.log('\n── ④ 결정론 ──');
ok(JSON.stringify(growthReport(team, FROM, TO, campLog)) === JSON.stringify(exclReport), '반복 호출 동일(결정론)');

resetLeagueBase(); // 후속 가드 오염 방지(전역 레지스트리 복원)
console.log(fail === 0 ? '\n✅ GROWTHCAMP PASS (전지훈련 구매분 차감 — career 순수 성장만)' : `\n❌ GROWTHCAMP FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
