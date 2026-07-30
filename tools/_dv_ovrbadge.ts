// _dv_ovrbadge.ts — OvrBadge 이중 스트레치 봉인 상비 가드 (UI-52, 2026-07-30)
//
// 배경: 일정 화면(app/(tabs)/schedule.tsx)이 OvrBadge에 **이미 displayOvr된 값**을 넘겨 badge가 또 displayOvr를
//   적용 → 이중 스트레치로 엘리트팀이 전부 99에 박혔다. OvrBadge 계약: 호출부는 raw 연속 OVR만 넘기고, badge가
//   내부에서 displayOvr를 정확히 1회 적용한다. 이미 표시 스케일인 값(평균 등)을 렌더할 때만 preScaled=true.
//
// 이 가드가 지키는 불변식:
//   A. (소스 계약) Screen.tsx OvrBadge는 `preScaled ? Math.round(value) : displayOvr(value)` 분기를 갖는다.
//   B. (소스 계약) schedule.tsx 모달은 raw(overallRaw(p))를 넘긴다 — OvrBadge 안에 displayOvr(...)를 넣지 않는다.
//   C. (소스 계약) schedule.tsx 카드 두 곳(myOvr·oppOvr)은 preScaled로 렌더한다.
//   D. (수치 A/B) badge 렌더식을 소스(A)에 앵커해 복제 — 실제 리그 엘리트 선수로:
//      D1. raw 경로: renderBadge(raw, false) === displayOvr(raw) (선수 상세 정본과 동일 단일 스트레치).
//      D2. 옛 버그(이중): displayOvr(displayOvr(raw)) 는 엘리트에서 99에 박혀 정본과 **다르다** → 오라클 민감(비어있지 않음).
//      D3. 카드 preScaled: renderBadge(avgDisplay, true) === avgDisplay === 모달 per-player 정본 평균.
//      D4. 옛 버그(카드 이중): displayOvr(avgDisplay) 는 엘리트 라인업에서 99에 박혀 정본 평균과 **다르다**.
//
// 실행: npx tsx tools/_dv_ovrbadge.ts ; echo $?

import { readFileSync } from 'fs';
import { join } from 'path';
import { overallRaw, teamOverallRaw, displayOvr } from '../engine/overall';
import { LEAGUE } from '../data/league';
import type { Player } from '../types';

let fail = 0;
const bad = (m: string) => { console.log('  ❌ ' + m); fail++; };
const ok = (m: string) => console.log('  ✓ ' + m);

const ROOT = join(__dirname, '..');
const screenSrc = readFileSync(join(ROOT, 'components', 'Screen.tsx'), 'utf8');
const schedSrc = readFileSync(join(ROOT, 'app', '(tabs)', 'schedule.tsx'), 'utf8');

// ── A. Screen.tsx OvrBadge 계약: preScaled 분기가 소스에 존재 ──
const BODY = 'const v = preScaled ? Math.round(value) : displayOvr(value);';
if (!screenSrc.includes(BODY)) bad(`A: Screen.tsx OvrBadge 본문에 "${BODY}" 없음 (계약 위반 — badge가 preScaled를 존중하지 않음)`);
else ok('A: OvrBadge 본문 = preScaled ? round : displayOvr (1회 적용 계약)');
if (!/preScaled\s*=\s*false/.test(screenSrc)) bad('A: OvrBadge 시그니처 preScaled 기본값 false 아님 (기존 raw 호출부 회귀 위험)');
else ok('A: preScaled 기본 false → 기존 raw 호출부 동작 불변');

