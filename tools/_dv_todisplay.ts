// INDEPENDENT GUARD — 타임아웃 표시 수 보존 (EC-BD-01, 2026-07-07, 사용자 보고 버그).
//   배경: 엔진은 같은 타임라인 슬롯(point)에 이벤트 N건을 적법하게 쌓는다 — 감독 작전 타임아웃 + KOVO
//   테크니컬 타임아웃(1~4세트 8·16점 자동)이 같은 점수에 함께 push됨. 보드가 `.find()`(첫 건만)로 소비하면
//   표시 수 < 데이터 수(TTO 모달이 감독 TO에 가려 소실). 수정: 선택 로직을 courtDirector.timeoutsAt(filter=전건)로
//   추출하고 MatchCourt가 그걸 씀 — 렌더와 이 가드가 **같은 순수 함수**를 구동(재구현 오라클 아님, §4).
//   판정: 400경기에서 (1) 타임아웃 있는 모든 point는 timeoutsAt이 그 point의 전 이벤트를 반환(개수 동등),
//   (2) 경기 전체 Σ timeoutsAt == sim.timeouts.length(보존), (3) 동시 발생(한 point ≥2건) > 0(표본 생동성).
//   A/B(허위 오라클 방지): timeoutsAt을 `.find()`-동등(첫 건만) 변종으로 바꾸면 동시 발생 point에서 소실이
//   나야 함(표시 수 < 데이터 수) — 민감도 실증. 소실 0이면 가드가 아무것도 못 보는 것.
//   Usage: npx tsx tools/_dv_todisplay.ts [matches=400]   ; echo $?
import { LEAGUE, getEvolvedTeamPlayers, coachInfoOf, resetLeagueBase } from '../data/league';
import { simulateMatch } from '../engine/match';
import { timeoutsAt } from '../components/courtDirector';
import type { SimResult, TimeoutEvent } from '../engine/simMatch';
import type { Player } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');

// A/B 변종 — 일부러 깨진 "첫 건만"(구 .find 동등). 민감도 증명용(실코드 아님).
const timeoutsAtBroken = (sim: SimResult, idx: number): TimeoutEvent[] => {
  const first = (sim.timeouts ?? []).find((t) => t.point === idx);
  return first ? [first] : [];
};

resetLeagueBase();
const ids = LEAGUE.teams.map((t) => t.id);
const sq: Record<string, Player[]> = {};
for (const id of ids) sq[id] = getEvolvedTeamPlayers(id, 0);

const N = Math.max(1, Number(process.argv[2]) || 400);

let matches = 0, withTO = 0, totalEvents = 0;
let sumSelected = 0;            // Σ (모든 point에서 timeoutsAt이 반환한 이벤트 수) — 보존 확인
let failCount = 0;             // point별 개수 동등 위반
let failConserve = 0;         // 경기별 Σ 선택 != sim.timeouts.length
let coOccurPoints = 0;        // 한 point에 ≥2건(동시 발생) — 생동성
let coOccurMax = 0;
// A/B: broken 변종이 소실을 내는가
let brokenSelected = 0, brokenMissed = 0;

let seed = 770000;
for (let m = 0; m < N; m++) {
  const hi = ids[m % ids.length], ai = ids[(m * 3 + 1) % ids.length];
  if (hi === ai) continue;
  seed += 17;
  const home = sq[hi], away = sq[ai];
  const sim = simulateMatch(seed, home, away, { home: coachInfoOf(hi), away: coachInfoOf(ai) });
  matches++;
  const tos = sim.timeouts ?? [];
  if (tos.length > 0) withTO++;
  totalEvents += tos.length;

  // point별 실제 이벤트 수(엔진 진실) — 오라클(가드가 timeoutsAt를 재구현하지 않고 원천 카운트와 대조)
  const byPoint = new Map<number, number>();
  for (const t of tos) byPoint.set(t.point, (byPoint.get(t.point) ?? 0) + 1);

  let matchSelected = 0, matchBroken = 0;
  for (const [pt, cnt] of byPoint) {
    const sel = timeoutsAt(sim, pt);
    if (sel.length !== cnt) failCount++;         // 전건을 못 집으면 위반
    if (!sel.every((s) => s.point === pt)) failCount++; // 엉뚱한 point 섞임
    matchSelected += sel.length;
    if (cnt >= 2) { coOccurPoints++; coOccurMax = Math.max(coOccurMax, cnt); }
    // A/B 변종
    const brk = timeoutsAtBroken(sim, pt);
    matchBroken += brk.length;
    if (brk.length < cnt) brokenMissed += cnt - brk.length; // 소실 검출
  }
  sumSelected += matchSelected;
  brokenSelected += matchBroken;
  if (matchSelected !== tos.length) failConserve++;
}

log('═══ 타임아웃 표시 수 보존 가드 (EC-BD-01, courtDirector.timeoutsAt) ═══');
log(`경기 ${matches}건 · 타임아웃 있던 경기 ${withTO} (${(100 * withTO / matches).toFixed(0)}%)`);
log(`총 타임아웃 이벤트 ${totalEvents} (경기당 ${(totalEvents / matches).toFixed(2)}) · timeoutsAt 선택 총합 ${sumSelected}`);
log(`동시 발생 point(한 점수 ≥2건) ${coOccurPoints} (최대 ${coOccurMax}건/point)`);
log(`[A/B 구 .find] 첫건만 선택 총합 ${brokenSelected} · 소실(누락) ${brokenMissed}건`);

let fail = 0;
const check = (cond: boolean, msg: string) => { if (!cond) { log('  ❌ ' + msg); fail++; } else log('  ✓ ' + msg); };
check(withTO > 0, '실제 경기에서 타임아웃 발동(연출 켜짐)');
check(failCount === 0, 'point별: timeoutsAt이 그 point 전 이벤트를 정확히 반환(개수 동등·point 일치)');
check(failConserve === 0, '경기별: Σ timeoutsAt == sim.timeouts.length(보존, 소실 0)');
check(sumSelected === totalEvents, `전체 보존: 선택 총합 ${sumSelected} == 이벤트 총합 ${totalEvents}`);
check(coOccurPoints > 0, '동시 발생(작전+테크니컬 같은 point) 표본 존재(가드가 실제로 겹침을 봄)');
check(brokenMissed > 0, 'A/B: 구 .find(첫건만) 변종은 동시 point에서 소실 재현(민감도 — 허위 오라클 아님)');

log(`\n${fail ? `❌ TODISPLAY_GUARD FAIL (${fail})` : '✅ TODISPLAY_GUARD PASS — 전건 표시(개수 동등·보존)·동시 발생 표본·A/B 소실 재현'}`);
process.exit(fail ? 1 : 0);
