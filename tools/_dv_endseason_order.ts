// §7.8 endSeason 커밋-후-읽기 정합 가드 (설계 REALTIME_SIM_SYSTEM §7.8, #111) — 리뷰 재설계안 6종.
//   endSeason이 commitRosters(finalR)를 buildDraftContext 직전으로 내렸는지 + 끝난 시즌 산출물이 전부 **관전 우주**
//   (커밋 전)로 고정되는지 + 풀시뮬 0회인지를 실제 스토어를 구동해 검증한다. 읽기 전용(store 무수정 — 절대경로 import).
//
//   (a) tx0 무해성   : tx 없는 시즌 → archive 마지막 entry(standings/record/streaks/championId) == 커밋 전 오라클.
//   (b) tx 관전 오라클: 시즌 중 방출 주입 → 위와 동일 + careerTotals 델타 == 오라클 생산 합(수정 후 GREEN). teeth: 커밋이 순위를 오염시킴.
//   (e) 챔피언 정합  : (b) 안에서 관전 championId == archive championId(유저 가시 불변식).
//   (d) 풀시뮬 0회   : warm 상태 reset 후 endSeason → simulateMatch 호출 < 126(플옵 재실행만 허용).
//   (f) 주입 배관    : standingsWorstFirst() 라이브 != 커밋 전 캡처 && standingsWorstFirst(캡처) == 캡처(주입이 라이브를 이긴다).
//   (c) 변이 민감도  : 수동(보고만) — commitRosters를 986 원위치로 되돌리면 (b)(d) FAIL. cp 백업/복원(git checkout 금지).
//   Usage: npx tsx tools/_dv_endseason_order.ts