// ── B. schedule.tsx 모달: raw를 넘긴다 (OvrBadge 안 displayOvr 금지) ──
if (/<OvrBadge\s+value=\{displayOvr\(/.test(schedSrc)) bad('B: schedule.tsx에 <OvrBadge value={displayOvr(...)} 잔존 = 이중 스트레치');
else ok('B: 모달 OvrBadge 안에 displayOvr(...) 없음 (raw만 전달)');
if (!/<OvrBadge\s+value=\{overallRaw\(p\)\}\s*\/>/.test(schedSrc)) bad('B: 모달 <OvrBadge value={overallRaw(p)} /> 정본 호출부 없음');
else ok('B: 모달 = overallRaw(p) (선수 상세와 동일 정본 스케일)');

// ── C. schedule.tsx 카드: myOvr·oppOvr는 preScaled ──
if (!/value=\{preview\.myOvr\}\s+preScaled/.test(schedSrc)) bad('C: 카드 myOvr에 preScaled 없음 (이미 표시 스케일 평균이 이중 스트레치)');
else ok('C: 카드 우리 OVR = preScaled');
if (!/value=\{preview\.oppOvr\}\s+preScaled/.test(schedSrc)) bad('C: 카드 oppOvr에 preScaled 없음');
else ok('C: 카드 상대 OVR = preScaled');

// ── D. 수치 A/B — 소스(A)에 앵커한 badge 렌더식 복제 ──
// A에서 본문이 정확히 이 식임을 확인했으므로 renderBadge는 실제 컴포넌트와 동치.
const renderBadge = (value: number, preScaled: boolean) => (preScaled ? Math.round(value) : displayOvr(value));

// 리그에서 최고 raw OVR 선수(엘리트) 확보 — 가정 아닌 실측 데이터
const players = LEAGUE.players as Player[];
const elite = players.reduce((a, b) => (overallRaw(b) > overallRaw(a) ? b : a));
const eRaw = overallRaw(elite);

// D1·D2 (per-player 모달): raw 경로 = 정본, 이중 경로 = 옛 버그
const singleDisp = displayOvr(eRaw);
if (renderBadge(eRaw, false) !== singleDisp) bad(`D1: raw 경로 badge(${renderBadge(eRaw, false)}) ≠ displayOvr(raw)=${singleDisp}`);
else ok(`D1: 모달 raw 경로 = displayOvr(raw) = ${singleDisp} (정본)`);
const doubleDisp = displayOvr(displayOvr(eRaw)); // 옛 버그: value={displayOvr(overallRaw(p))} → badge 또 displayOvr
if (doubleDisp === singleDisp) bad(`D2: 오라클 무감 — 이중(${doubleDisp})과 단일(${singleDisp})이 같아 버그를 구분 못 함 (엘리트 표본 부적합)`);
else ok(`D2: 이중 스트레치=${doubleDisp}(99 박힘) ≠ 단일=${singleDisp} → 오라클 민감(버그 검출 가능)`);

// D3·D4 (카드 라인업 평균): 엘리트팀 라인업의 per-player displayOvr 평균
const eliteTeam = LEAGUE.teams.reduce((a, b) => {
  const avgOf = (t: typeof a) => t.players.map((id) => players.find((p) => p.id === id)!).reduce((s, p) => s + overallRaw(p), 0) / t.players.length;
  return avgOf(b) > avgOf(a) ? b : a;
});
const squad = eliteTeam.players.map((id) => players.find((p) => p.id === id)!);
const avgDisplay = Math.round(squad.reduce((s, p) => s + displayOvr(overallRaw(p)), 0) / squad.length); // = lineupOvr 산식
const perPlayerAvg = avgDisplay; // 모달 per-player 정본 숫자들의 평균과 동일 스케일
if (renderBadge(avgDisplay, true) !== perPlayerAvg) bad(`D3: 카드 preScaled badge(${renderBadge(avgDisplay, true)}) ≠ per-player 정본 평균(${perPlayerAvg})`);
else ok(`D3: 카드 preScaled = per-player 정본 평균 = ${perPlayerAvg} (모달과 일치)`);
const cardDouble = displayOvr(avgDisplay); // 옛 버그: 카드가 preScaled 없이 → badge가 평균을 또 displayOvr
if (cardDouble === perPlayerAvg) bad(`D4: 오라클 무감 — 카드 이중(${cardDouble})=정본(${perPlayerAvg}) (엘리트팀 표본 부적합)`);
else ok(`D4: 카드 이중 스트레치=${cardDouble}(99 박힘) ≠ 정본 평균=${perPlayerAvg} → 봉인 확인`);

console.log(fail === 0
  ? `\nPASS _dv_ovrbadge — OvrBadge 이중 스트레치 봉인(UI-52): 소스 계약 A~C + 수치 A/B D1~D4 (엘리트 raw=${eRaw}, 단일=${singleDisp}, 이중=${doubleDisp}; 카드 정본=${perPlayerAvg}, 이중=${cardDouble})`
  : `\nFAIL _dv_ovrbadge — ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
