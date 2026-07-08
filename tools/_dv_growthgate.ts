// 성장 리포트 트리거 게이트 검증 (TRAINING §성장리포트, 2026-07-08 버그수정)
//   버그: onAdvance가 경기 진입 직전 setDay(경기일)로 currentDay를 올린 뒤, 1세트만 보고 "이어보기"로
//   이탈하면(recordResult 안 됨) currentDay는 경기일인데 result 미기록 → 일정 복귀 시 성장 모달이 **미완 경기에** 떴다.
//   수정(A안): growthTrigger가 "직전 경기가 실제로 완료(results 기록)됐을 때만" show/bump. 이어보기 이탈이면 보류.
//   npx tsx tools/_dv_growthgate.ts
import { resetLeagueBase, LEAGUE, SEASON } from '../data/league';
import { growthTrigger, growthReport } from '../data/growthReport';
import { planNextAction } from '../engine/advance';
import type { MatchResult } from '../types';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

resetLeagueBase();
const team = LEAGUE.teams[0].id;

// 내 팀 경기(일 순서). "중반" 경기 하나를 시나리오 대상으로 — 구간 [0, day]에 성장이 있고, 뒤에 경기가 더 남도록.
const myFix = SEASON.filter((f) => f.homeTeamId === team || f.awayTeamId === team).sort((a, b) => a.dayIndex - b.dayIndex);
ok(myFix.length >= 4, `내 팀 경기 ${myFix.length}개(시나리오용 충분)`);
// 성장 구간이 비지 않는 가장 이른 중반 경기를 고른다(0→day diff가 있어야 A/B가 성립).
const target = myFix.find((f, i) => i >= 2 && i < myFix.length - 1 && growthReport(team, 0, f.dayIndex).length > 0) ?? myFix[Math.floor(myFix.length / 2)];
const targetIdx = myFix.indexOf(target);
const lastGrowthDay = 0;                 // 마지막으로 성장을 본 날
const currentDay = target.dayIndex;      // onAdvance가 이 경기일로 올려둠
const intervalReport = growthReport(team, lastGrowthDay, currentDay);
ok(intervalReport.length > 0, `대상 구간 [0, ${currentDay}] 성장 존재 ${intervalReport.length}명 (A/B 성립 조건)`);

// results: 대상 이전 경기는 모두 기록. 대상 경기 자체는 상태에 따라.
const baseResults: Record<string, MatchResult> = {};
for (const f of myFix) {
  if (f.dayIndex < currentDay) baseResults[f.id] = { fixtureId: f.id, homeSets: 3, awaySets: 0 };
}

console.log('\n── ① 이어보기 이탈(대상 경기 미기록, currentDay는 경기일) → 보류 ──');
const before = { ...baseResults }; // target 미포함(미기록)
// 사각 확인: planNextAction이 target(=currentDay 이하 미기록)을 반환해야 게이트가 작동
const pend = planNextAction(SEASON, team, before);
ok(pend.kind === 'match' && pend.fixture.id === target.id && pend.fixture.dayIndex <= currentDay,
  `planNextAction이 미완 경기(day ${target.dayIndex} ≤ currentDay ${currentDay})를 지목`);
const gBefore = growthTrigger(SEASON, team, before, lastGrowthDay, currentDay);
ok(gBefore.show === false, '미완 경기 상태 → 모달 안 뜸(show=false)');
ok(gBefore.bumpTo === null, '미완 경기 상태 → lastGrowthDay bump 보류(null)');

console.log('\n── ②(A/B) 게이트 제거 모사(구 로직: currentDay>lastGrowthDay만) → 미완인데 뜸(버그 재현) ──');
const oldWouldShow = currentDay > lastGrowthDay && growthReport(team, lastGrowthDay, currentDay).length > 0;
ok(oldWouldShow === true, '구 로직은 이 미완 상태에서 모달을 띄웠다(버그) — 게이트가 실제로 차이를 만든다');

console.log('\n── ③ 경기 완료(recordResult — currentDay 불변) → 그 구간 표시·bump ──');
const after = { ...baseResults, [target.id]: { fixtureId: target.id, homeSets: 3, awaySets: 1 } as MatchResult };
const pendA = planNextAction(SEASON, team, after);
ok(pendA.kind === 'seasonOver' || (pendA.kind === 'match' && pendA.fixture.dayIndex > currentDay),
  'planNextAction이 더 늦은 경기(또는 seasonOver)를 반환 → 게이트 통과 조건');
const gAfter = growthTrigger(SEASON, team, after, lastGrowthDay, currentDay);
ok(gAfter.show === true, '완료 후 → 보류됐던 구간 성장 표시(show=true)');
ok(gAfter.bumpTo === currentDay, `완료 후 → lastGrowthDay를 ${currentDay}로 bump`);
ok(JSON.stringify(gAfter.report) === JSON.stringify(intervalReport), '표시 내용 == 그 구간 growthReport(누락 없음)');

console.log('\n── ④ 완료 후 재포커스(bump됨) → 새 구간 없음, 조용히 통과 ──');
const gRepeat = growthTrigger(SEASON, team, after, currentDay /*=bumped lastGrowthDay*/, currentDay);
ok(gRepeat.show === false && gRepeat.bumpTo === null, 'currentDay==lastGrowthDay → show=false·bump 없음(중복 방지)');

console.log('\n── ⑤ 미초기화(-1) → 조용히 currentDay로 세팅, 표시 없음 ──');
const gInit = growthTrigger(SEASON, team, before, -1, currentDay);
ok(gInit.show === false && gInit.bumpTo === currentDay, 'lastGrowthDay=-1 → bumpTo=currentDay·show=false(catch-up 폭탄 방지)');

console.log('\n── ⑥ 결정론(반복 호출 동일) ──');
ok(JSON.stringify(growthTrigger(SEASON, team, after, lastGrowthDay, currentDay)) === JSON.stringify(gAfter), '동일 입력 동일 출력');

console.log(fail === 0 ? '\n✅ 성장 리포트 트리거 게이트 검증 통과' : `\n❌ ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
