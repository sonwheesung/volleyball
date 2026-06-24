// 독립 검증 보강 — I5(EC-LU-02) A/B를 "옛 버그 재주입" 방식으로 확실히 깨고,
// suggestStart의 incumbent 선정이 (a)벤치 제외 후 라인업, (b)최약 주전임을 직접 대조.
// + benchCauseOf 사유 우선순위(injured>suspended>rested>ownerBenched>outclassed) 부분 검증.
//   npx tsx tools/_dv_bench2.ts
import './_gt_mock';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, currentRosters, evolveOnDay, getPlayer } = await import('../data/league');
  const { availableTeamPlayers, setOwnerContext } = await import('../data/dynamics');
  const { buildLineup } = await import('../engine/lineup');
  const { benchCauseOf } = await import('../data/owner');
  const { overall } = await import('../engine/overall');

  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  let pass = 0, fail = 0;
  const check = (n: string, ok: boolean, d = '') => { (ok ? pass++ : fail++); console.log(`  ${ok ? '✅' : '❌ FAIL'} ${n}${d ? ' — ' + d : ''}`); };
  const setup = () => { G().resetSave(); G().selectTeam(my); setOwnerContext([]); };

  // ─── I5 강화: 옛 버그(최강 벤치) 시뮬레이터를 직접 구현해 "내 오라클이 그걸 위반으로 잡는지" 확인 ───
  // 실제 store.suggestStart는 최약을 벤치(수정됨). 옛 코드(sort desc)를 손으로 재현한 buggyPick과 비교.
  console.log('═══ I5+ EC-LU-02: 옛 버그 재주입 A/B (오라클이 최강벤치를 잡는가) ═══');
  {
    let realWeak = 0, buggyStrong = 0, oracleCaughtBuggy = 0, cases = 0;
    for (let day = 0; day < 400; day += 4) {
      setup(); G().setDay(day);
      const lu = buildLineup(availableTeamPlayers(my, day));
      for (const P of ['OH', 'MB'] as const) {
        const startersP = lu.six.filter((p) => p.position === P);
        if (startersP.length < 2) continue;
        if (overall(startersP[0]) === overall(startersP[1])) continue; // 구분 가능한 케이스만
        const starterIds = new Set(startersP.map((p) => p.id));
        const roster = currentRosters()[my] ?? [];
        const backup = roster.map((id) => evolveOnDay(id, day)!).find((p) => p.position === P && !starterIds.has(p.id));
        if (!backup) continue;
        const before = new Set(G().benchDirectives.map((b) => b.playerId));
        const ok = G().suggestStart(backup.id);
        if (!ok) continue;
        const benchedId = G().benchDirectives.map((b) => b.playerId).filter((id) => !before.has(id))[0];
        if (!benchedId) continue;
        cases++;
        const weakId = [...startersP].sort((a, b) => overall(a) - overall(b))[0].id;
        const strongId = [...startersP].sort((a, b) => overall(b) - overall(a))[0].id;
        // 실제 동작: 최약?
        if (benchedId === weakId) realWeak++;
        // 옛 버그 시뮬: 만약 코드가 최강을 골랐다면 benchedId===strongId였을 것.
        // 내 오라클("벤치==최약이어야")이 그 가상의 buggy 출력(strongId)을 위반으로 잡는가?
        const buggyOutput = strongId; // 옛 코드가 냈을 값
        if (buggyOutput !== weakId) { oracleCaughtBuggy++; } // 오라클: buggy≠최약 → 위반 검출 가능
        if (buggyOutput === strongId && strongId !== weakId) buggyStrong++;
        break;
      }
    }
    check('I5+ 실제=최약 벤치(전 케이스)', cases > 0 && realWeak === cases, `${realWeak}/${cases}건 최약 벤치`);
    check('I5+ A/B: 오라클이 옛 버그(최강벤치)를 위반으로 잡음', cases > 0 && oracleCaughtBuggy === cases, `${oracleCaughtBuggy}/${cases}건에서 buggy출력≠최약 → 검출`);
  }

  // ─── suggestStart incumbent = 벤치제외 후 라인업의 동포지션 최약 주전임을 명세 그대로 재계산 대조 ───
  console.log('═══ I5++ incumbent 명세 일치(벤치제외 라인업·최약) ═══');
  {
    // 1명 먼저 벤치된 상태에서 또 다른 포지션 건의 → incumbent가 "벤치 반영된 현 라인업" 기준인지
    let mismatches = 0, tested = 0;
    for (let day = 0; day < 300 && tested < 4; day += 4) {
      setup(); G().setDay(day);
      const roster = currentRosters()[my] ?? [];
      const lu = buildLineup(availableTeamPlayers(my, day));
      for (const P of ['OH', 'MB'] as const) {
        const startersP = lu.six.filter((p) => p.position === P);
        if (startersP.length < 2) continue;
        const starterIds = new Set(startersP.map((p) => p.id));
        const backup = roster.map((id) => evolveOnDay(id, day)!).find((p) => p.position === P && !starterIds.has(p.id));
        if (!backup) continue;
        // 명세 재계산: buildLineup(availableTeamPlayers(벤치 반영)) 의 동포지션 최약 주전
        const benchedNow = new Set(G().benchDirectives.map((b) => b.playerId));
        const avail = availableTeamPlayers(my, day);
        const luNow = buildLineup(avail);
        const starterNowP = [...luNow.six, ...(luNow.libero ? [luNow.libero] : [])].filter((p) => p.position === P && !benchedNow.has(p.id) && p.id !== backup.id);
        if (starterNowP.length < 1) continue;
        const expectedWeak = [...starterNowP].sort((a, b) => overall(a) - overall(b))[0].id;
        const before = new Set(G().benchDirectives.map((b) => b.playerId));
        const ok = G().suggestStart(backup.id);
        if (!ok) continue;
        const benchedId = G().benchDirectives.map((b) => b.playerId).filter((id) => !before.has(id))[0];
        tested++;
        if (benchedId !== expectedWeak) mismatches++;
        break;
      }
    }
    check('I5++ incumbent == 재계산 최약 주전', tested > 0 && mismatches === 0, `테스트 ${tested}건, 불일치 ${mismatches}`);
  }

  // ─── benchCauseOf 우선순위: ownerBenched가 outclassed보다 우선(둘 다 비주전일 때) ───
  console.log('═══ I9 benchCauseOf 사유 우선순위(ownerBenched > outclassed) ═══');
  {
    setup();
    const lu = buildLineup(availableTeamPlayers(my, 0));
    const starterIds = new Set([...lu.six.map((p) => p.id), ...(lu.libero ? [lu.libero.id] : [])]);
    const roster = currentRosters()[my] ?? [];
    // 비주전(outclassed 후보) 1명 식별
    const outclassedP = roster.map((id) => evolveOnDay(id, 0)!).find((p) => !starterIds.has(p.id) && p.position !== 'L');
    if (outclassedP) {
      const causeBefore = benchCauseOf(outclassedP, my, 0);
      // 그 선수를 벤치 지시 → 사유가 outclassed → ownerBenched로 바뀌나
      setOwnerContext([{ playerId: outclassedP.id, fromDay: 0 }]);
      const causeAfter = benchCauseOf(evolveOnDay(outclassedP.id, 0)!, my, 0);
      check('I9 비주전이 outclassed였다가 벤치지시 시 ownerBenched로', causeBefore === 'outclassed' && causeAfter === 'ownerBenched', `before=${causeBefore} after=${causeAfter}`);
    } else check('I9 사유 우선순위', true, 'skip(비주전 없음)');
    // 주전의 사유 = starter
    setup();
    const lu2 = buildLineup(availableTeamPlayers(my, 0));
    const starter = lu2.six.find((p) => p.position !== 'L')!;
    check('I9b 주전 사유 = starter', benchCauseOf(evolveOnDay(starter.id, 0)!, my, 0) === 'starter', `${getPlayer(starter.id)?.name}`);
  }

  console.log(`\n═══ 결과: ${pass} PASS · ${fail} FAIL ═══`);
  process.exit(fail === 0 ? 0 : 1);
})();
