// 좌표-중복 타임아웃 가드 (MATCH_INTERVENTION_SYSTEM §4.6) — 감독 자동 TO + 유저 개입 TO 같은 좌표 = 작전 TO 2개 버그 봉인.
//   불변식: 한 데드볼(같은 side·setNo·home·away)에 비테크니컬(작전) 타임아웃은 최대 1개.
//   버그(2026-08-01, 400경기 100% 재현): 경기 지휘 "감독 자동"(manualSide 미설정)이면 감독 자동 TO가 내 팀에도 걸리는데
//     유저 개입 TO가 canIntervene 게이트를 안 봐서 같은 점수에 수동 TO를 얹음 → 좌표 비테크니컬 TO 2개.
//   수정: engine/match.ts 개입 TO 블록에서 push·예산차감 전에 timeoutEvents.some(!technical && 좌표일치) → no-op.
//
//   판정1: 감독이 home에 건 첫 비테크니컬 TO 좌표에 유저 TO를 얹으면(수정 후) 그 좌표 비테크니컬 TO가 정확히 1개. 표본 ≥200경기.
//   판정2(A/B 민감도): 같은 유저-TO 개입 메커니즘을,
//       (테스트B) 감독 TO 좌표에 주입 → 그 좌표 비테크니컬 TO 증분 Δ0(가드가 충돌 억제 — 수정 전이라면 base 1 + 유저 1 = 2였다).
//       (대조A)  감독이 안 부른 자유(이른 세트1) 좌표에 주입 → 그 좌표 비테크니컬 TO 증분 Δ+1(유저 개입 경로가 실제로 살아있음).
//     같은 주입을 좌표만 바꿔 Δ0 vs Δ+1 → 유일한 차이=감독 TO와의 충돌 → 가드가 "충돌만" 억제함을 실증(허위 오라클/불활성 경로 방지).
//   판정3: 무개입 sim 바이트 동일 — interventions:[] vs 필드 생략이 SimResult 직렬화 동일(개입 경로가 무개입에 완전 무영향).
//   전건 PASS면 exit 0, 아니면 1.
//
//   A/B 자가검증(수동, 상설 아님): engine/match.ts 신규 좌표-중복 가드 라인을 지우면 판정1·판정2 테스트B가 FAIL해야 한다(중복 재발).
//   npx tsx tools/_dv_to_nodup.ts

import { LEAGUE, getEvolvedTeamPlayers, coachInfoOf } from '../data/league';
import { simulateMatch } from '../engine/match';
import type { TimeoutEvent, MatchIntervention } from '../engine/simMatch';
import type { Side } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');

const TARGET = 200;      // 판정1/판정2 표본 하한(감독이 home에 비테크니컬 TO를 건 경기)
const SEED_CAP = 40000;  // 표본 채우기 위한 시드 상한(과소표본 방지)
const DAY = 0;

// 비테크니컬 TO 개수(좌표 매칭).
function nonTechAt(tos: TimeoutEvent[] | undefined, side: Side, setNo: number, h: number, a: number): number {
  return (tos ?? []).filter((t) => !t.technical && t.side === side && t.setNo === setNo && t.home === h && t.away === a).length;
}

