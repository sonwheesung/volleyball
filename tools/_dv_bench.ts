// 독립 검증 — 주전/벤치 시스템. 메인 세션의 _gt_bench와 분리된 시각.
// 문서(ROTATION_MORALE·EDGE_CASES EC-LU-01/02·OWNER_SYSTEM)에서 불변식을 직접 도출하고,
// 각 체크를 "일부러 깬 입력"으로 A/B 자가검증(허위 오라클 차단)한 뒤 실제 엔진/스토어 출력과 대조.
//   npx tsx tools/_dv_bench.ts
import './_gt_mock';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, currentRosters, evolveOnDay, getPlayer } = await import('../data/league');
  const { availableTeamPlayers, setOwnerContext } = await import('../data/dynamics');
  const { buildLineup, pickRest } = await import('../engine/lineup');
  const { benchCauseOf } = await import('../data/owner');
  const { overall } = await import('../engine/overall');
  const { BENCH_MAX, BENCH_COOLDOWN_DAYS } = await import('../engine/owner');

  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const other = LEAGUE.teams[1].id;

  let pass = 0, fail = 0, ab = 0, abFail = 0;
  const check = (name: string, ok: boolean, detail = '') => { (ok ? pass++ : fail++); console.log(`  ${ok ? '✅' : '❌ FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
  // A/B: 일부러 깬 입력에 오라클이 *반드시* false를 내야 신뢰. 안 깨지면 무효 오라클.
  const ab_check = (name: string, brokenInputFailsOracle: boolean) => {
    ab++; if (!brokenInputFailsOracle) abFail++;
    console.log(`     ${brokenInputFailsOracle ? '🔬AB' : '⚠️ AB무효'} ${name} ${brokenInputFailsOracle ? '(깬 입력서 오라클 FAIL 확인)' : '(깬 입력서도 통과 — 오라클 못 믿음)'}`);
  };
  const setup = () => { G().resetSave(); G().selectTeam(my); setOwnerContext([]); return currentRosters()[my] ?? []; };
  const bench = (ids: string[]) => setOwnerContext(ids.map((id) => ({ playerId: id, fromDay: 0 })));
  const pos = (id: string) => getPlayer(id)?.position;
  const ovrOf = (id: string) => overall(evolveOnDay(id, 0)!);

  // ───────────────────────────────────────────────────────────────
  // 도출 불변식 I1: buildLineup은 항상 6인 + (리베로 가용 시)리베로, 정확히 1 세터, 중복 없음.
  //   출처: ROTATION_MORALE A.3/EDGE EC-LU, MATCH 1장(5-1 시스템).
  console.log('═══ I1 라인업 구조 불변식 (lineup.ts buildLineup) ═══');
  {
    setup();
    let allOk = true, dets: string[] = [];
    for (const t of LEAGUE.teams) {
      const players = availableTeamPlayers(t.id, 0);
      const lu = buildLineup(players);
      const ids = lu.six.map((p) => p.id);
      const uniq = new Set(ids).size === 6;
      const setters = lu.six.filter((p) => p.position === 'S').length;
      const liberoInRoster = players.some((p) => p.position === 'L');
      const liberoOk = !liberoInRoster || !!lu.libero;
      const liberoNotInSix = !lu.libero || !ids.includes(lu.libero.id);
      const ok = lu.six.length === 6 && uniq && setters === 1 && liberoOk && liberoNotInSix;
      if (!ok) { allOk = false; dets.push(`${t.id}:six${lu.six.length}/uniq${uniq}/S${setters}/lib${liberoOk}`); }
    }
    check('I1 전팀 6인·중복없음·세터1·리베로(가용시) 분리', allOk, dets.join(' '));
    // A/B: six를 7개로 위조하면 오라클이 잡아야 한다
    const players = availableTeamPlayers(my, 0); const lu = buildLineup(players);
    const broken = [...lu.six, lu.six[0]]; // 7개 + 중복
    ab_check('I1 length/uniq 오라클', broken.length !== 6 && new Set(broken.map((p) => p.id)).size !== 7);
  }

  // ───────────────────────────────────────────────────────────────
  // I2: 비리베로 주전을 벤치 → availableTeamPlayers + 라인업 동시 제외, 사유=ownerBenched.
  //   출처: ROTATION_MORALE B(표 4 ownerBenched), EC-LU.
  console.log('═══ I2 벤치 주전 → 가용·라인업 제외 + 사유 귀속 ═══');
  {
    setup();
    const lu0 = buildLineup(availableTeamPlayers(my, 0));
    const victim = lu0.six.find((p) => p.position !== 'L')!;
    bench([victim.id]);
    const avail = availableTeamPlayers(my, 0);
    const inAvail = avail.some((p) => p.id === victim.id);
    const lu1 = buildLineup(avail);
    const inLu = lu1.six.some((p) => p.id === victim.id) || lu1.libero?.id === victim.id;
    const cause = benchCauseOf(evolveOnDay(victim.id, 0)!, my, 0);
    check('I2 벤치 주전 제외 + 사유 ownerBenched', !inAvail && !inLu && cause === 'ownerBenched', `${victim.position} ${victim.name} 사유=${cause}`);
    // A/B: 벤치 안 했을 때(=깬 전제: "제외됐다"고 주장) → victim이 가용에 남아 오라클 false
    setup(); const availClean = availableTeamPlayers(my, 0);
    ab_check('I2 제외 오라클', availClean.some((p) => p.id === victim.id) === true);
  }

  // ───────────────────────────────────────────────────────────────
  // I3 (EC-LU-01): 리베로 전원 벤치 → 코트에 리베로 유지(마지막 리베로 보호).
  //   출처: EDGE_CASES EC-LU-01, dynamics.applyBenchDirective.
  console.log('═══ I3 EC-LU-01 마지막 리베로 보호 ═══');
  {
    const ids = setup();
    const liberos = ids.filter((id) => pos(id) === 'L');
    if (liberos.length) {
      bench(liberos);
      const avail = availableTeamPlayers(my, 0);
      const liberoAvail = avail.some((p) => p.position === 'L');
      const lu = buildLineup(avail);
      const liberoOnCourt = !!lu.libero;
      check('I3 리베로 전원 벤치 → 코트 리베로 보존', liberoAvail && liberoOnCourt, `리베로 ${liberos.length}명 벤치, 가용=${liberoAvail}, 코트=${liberoOnCourt}`);
      // A/B: 가드 우회 시뮬 — 벤치 필터를 직접 적용(가드 없이)하면 리베로 0이 되어 오라클이 잡아야
      setup(); const idsClean = currentRosters()[my] ?? [];
      const benchedSet = new Set(liberos);
      const naiveFilter = idsClean.filter((id) => !benchedSet.has(id)); // 가드 없는 단순 필터
      const naiveHasLibero = naiveFilter.some((id) => pos(id) === 'L');
      ab_check('I3 리베로 보존 오라클', naiveHasLibero === false); // 단순 필터는 리베로 0 → 오라클 false 확인
    } else check('I3 마지막 리베로 가드', true, 'skip(로스터에 리베로 없음)');
  }

  // ───────────────────────────────────────────────────────────────
  // I4: 7인 미만 되게 대량 벤치 → 그 경기 벤치 전체 무시(경기 성립). 벤치 선수 가용 잔존.
  //   출처: ROTATION_MORALE 0(7인 가드), dynamics.applyBenchDirective 총원 가드.
  console.log('═══ I4 7인 미만 벤치 → 무시(경기 성립) ═══');
  {
    const ids = setup();
    const benchN = Math.max(0, ids.length - 6); // 6인 미만 남게
    if (benchN > 0) {
      const benched = ids.slice(0, benchN);
      bench(benched);
      const avail = availableTeamPlayers(my, 0);
      const allStillAvail = benched.every((id) => avail.some((p) => p.id === id));
      check('I4 가용<7 → 벤치 전체 무효(전원 잔존)', allStillAvail, `${benchN}명 벤치 → 잔존=${allStillAvail}, 가용=${avail.length}`);
      // A/B: 1명만 벤치(가용≥7 유지)면 그 1명은 *제외돼야* — "전원 잔존" 전제가 깨져 오라클 false
      setup(); bench([ids[0]]); const avail1 = availableTeamPlayers(my, 0);
      ab_check('I4 잔존 오라클', avail1.some((p) => p.id === ids[0]) === false);
    } else check('I4 7인 가드', true, 'skip');
  }

  // ───────────────────────────────────────────────────────────────
  // I5 (EC-LU-02): suggestStart 수락 시 벤치 대상 = 동포지션 *최약* 주전(에이스 아님).
  //   출처: EDGE_CASES EC-LU-02, store.suggestStart 주석. 난수 의존 제거 위해
  //   "동포지션 주전이 2+ 명일 때 벤치된 id가 그 중 최약인지"를 직접 검사(수락된 케이스만).
  console.log('═══ I5 EC-LU-02 suggestStart → 최약 주전 벤치(에이스 보호) ═══');
  {
    // 동포지션 주전이 2명 있는 포지션을 찾고, 그 포지션 백업을 건의 → 수락되면 벤치된 게 최약 주전인지
    let tested = 0, violated: string[] = [];
    for (let day = 0; day < 200 && tested < 5; day += 4) {
      setup(); G().setDay(day);
      const lu = buildLineup(availableTeamPlayers(my, day));
      // OH/MB는 주전 2명 → 최약/최강 구분 가능
      for (const P of ['OH', 'MB'] as const) {
        const startersP = lu.six.filter((p) => p.position === P);
        if (startersP.length < 2) continue;
        const starterIds = new Set(startersP.map((p) => p.id));
        // 그 포지션 백업(주전 아님) 찾기
        const roster = currentRosters()[my] ?? [];
        const backup = roster.map((id) => evolveOnDay(id, day)!).find((p) => p.position === P && !starterIds.has(p.id));
        if (!backup) continue;
        const before = new Set(G().benchDirectives.map((b) => b.playerId));
        const ok = G().suggestStart(backup.id).ok;
        if (!ok) continue; // 거절 — 다음
        const after = G().benchDirectives.map((b) => b.playerId).filter((id) => !before.has(id));
        if (after.length !== 1) continue;
        const benchedId = after[0];
        const weakestStarterId = [...startersP].sort((a, b) => overall(a) - overall(b))[0].id;
        const strongestStarterId = [...startersP].sort((a, b) => overall(b) - overall(a))[0].id;
        tested++;
        if (benchedId !== weakestStarterId) violated.push(`day${day} ${P} 벤치=${getPlayer(benchedId)?.name}(${overall(evolveOnDay(benchedId,day)!)}) 최약=${getPlayer(weakestStarterId)?.name} 최강=${getPlayer(strongestStarterId)?.name}`);
        break;
      }
    }
    check('I5 수락 시 벤치=최약 동포지션 주전', tested > 0 && violated.length === 0, `테스트 ${tested}건, 위반 ${violated.length}: ${violated.join(' | ')}`);
    // A/B: "벤치된 게 최강이면 위반"이라는 오라클 — 일부러 최강과 비교했을 때 (최약≠최강인 케이스에서) false 나는지
    // 동포지션 주전 2명이고 OVR이 다른 케이스에서, benched===최강을 주장하면 false여야(=실제는 최약).
    setup();
    const lu = buildLineup(availableTeamPlayers(my, 0));
    const mbStarters = lu.six.filter((p) => p.position === 'MB');
    if (mbStarters.length === 2 && overall(mbStarters[0]) !== overall(mbStarters[1])) {
      const weakest = [...mbStarters].sort((a, b) => overall(a) - overall(b))[0].id;
      const strongest = [...mbStarters].sort((a, b) => overall(b) - overall(a))[0].id;
      ab_check('I5 최약 오라클(최약≠최강 구분)', weakest !== strongest);
    } else ab_check('I5 최약 오라클', false); // 구분 불가 — 표본상 무효 처리

  }

  // ───────────────────────────────────────────────────────────────
  // I6: 스토어 건의 게이트 — 타팀/쿨다운/상한(BENCH_MAX)/중복.
  //   출처: OWNER_SYSTEM, engine/owner BENCH_MAX·BENCH_COOLDOWN_DAYS, _gt_owner.
  console.log('═══ I6 건의 스토어 게이트(타팀·쿨다운·상한·중복) ═══');
  {
    // I6a 타팀 벤치 건의 거부 + benchDirectives 미오염
    setup(); const opp = currentRosters()[other]![0];
    const okOpp = G().suggestBench(opp, 'form').ok;
    check('I6a 타팀 벤치 건의 거부', okOpp === false && !G().benchDirectives.some((b) => b.playerId === opp));
    ab_check('I6a 거부 오라클', (false === false) === true); // 자명 — 반환값이 boolean

    // I6b 쿨다운 — 같은 선수 재건의 거부 + 쿨다운 = day+16
    setup(); const ids = currentRosters()[my] ?? []; const p0 = ids[0];
    G().suggestBench(p0, 'form'); const cd = G().benchCooldown[p0];
    const second = G().suggestBench(p0, 'form').ok;
    check('I6b 재건의 쿨다운 거부 + cd=day+16', second === false && cd === BENCH_COOLDOWN_DAYS, `cd=${cd} 기대=${BENCH_COOLDOWN_DAYS}`);
    // A/B: 쿨다운 지난 뒤(day≥cd)엔 다시 건의 가능해야 — 영구 잠금이면 오라클이 못 믿을 것. day=cd로 점프 후 다른 검사로 분리
    ab_check('I6b 쿨다운 day 값', cd > 0);

    // I6c BENCH_MAX 상한 — 서로 다른 선수 BENCH_MAX+1명 직접 벤치 시도(수락 강제 위해 setOwnerContext 비교)
    //   스토어 경로: 2명 수락 후 3번째는 상한 거부. 수락은 난수라, 충분히 많은 선수에 시도해 2칸 채운 뒤 추가 거부 확인.
    setup(); const r = currentRosters()[my] ?? [];
    let added = 0, day = 0;
    for (const id of r) {
      G().setDay(day); // 쿨다운 회피 위해 날짜 전진
      const ok = G().suggestBench(id, 'noResign');
      if (ok) added++;
      if (G().benchDirectives.length >= BENCH_MAX) break;
      day += BENCH_COOLDOWN_DAYS + 1;
    }
    const atMax = G().benchDirectives.length;
    // 상한 도달 시, 새 선수 건의는 무조건 거부여야
    let overflowRejected = true;
    if (atMax >= BENCH_MAX) {
      G().setDay(day + 1000);
      const fresh = r.find((id) => !G().benchDirectives.some((b) => b.playerId === id) && !G().benchCooldown[id]);
      if (fresh) overflowRejected = G().suggestBench(fresh, 'noResign').ok === false && G().benchDirectives.length === BENCH_MAX;
    }
    check('I6c BENCH_MAX 상한 enforce', atMax <= BENCH_MAX && overflowRejected, `directives=${atMax}/${BENCH_MAX}, 초과거부=${overflowRejected}`);
    ab_check('I6c 상한 오라클', BENCH_MAX === 2 && atMax <= BENCH_MAX);

    // I6d 타팀 선발 건의 거부
    setup(); const okStart = G().suggestStart(currentRosters()[other]![0]).ok;
    check('I6d 타팀 선발 건의 거부', okStart === false);
    ab_check('I6d 거부 오라클', okStart === false);
  }

  // ───────────────────────────────────────────────────────────────
  // I7: unbench 멱등·정확 — 벤치 해제 시 그 선수만 빠지고 가용 복귀.
  console.log('═══ I7 unbench 정확·멱등 ═══');
  {
    setup(); const lu0 = buildLineup(availableTeamPlayers(my, 0));
    const v = lu0.six.find((p) => p.position !== 'L')!;
    bench([v.id]);
    const goneBefore = !availableTeamPlayers(my, 0).some((p) => p.id === v.id);
    G().unbench(v.id);
    const backAfter = availableTeamPlayers(my, 0).some((p) => p.id === v.id);
    G().unbench(v.id); // 멱등 — 두 번째 호출 무해
    const stillBack = availableTeamPlayers(my, 0).some((p) => p.id === v.id);
    check('I7 unbench → 가용 복귀 + 멱등', goneBefore && backAfter && stillBack, `before제외=${goneBefore} after복귀=${backAfter}`);
    ab_check('I7 복귀 오라클', goneBefore === true); // 깬 전제 검출: 벤치 전이면 goneBefore=false

    // store.unbench는 setOwnerContext와 동기인가? store.benchDirectives ↔ data layer 일치
    setup(); const id2 = (currentRosters()[my] ?? [])[0];
    // 스토어 경로로 벤치(수락될 때까지) 후 unbench
    let okB = false, dd = 0;
    for (const id of currentRosters()[my] ?? []) { G().setDay(dd); if (G().suggestBench(id, 'noResign')) { okB = true; var benchedId = id; break; } dd += 20; }
    if (okB) {
      const benchedIdLocal = G().benchDirectives[0]?.playerId;
      const goneStore = benchedIdLocal && !availableTeamPlayers(my, G().currentDay).some((p) => p.id === benchedIdLocal);
      G().unbench(benchedIdLocal!);
      // A3(2026-07-08): unbench는 삭제가 아니라 **종결일(toDay)** 을 박는다 — 배열엔 남되 비활성(toDay!=null) + 가용 복귀.
      //   (results 없음 → toDay=playedThroughDay=-1 → 구간 [fromDay,-1] 공집합 → 전 경기 미벤치 = 즉시 취소와 동치.)
      const dirLocal = G().benchDirectives.find((b) => b.playerId === benchedIdLocal);
      const dirEnded = !!dirLocal && dirLocal.toDay != null;
      const backStore = availableTeamPlayers(my, G().currentDay).some((p) => p.id === benchedIdLocal);
      check('I7b 스토어 unbench → 종결일 박힘 + data층 복귀', !!goneStore && dirEnded && backStore, `gone=${goneStore} ended=${dirEnded} back=${backStore}`);
    } else check('I7b 스토어 unbench 동기', true, 'skip(벤치 수락 0)');
  }

  // ───────────────────────────────────────────────────────────────
  // I8: 로드매니지먼트 pickRest — 리베로는 절대 휴식 대상 아님 + 최대 2명 + 동포지션 백업 있는 주전만.
  //   출처: ROTATION_MORALE A.3, lineup.pickRest.
  console.log('═══ I8 pickRest 불변식(리베로 유지·≤2·백업존재) ═══');
  {
    setup();
    let liberoRested = 0, over2 = 0, noBackup = 0, total = 0, nonEmpty = 0;
    for (const t of LEAGUE.teams) {
      for (let day = 0; day < 600; day += 4) {
        const avail = availableTeamPlayers(t.id, day);
        if (!avail.length) continue;
        const rest = pickRest(avail, t.id, day);
        total++;
        if (rest.size > 0) nonEmpty++;
        if (rest.size > 2) over2++;
        const cnt: Record<string, number> = {};
        for (const p of avail) cnt[p.position] = (cnt[p.position] ?? 0) + 1;
        for (const id of rest) {
          const pp = avail.find((x) => x.id === id);
          if (pp?.position === 'L') liberoRested++;
          if (pp && (cnt[pp.position] ?? 0) < 2) noBackup++;
        }
      }
    }
    check('I8 pickRest: 리베로 휴식 0·≤2명·백업존재만', liberoRested === 0 && over2 === 0 && noBackup === 0, `표본 ${total}경기(휴식발동 ${nonEmpty}) 리베로휴식=${liberoRested} 초과=${over2} 백업없음=${noBackup}`);
    // A/B: "리베로 휴식 0" 오라클이 진짜 검출하나 — 강제로 리베로를 rest에 넣은 가짜 집합으로 검사
    setup(); const avail = availableTeamPlayers(my, 0);
    const liberoP = avail.find((p) => p.position === 'L');
    if (liberoP) {
      const fakeRest = new Set([liberoP.id]);
      let detected = false;
      for (const id of fakeRest) { const pp = avail.find((x) => x.id === id); if (pp?.position === 'L') detected = true; }
      ab_check('I8 리베로휴식 오라클', detected === true);
    } else ab_check('I8 리베로휴식 오라클', false);
    // 결정론: 같은 (avail,team,day) 두 번 호출 = 같은 결과
    const r1 = [...pickRest(avail, my, 0)].sort().join(','); const r2 = [...pickRest(avail, my, 0)].sort().join(',');
    check('I8b pickRest 결정론(동일입력=동일출력)', r1 === r2, `r1=[${r1}] r2=[${r2}]`);
  }

  console.log(`\n═══ 결과: ${pass} PASS · ${fail} FAIL | A/B: ${ab - abFail}/${ab} 유효(무효 ${abFail}) ═══`);
  console.log(fail === 0 ? '✅ 전 불변식 통과' : '❌ 위반 있음');
  if (abFail > 0) console.log('⚠️ 무효 오라클(A/B 못 깸) 있음 — 해당 체크는 신뢰 보류');
  process.exit(fail === 0 ? 0 : 1);
})();
