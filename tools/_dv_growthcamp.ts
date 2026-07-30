// 성장 리포트 — 전지훈련 성장 **포함** 검증 (TRAINING §성장리포트, 2026-07-30 반전 — 구 "구매분 차감").
//   career(입단 이후 누적)는 선수 상세가 careerGrowthOf(evolvedPlayer)로 계산(campLog 인자 제거). 전지훈련 부스트가
//   현재 스탯에 이미 구워져 있어 총 성장에 **자동 포함**(OVR 델타와 일관 — 종전엔 스탯만 차감해 불일치였음).
//   A/B: 캠프 적용 후 camp-course 스탯 델타가 정확히 +CAMP_CUR_GAIN 늘어야(포함 증명) · 무변화 스탯은 델타 미포함(민감).
//   ⚠ 이 화면(선수 상세 "입단 후 성장")은 2026-07-30 반전 후 **에뮬 미검증** — TRAINING §성장리포트 "테스트 필요".
//   npx tsx tools/_dv_growthcamp.ts
import { resetLeagueBase, LEAGUE, currentRosters, getPlayer, commitPlayerBase } from '../data/league';
import { growthReport, playerCareerGrowth } from '../data/growthReport';
import { applyCampCourse, CAMP_COURSES, CAMP_CUR_GAIN, CAMP_POT_GAIN, type CampCourse } from '../engine/diamonds';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

resetLeagueBase();
const team = LEAGUE.teams[0].id;
const FROM = 0, TO = 140; // career는 toDay(현재) 기준 — 유기적 성장이 쌓이도록 넉넉히

const LABEL15 = [['jump', '점프력'], ['agility', '민첩성'], ['staminaMax', '체력'], ['staminaRegen', '체력재생'], ['reaction', '반응속도'], ['positioning', '위치선정'], ['focus', '집중력'], ['consistency', '기복'], ['vq', 'VQ'], ['skSpike', '공격기술'], ['skBlock', '블로킹기술'], ['skDig', '디그기술'], ['skReceive', '리시브기술'], ['skSet', '세팅기술'], ['skServe', '서브기술']] as [string, string][];
const labelOf = (s: string) => LABEL15.find(([k]) => k === s)![1];

// 캠프 3스탯이 모두 여유(현재·포텐 ≤ 95)라 +3이 99캡에 안 걸리는 (선수, 코스) 한 쌍을 고른다 → 정확히 +CUR_GAIN 관측.
const COURSES = Object.keys(CAMP_COURSES) as CampCourse[];
let pick: { id: string; course: CampCourse } | null = null;
for (const id of currentRosters()[team] ?? []) {
  const p = getPlayer(id);
  if (!p || !p.debut) continue;
  const rec = p as unknown as Record<string, number>;
  for (const c of COURSES) {
    if (CAMP_COURSES[c].stats.every((s) => rec[s] <= 95 && (p.potential[s] ?? 99) <= 95)) { pick = { id, course: c }; break; }
  }
  if (pick) break;
}
ok(pick !== null, `여유(캡 무접촉) 캠프 대상 (선수,코스) 확보: ${pick ? `${getPlayer(pick.id)?.name}/${pick.course}` : '없음'}`);
if (!pick) { console.log('\n❌ 대상 없음 — 시드 변경 확인 필요'); process.exit(1); }

const { id, course } = pick;
const findSeg = (rep: ReturnType<typeof growthReport>) => rep.find((x) => x.id === id);

// ── ① 캠프 전 baseline career ──
console.log('\n── ① 캠프 전 baseline career ──');
const baseCareer = playerCareerGrowth(id, TO);
const baseSeg = findSeg(growthReport(team, FROM, TO));
ok(!!baseCareer, '대상 선수 career(누적) 셀렉터(playerCareerGrowth) 존재');
ok(!!baseSeg, '대상 선수가 baseline 구간 리포트(growthReport)에 있음');
const baseCareerSig = JSON.stringify(baseCareer!.statDeltas);
const baseDeltasSig = JSON.stringify(baseSeg!.deltas);
const baseDelta = (s: string) => baseCareer!.statDeltas.find((d) => d.label === labelOf(s))?.delta ?? 0;
console.log(`  baseline career 누적: ${baseCareer!.statDeltas.map((d) => `${d.label} ${d.delta > 0 ? '+' : ''}${d.delta}`).join(' · ') || '(없음)'}`);

// ── 캠프 적용(현재+3·포텐+3, base에 굽기) ──
const camped = applyCampCourse(getPlayer(id)!, course); // cur+3·pot+3
commitPlayerBase({ [id]: camped });
const rawAfter = getPlayer(id) as unknown as Record<string, number>;
ok(CAMP_COURSES[course].stats.every((s) => rawAfter[s] === (getPlayer(id) as any)[s]), '캠프 base 반영됨(레지스트리 갱신)');

// ── ② career(캠프 후)가 camp-course 스탯에 정확히 +CAMP_CUR_GAIN 포함해야(전지훈련 포함=총 성장) ──
console.log('\n── ② career(캠프 후) — camp 스탯이 정확히 +CAMP_CUR_GAIN 포함(총 성장) ──');
const afterCareer = playerCareerGrowth(id, TO);
const afterSeg = findSeg(growthReport(team, FROM, TO));
ok(!!afterCareer, '대상 선수 career 셀렉터 여전히 존재');
let inclOk = true;
for (const s of CAMP_COURSES[course].stats) {
  const aD = afterCareer!.statDeltas.find((d) => d.label === labelOf(s))?.delta ?? 0;
  const diff = aD - baseDelta(s);
  if (diff !== CAMP_CUR_GAIN) { inclOk = false; console.error(`    ${labelOf(s)}: 캠프후 ${aD} - 캠프전 ${baseDelta(s)} = ${diff} (기대 +${CAMP_CUR_GAIN})`); }
}
ok(inclOk, `캠프 3스탯이 career 누적에 정확히 +${CAMP_CUR_GAIN}씩 포함(전지훈련 포함 = 총 성장)`);
// A/B(민감): career가 baseline과 달라야(캠프가 실제로 반영)
ok(JSON.stringify(afterCareer!.statDeltas) !== baseCareerSig, 'career 누적(캠프 후) != 캠프 전 baseline (캠프 반영 — 가드 민감)');
// 구간 리포트(growthReport)는 캠프가 양끝에 동일 반영이라 delta 불변(배경 사실 — career와 대비)
ok(JSON.stringify(afterSeg!.deltas) === baseDeltasSig, '구간 deltas는 캠프 무영향(양끝 동일 반영 — 배경 사실)');
console.log(`  POT_GAIN=${CAMP_POT_GAIN} (현재+포텐 동시 +${CAMP_CUR_GAIN}/+${CAMP_POT_GAIN})`);

// ── ③ 결정론 ──
console.log('\n── ③ 결정론 ──');
ok(JSON.stringify(playerCareerGrowth(id, TO)) === JSON.stringify(afterCareer), 'career 셀렉터 반복 호출 동일(결정론)');
ok(JSON.stringify(growthReport(team, FROM, TO)) === JSON.stringify(growthReport(team, FROM, TO)), '구간 리포트 반복 호출 동일(결정론)');

resetLeagueBase(); // 후속 가드 오염 방지(전역 레지스트리 복원)
console.log(fail === 0 ? '\n✅ GROWTHCAMP PASS (전지훈련 포함 — career 총 성장)' : `\n❌ GROWTHCAMP FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
