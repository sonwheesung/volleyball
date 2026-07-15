// 시나리오 테스트 — "경기 지휘" 설정 토글(MATCH_INTERVENTION_SYSTEM §4.1) 스토어 레벨.
//   store.setCoachMode(manual) → coachModeLog forward-only append(같은 날 덮어쓰기) → dynamics.setCoachModeLog로
//   파생 캐시 무효화 + manualSideFor 라우팅. 엔진 축·라우팅 자체는 _dv_manual_side가 검증(상보).
//   여기선 **스토어 액션이 로그를 올바르게 쌓고 dynamics에 배선하는지**를 검사:
//   (a) 기본 [] = manualSideFor 전 날짜 undefined
//   (b) setCoachMode(true)@D 후 dayIndex≥D만 내 팀 사이드, <D는 undefined(forward-only)
//   (c) 같은 날 재토글 = 그 날 항목 1개만 유지(로그 무한 증가 방지)
//   (d) false 복귀@D2 후 dayIndex≥D2 = undefined(자동 복귀)
//   (e) setCoachMode 호출이 파생 캐시 bump(currentTxVersion 증가) 유발
//   npx tsx tools/_gt_coachmode.ts
import './_gt_mock';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE } = await import('../data/league');
  const { manualSideFor, currentTxVersion, getCoachModeLog } = await import('../data/dynamics');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const other = LEAGUE.teams[1].id;
  const third = LEAGUE.teams[2].id;
  const fourth = LEAGUE.teams[3].id;

  let pass = 0, fail = 0;
  const check = (name: string, ok: boolean, detail = '') => { (ok ? pass++ : fail++); console.log(`  ${ok ? '✅' : '❌ FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
  // resetSave→selectTeam: coachModeLog=[]·myTeamId=my·currentDay=0
  const setup = () => { G().resetSave(); G().selectTeam(my); };

  console.log('═══ "경기 지휘" 설정 토글 스토어 가드(§4.1) ═══');

  // (a) 기본 [] = 전 날짜 undefined(현행 바이트 동일 기준)
  { setup();
    const emptyState = G().coachModeLog.length === 0 && getCoachModeLog().length === 0;
    const allUndef = manualSideFor(my, other, 0) === undefined && manualSideFor(my, other, 40) === undefined && manualSideFor(my, other, 200) === undefined;
    check('(a) 기본 [] → dynamics []·manualSideFor 전 날짜 undefined', emptyState && allUndef); }

  // (b) setCoachMode(true)@D → forward-only(≥D만 내 팀 사이드, <D undefined)
  const D = 40;
  { setup(); G().setDay(D); G().setCoachMode(true);
    const before = manualSideFor(my, other, D - 1);       // < D → 자동(undefined)
    const atHome = manualSideFor(my, other, D);            // ≥ D, 내 팀 홈 → home
    const atAway = manualSideFor(other, my, D + 10);       // ≥ D, 내 팀 원정 → away
    const unrelated = manualSideFor(third, fourth, D + 10); // 내 팀 무관 경기 → undefined
    check('(b) forward-only: dayIndex<D = undefined(자동 유지)', before === undefined, `(${String(before)})`);
    check('(b) forward-only: dayIndex≥D 내 팀 홈 = home', atHome === 'home', `(${String(atHome)})`);
    check('(b) forward-only: 내 팀 원정 = away', atAway === 'away', `(${String(atAway)})`);
    check('(b) 내 팀 무관 경기 = undefined', unrelated === undefined, `(${String(unrelated)})`);
    check('(b) 로그 1항목(day=D, manual=true)', G().coachModeLog.length === 1 && G().coachModeLog[0].day === D && G().coachModeLog[0].manual === true); }

  // (c) 같은 날 재토글 = 그 날 항목 1개만 유지
  { setup(); G().setDay(D);
    G().setCoachMode(true); G().setCoachMode(false); G().setCoachMode(true);
    const sameDay = G().coachModeLog.filter((c) => c.day === D);
    check('(c) 같은 날 3회 토글 → 항목 1개 유지', G().coachModeLog.length === 1 && sameDay.length === 1);
    check('(c) 마지막 토글값 유지(true)', sameDay[0]?.manual === true, `(${String(sameDay[0]?.manual)})`); }

  // (d) false 복귀@D2 → dayIndex≥D2 = undefined(자동 복귀), [D,D2)는 수동 유지
  const D2 = 80;
  { setup(); G().setDay(D); G().setCoachMode(true); G().setDay(D2); G().setCoachMode(false);
    const midManual = manualSideFor(my, other, D2 - 1);  // [D, D2) → 아직 수동(home)
    const afterOff = manualSideFor(my, other, D2);        // ≥ D2 → 자동(undefined)
    check('(d) [D,D2) 구간 = 수동 유지(home)', midManual === 'home', `(${String(midManual)})`);
    check('(d) false 복귀 후 dayIndex≥D2 = undefined(자동)', afterOff === undefined, `(${String(afterOff)})`);
    check('(d) 로그 2항목(D:true, D2:false)', G().coachModeLog.length === 2 && G().coachModeLog[1].day === D2 && G().coachModeLog[1].manual === false); }

  // (e) setCoachMode 호출이 파생 캐시 bump(currentTxVersion 증가)
  { setup(); G().setDay(D);
    const v0 = currentTxVersion();
    G().setCoachMode(true);
    const v1 = currentTxVersion();
    G().setCoachMode(false);
    const v2 = currentTxVersion();
    check('(e) setCoachMode 호출 시 currentTxVersion 증가(캐시 무효화)', v1 > v0 && v2 > v1, `(${v0}→${v1}→${v2})`); }

  console.log(`\n═══ 결과: ${pass} PASS · ${fail} FAIL ═══`);
  console.log(fail === 0 ? '✅ 전 시나리오 통과' : '❌ 실패 시나리오 있음 — 위 ❌ 확인');
  process.exit(fail === 0 ? 0 : 1);
})();