(async () => {
  const { pathToFileURL } = await import('node:url');
  const P = (p: string) => import(pathToFileURL('C:/project/volleyball/' + p).href);
  await P('tools/_gt_mock.ts'); // AsyncStorage/react-native 목 선설치(store 구동 전제)
  const { useGameStore } = await P('store/useGameStore.ts');
  const league = await P('data/league.ts');
  const st = await P('data/standings.ts');
  const pr = await P('data/production.ts');
  const dyn = await P('data/dynamics.ts');
  const po = await P('data/playoffs.ts');
  const mb = await P('data/matchBox.ts');
  const cal = await P('engine/calendar.ts');
  const ovr = await P('engine/overall.ts');
  const match = await P('engine/match.ts');
  const rt = await P('data/rosterTarget.ts');

  const MAX = Number.MAX_SAFE_INTEGER;
  const G = () => useGameStore.getState();
  const my = league.LEAGUE.teams[0].id;
  const J = (x: any) => JSON.stringify(x);
  const log = (m: string) => process.stdout.write(m + '\n');

  // 이번 시즌 최종 명단(store.endSeason과 동일 산식) — 시즌 중 이동 반영.
  const buildFinalR = (): Record<string, string[]> => {
    const cur = league.currentRosters();
    const finalR: Record<string, string[]> = {};
    for (const t of Object.keys(cur)) finalR[t] = [...cur[t]];
    for (const tx of dyn.seasonTxLog()) {
      const arr = finalR[tx.teamId] ?? [];
      if (tx.kind === 'release') finalR[tx.teamId] = arr.filter((id: string) => id !== tx.playerId);
      else if (!arr.includes(tx.playerId)) finalR[tx.teamId] = [...arr, tx.playerId];
    }
    return finalR;
  };

  // dev 시즌 완료(schedule.tsx devCompleteSeason 복제) — 내 팀 미치름 경기 결정론 기록 + 시즌말일.
  const completeSeason = () => {
    for (const f of league.SEASON) {
      if ((f.homeTeamId === my || f.awayTeamId === my) && !G().results[f.id]) {
        const { sim } = mb.buildMatchBox(f.homeTeamId, f.awayTeamId, f.dayIndex, f.seed, dyn.interventionsFor(f.id));
        G().recordResult({ fixtureId: f.id, homeSets: sim.homeSets, awaySets: sim.awaySets });
      }
    }
    G().setDay(cal.SEASON_DAYS);
  };

  // 내 팀 최고 OVR 국내 선수 id(방출 대상)
  const topDomestic = (): string => {
    const roster = (league.currentRosters()[my] ?? []).map((id: string) => league.getPlayer(id)).filter((p: any) => p && !p.isForeign);
    roster.sort((a: any, b: any) => ovr.overall(b) - ovr.overall(a));
    return roster[0].id;
  };

  // 커밋 전 관전 오라클 캡처(캐시 warm 상태 = 관전 우주). endedSeason 기준.
  const captureOracle = (endedSeason: number, finalR: Record<string, string[]>) => {
    const stand = st.computeStandings(MAX);
    const rankOrder = stand.map((s: any) => s.teamId);
    const record: Record<string, [number, number]> = {};
    for (const r of stand) record[r.teamId] = [r.wins, r.losses];
    const championId = po.buildPlayoffs(endedSeason).championId ?? '';
    const streaks = st.seasonStreaks(MAX);
    const prod = pr.leagueProduction(MAX);
    // 내 팀 시즌 생산 합(careerTotals 델타 검증용 — 생산 우주 teeth)
    let seasonPts = 0, seasonAces = 0;
    for (const id of finalR[my] ?? []) { const p = prod.get(id); if (p) { seasonPts += p.points; seasonAces += p.aces; } }
    const prodSig = J([...prod.entries()].sort((a: any, b: any) => a[0].localeCompare(b[0])));
    return { rankOrder, record, championId, streaks, seasonPts, seasonAces, prodSig };
  };

  const results: { label: string; pass: boolean; detail?: string }[] = [];
  const check = (label: string, pass: boolean, detail?: string) => { results.push({ label, pass, detail }); log(`  ${pass ? 'PASS' : 'FAIL'} · ${label}${detail ? ' — ' + detail : ''}`); };

  // ───────────────────────────────────────────────────────────────────────
  // (a) tx0 무해성 — 커밋 이동이 tx 없는 시즌 산출물을 안 바꾼다(관전 오라클과 일치, byte-동일 우주).
  // ───────────────────────────────────────────────────────────────────────
  log('\n═══ (a) tx0 무해성 ═══');
  {
    G().resetSave(); G().selectTeam(my); completeSeason();
    const endedSeason = G().season;
    const finalR = buildFinalR();
    const before = G().careerTotals;
    const o = captureOracle(endedSeason, finalR);
    G().endSeason();
    const entry = G().archive.find((e: any) => e.season === endedSeason);
    const after = G().careerTotals;
    check('archive standings == 오라클', !!entry && J(entry.standings) === J(o.rankOrder));
    check('archive record == 오라클', !!entry && J(entry.record) === J(o.record));
    check('archive streaks == 오라클', !!entry && J(entry.streaks) === J(o.streaks));
    check('archive championId == 오라클', !!entry && (entry.championId ?? '') === o.championId, `entry=${entry?.championId} oracle=${o.championId}`);
    check('careerTotals 델타 == 오라클 생산합', after.points - before.points === o.seasonPts && after.aces - before.aces === o.seasonAces,
      `Δpts=${after.points - before.points} oracle=${o.seasonPts}`);
  }

  // ───────────────────────────────────────────────────────────────────────
  // (b)(e) tx 관전 오라클 — 시즌 중 방출 주입 → 커밋 전 우주가 archive에 실린다. 수정 후 GREEN.
  // ───────────────────────────────────────────────────────────────────────
  log('\n═══ (b)(e) tx 시즌 관전 오라클 + 챔피언 정합 ═══');
  {
    G().resetSave(); G().selectTeam(my); completeSeason();
    const victim = topDomestic();
    const vName = league.getPlayer(victim)?.name;
    dyn.setTxContext([{ day: 81, teamId: my, playerId: victim, kind: 'release' }], [], my, 81); // 시즌 중 방출(day81)
    const endedSeason = G().season;
    const finalR = buildFinalR();
    const before = G().careerTotals;
    const o = captureOracle(endedSeason, finalR); // 방출이 반영된 관전 우주
    G().endSeason();
    const entry = G().archive.find((e: any) => e.season === endedSeason);
    const after = G().careerTotals;
    check(`archive standings == 관전 오라클 (방출 ${vName})`, !!entry && J(entry.standings) === J(o.rankOrder));
    check('archive record == 관전 오라클', !!entry && J(entry.record) === J(o.record));
    check('archive streaks == 관전 오라클', !!entry && J(entry.streaks) === J(o.streaks));
    check('(e) 관전 championId == archive championId', !!entry && (entry.championId ?? '') === o.championId, `entry=${entry?.championId} oracle=${o.championId}`);
    check('careerTotals 델타 == 관전 생산합 (생산 우주 teeth)', after.points - before.points === o.seasonPts && after.aces - before.aces === o.seasonAces,
      `Δpts=${after.points - before.points} oracle=${o.seasonPts}`);
  }

  // teeth — 커밋이 끝난 시즌 순위를 오염시킨다(순서가 중요함의 증명). 신선 시나리오에서 커밋 전/후 full standings 비교.
  log('\n═══ (b-teeth) commitRosters가 끝난 시즌 순위를 바꾼다 ═══');
  {
    G().resetSave(); G().selectTeam(my); completeSeason();
    const victim = topDomestic();
    dyn.setTxContext([{ day: 81, teamId: my, playerId: victim, kind: 'release' }], [], my, 81);
    const preCommit = J(st.computeStandings(MAX));
    league.commitRosters(buildFinalR()); // 끝난 시즌 읽기 전에 커밋하면(구 경로) 재작성 우주
    const postCommit = J(st.computeStandings(MAX));
    check('커밋 후 computeStandings(MAX) != 커밋 전(오염 증명)', preCommit !== postCommit);
  }

  // ───────────────────────────────────────────────────────────────────────
  // (d) 풀시뮬 0회 — warm 진입 endSeason 내 simulateMatch 호출 < 126(정규 전체 재시뮬 없음, 플옵 재실행만 허용).
  // ───────────────────────────────────────────────────────────────────────
  log('\n═══ (d) 풀시뮬 0회 ═══');
  {
    G().resetSave(); G().selectTeam(my); completeSeason();
    const endedSeason = G().season;
    const finalR = buildFinalR();
    captureOracle(endedSeason, finalR); // 캐시 warm(standings·production)
    st.seasonResults(MAX); // 결과 캐시도 warm
    match.debugSimCalls.reset();
    G().endSeason();
    const n = match.debugSimCalls.count();
    check('endSeason 내 simulateMatch < 126 (풀시뮬 없음)', n < 126, `호출=${n}`);
  }

  // ───────────────────────────────────────────────────────────────────────
  // (f) 주입 배관 정합 — standingsWorstFirst: 라이브 != 커밋 전 캡처 && 캡처 주입 시 캡처값 사용(주입이 라이브를 이긴다).
  // ───────────────────────────────────────────────────────────────────────
  log('\n═══ (f) 주입 배관 정합(standingsWorstFirst) ═══');
  {
    G().resetSave(); G().selectTeam(my); completeSeason();
    // 합성 순위(라이브를 뒤집음)를 주입해 "주입이 라이브를 이긴다"를 순위 안정성에 의존하지 않고 증명한다
    //   (커밋만으론 wins/losses는 바뀌어도 rank ORDER는 안 바뀔 수 있어 라이브≠주입이 성립 안 하므로 합성 주입 사용).
    const live = st.computeStandings(MAX);
    const liveWorst = J(st.standingsWorstFirst());                // = live 뒤집기(worst-first)
    const synthetic = [...live].reverse();                        // 뒤집은 순위 주입
    const injectedWorst = J(st.standingsWorstFirst(synthetic));   // = synthetic 뒤집기 = live 순서(best-first)
    check('standingsWorstFirst(주입) != 라이브(주입이 라이브를 이긴다)', injectedWorst !== liveWorst);
    check('standingsWorstFirst(주입) == 주입값 뒤집기(pre 인자 사용 증명)', injectedWorst === J(live.map((s: any) => s.teamId)));
    // aiTargetOf(pre) 동형(§7.8 5번째 사이트) — 주입 순위를 실제로 소비함을 확인. live 1위 팀은 라이브에선 rank1 목표,
    //   뒤집힌 주입에선 최하위 목표를 받아야 한다(pre가 라이브 재계산을 이긴다).
    const topTeam = live[0].teamId;
    const targLive = rt.aiTargetOf(live)(topTeam);
    const targInjected = rt.aiTargetOf(synthetic)(topTeam);
    check('aiTargetOf(주입) != aiTargetOf(라이브 순위)(pre 소비 증명)', targLive !== targInjected, `live=${targLive} injected=${targInjected}`);
  }

  // ── 요약 ──
  const passed = results.filter((r) => r.pass).length;
  const ok = passed === results.length;
  log(`\n${ok ? '✅' : '❌'} §7.8 endSeason 순서 가드: ${passed}/${results.length} PASS`);
  if (!ok) log('FAIL: ' + results.filter((r) => !r.pass).map((r) => r.label).join(' · '));
  process.exit(ok ? 0 : 2);
})();