function main(): void {
  const teams = LEAGUE.teams.map((t) => t.id);
  const squad = new Map(teams.map((id) => [id, getEvolvedTeamPlayers(id, DAY)]));
  const coach = new Map(teams.map((id) => [id, coachInfoOf(id)]));

  const fails: string[] = [];

  let qualified = 0;
  let pass1 = 0, fail1 = 0;
  let baseAtXNot1 = 0;             // base 감독 TO 좌표가 1이 아닌 이상 케이스(진단)
  // 판정2
  let deltaCoachSum = 0;          // 테스트B: 감독 좌표 유저 주입 증분 총합(기대 0)
  let deltaFreeSum = 0, freeTested = 0; // 대조A: 자유 좌표 유저 주입 증분 총합(기대 = freeTested)
  let freeMismatch = 0;
  // 판정3
  let byteTested = 0, byteFails = 0;

  for (let seed = 1; qualified < TARGET && seed < SEED_CAP; seed++) {
    const home = teams[seed % teams.length];
    const away = teams[(seed * 7 + 3) % teams.length];
    if (home === away) continue;
    const hp = squad.get(home)!;
    const ap = squad.get(away)!;
    const baseOpts = { home: coach.get(home), away: coach.get(away) };

    // 판정3 — 무개입 바이트 동일(interventions:[] vs 생략). 모든 시드에서 검사.
    const base = simulateMatch(seed, hp, ap, { ...baseOpts });
    const withEmpty = simulateMatch(seed, hp, ap, { ...baseOpts, interventions: [] });
    byteTested++;
    if (JSON.stringify(base) !== JSON.stringify(withEmpty)) byteFails++;

    // 감독이 home에 건 첫 비테크니컬 TO 좌표 X.
    const coachTO = (base.timeouts ?? []).find((t) => !t.technical && t.side === 'home');
    if (!coachTO) continue;
    qualified++;
    const X = { setNo: coachTO.setNo, h: coachTO.home, a: coachTO.away };
    const baseAtX = nonTechAt(base.timeouts, 'home', X.setNo, X.h, X.a);
    if (baseAtX !== 1) baseAtXNot1++;

    // 판정1 + 판정2 테스트B — 감독 좌표에 유저 TO 주입 → 정확히 1개(증분 0).
    const ivX: MatchIntervention[] = [{ at: { setNo: X.setNo, h: X.h, a: X.a }, side: 'home', kind: 'timeout' }];
    const injX = simulateMatch(seed, hp, ap, { ...baseOpts, interventions: ivX });
    const injAtX = nonTechAt(injX.timeouts, 'home', X.setNo, X.h, X.a);
    if (injAtX === 1) pass1++; else { fail1++; if (fail1 <= 5) fails.push(`(판정1) seed ${seed} 감독좌표 ${X.setNo}·${X.h}:${X.a} 유저TO 주입 후 비테크 TO ${injAtX}개(기대 1)`); }
    deltaCoachSum += (injAtX - baseAtX);

    // 판정2 대조A — 감독이 안 부른 자유 좌표(이른 세트1) 유저 TO 주입 → 증분 +1.
    //   자유 좌표 = base.points 중 setNo1·다음 포인트도 setNo1(루프가 그 좌표를 방문)·비테크 TO 0(양측)·이른 점수.
    const p = base.points;
    let free: { setNo: number; h: number; a: number } | null = null;
    for (let k = 0; k + 1 < p.length; k++) {
      const cur = p[k], nxt = p[k + 1];
      if (cur.setNo !== 1 || nxt.setNo !== 1) { if (cur.setNo > 1) break; else continue; }
      if (cur.home + cur.away < 2 || cur.home + cur.away > 8) continue; // 이른 점수(감독 임계 미도달 구간)
      if (nonTechAt(base.timeouts, 'home', 1, cur.home, cur.away) !== 0) continue;
      if (nonTechAt(base.timeouts, 'away', 1, cur.home, cur.away) !== 0) continue;
      free = { setNo: 1, h: cur.home, a: cur.away };
      break;
    }
    if (free) {
      const ivF: MatchIntervention[] = [{ at: { setNo: free.setNo, h: free.h, a: free.a }, side: 'home', kind: 'timeout' }];
      const injF = simulateMatch(seed, hp, ap, { ...baseOpts, interventions: ivF });
      const injAtF = nonTechAt(injF.timeouts, 'home', free.setNo, free.h, free.a);
      const delta = injAtF - 0; // base 자유좌표 비테크 TO = 0(위에서 확인)
      deltaFreeSum += delta;
      freeTested++;
      if (delta !== 1) { freeMismatch++; if (freeMismatch <= 5) fails.push(`(판정2 대조A) seed ${seed} 자유좌표 1·${free.h}:${free.a} 유저TO 주입 증분 ${delta}(기대 +1)`); }
    }
  }

  // 판정 종합.
  if (qualified < TARGET) fails.push(`표본 부족 — 감독 home 비테크 TO 경기 ${qualified}건 < ${TARGET}(SEED_CAP ${SEED_CAP} 소진)`);
  if (fail1 > 0) fails.push(`(판정1) 좌표 TO≠1 총 ${fail1}건`);
  if (baseAtXNot1 > 0) fails.push(`(진단) base 감독좌표 비테크 TO≠1 ${baseAtXNot1}건 — 좌표 유일성 가정 위반(조사 필요)`);
  if (deltaCoachSum !== 0) fails.push(`(판정2 테스트B) 감독좌표 유저주입 증분 총합 ${deltaCoachSum}(기대 0) — 가드가 충돌을 못 막음`);
  if (freeTested === 0) fails.push(`(판정2 대조A) 자유좌표 표본 0 — 대조 불가(허위 오라클 위험)`);
  else if (deltaFreeSum !== freeTested) fails.push(`(판정2 대조A) 자유좌표 유저주입 증분 총합 ${deltaFreeSum}≠표본 ${freeTested} — 유저 개입 경로 불활성 의심`);
  if (byteFails > 0) fails.push(`(판정3) 무개입 바이트 불일치 ${byteFails}/${byteTested}건`);

  log(`\n═══ 좌표-중복 타임아웃 가드 (§4.6) ═══`);
  log(`  표본 감독home비테크TO경기 ${qualified} · 판정1 좌표TO=1 ${pass1}/${qualified}`);
  log(`  판정2 A/B: 테스트B(감독좌표) 증분합 ${deltaCoachSum} (Δ0 기대) · 대조A(자유좌표) 증분합 ${deltaFreeSum}/${freeTested} (Δ+1 기대)`);
  log(`  판정3 무개입 바이트동일 ${byteTested - byteFails}/${byteTested}`);
  if (fails.length === 0) {
    log(`  ✓ PASS — 판정1(좌표 TO 1개) · 판정2(가드가 충돌만 억제 Δ0 vs Δ+1) · 판정3(무개입 바이트 동일) 전부 통과`);
    process.exit(0);
  } else {
    log(`  ✗ FAIL — ${fails.length}건:`);
    for (const m of fails) log(`      ${m}`);
    process.exit(1);
  }
}

main();
