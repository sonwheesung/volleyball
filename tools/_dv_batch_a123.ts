// A1/A2/A3 배치 검증(2026-07-08) — DO NOT COMMIT용 임시 프루프.
//   A1: computeStandings(-1)/seasonMatchProds(-1)가 시뮬 없이 ~0ms 즉시 빈 결과(콜드).
//   A2: 오늘 경기 기록 직후 벤치 건의 fromDay가 기록된 경기일을 소급 변경하지 않음(fromDay > playedThroughDay).
//   A3: unbench가 삭제 아니라 종결일(toDay)을 박아 과거(치른) 벤치는 유지, 미래는 복귀.
import './_gt_mock';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, SEASON, currentRosters } = await import('../data/league');
  const { computeStandings, seasonResults, playedThroughDay } = await import('../data/standings');
  const { seasonMatchProds } = await import('../data/production');
  const { availableTeamPlayers, setOwnerContext } = await import('../data/dynamics');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  let pass = 0, fail = 0;
  const check = (n: string, ok: boolean, d = '') => { (ok ? pass++ : fail++); console.log(`  ${ok ? '✅' : '❌ FAIL'} ${n}${d ? ' — ' + d : ''}`); };

  // ─── A1: -1 컷오프는 시뮬 없이 즉시 (콜드) ───
  console.log('═══ A1 빈 구간 가드(콜드 타이밍) ═══');
  G().resetSave(); G().selectTeam(my);
  // 콜드: allResults/allProdRows 캐시가 아직 비었을 때 -1을 먼저 잰다.
  let t = performance.now(); const s_1 = computeStandings(-1); const tS = performance.now() - t;
  t = performance.now(); const r_1 = seasonResults(-1); const tR = performance.now() - t;
  t = performance.now(); const m_1 = seasonMatchProds(-1); const tM = performance.now() - t;
  // 대조: 실제 시뮬을 도는 풀시즌(콜드) — -1이 이보다 훨씬 빨라야(=시뮬 안 함) 증명
  t = performance.now(); const sFull = computeStandings(Number.MAX_SAFE_INTEGER); const tFull = performance.now() - t;
  const emptyOk = seasonResults(-1).length === 0 && s_1.every((x) => x.played === 0) && m_1.length === 0;
  check('A1 -1 결과 빔', emptyOk, `standings played 합 ${s_1.reduce((a, x) => a + x.played, 0)} · matchProds ${m_1.length} · results ${r_1.length}`);
  check('A1 -1 콜드 즉시(시뮬 미접촉)', tS < 20 && tR < 20 && tM < 20 && tFull > tS * 3,
    `computeStandings(-1)=${tS.toFixed(2)}ms · seasonResults(-1)=${tR.toFixed(2)}ms · seasonMatchProds(-1)=${tM.toFixed(2)}ms · vs 풀시즌 콜드=${tFull.toFixed(1)}ms`);

  // ─── A2: 오늘 경기 기록 직후 벤치 건의 소급 방지 ───
  console.log('═══ A2 기록 직후 건의 fromDay > 기록일 ═══');
  {
    // 내 팀 경기 픽스처를 dayIndex 순으로 — 앞의 3경기를 "기록"(results)하고 currentDay를 그 마지막 기록일에 둔다(watchProgress 비움 = 방금 기록·setDay 전).
    const myFix = SEASON.filter((f) => f.homeTeamId === my || f.awayTeamId === my).sort((a, b) => a.dayIndex - b.dayIndex);
    const recorded = myFix.slice(0, 3);
    const lastRecDay = recorded[recorded.length - 1].dayIndex;
    const results: Record<string, unknown> = {};
    for (const f of recorded) results[f.id] = { seed: 1 };
    G().resetSave(); G().selectTeam(my); setOwnerContext([]);
    useGameStore.setState({ results: results as any, currentDay: lastRecDay, watchProgress: {} });
    const ptd = playedThroughDay(G().results as any);
    // 수락되는 선수를 찾아 건의 → fromDay 확인
    let dir: { playerId: string; fromDay: number } | undefined;
    for (const pid of currentRosters()[my] ?? []) {
      useGameStore.setState({ benchDirectives: [], benchCooldown: {} });
      setOwnerContext([]);
      if (G().suggestBench(pid, 'noResign').ok) { dir = G().benchDirectives[G().benchDirectives.length - 1]; break; }
    }
    if (!dir) check('A2 수락 케이스', false, '벤치 수락 0');
    else {
      check('A2 fromDay > playedThroughDay (기록일 소급 안 됨)', dir.fromDay > ptd, `fromDay=${dir.fromDay} playedThroughDay=${ptd} lastRecDay=${lastRecDay}`);
      check('A2 fromDay != 기록된 경기일 (구버그였다면 == lastRecDay)', dir.fromDay !== lastRecDay, `fromDay=${dir.fromDay} vs lastRecDay=${lastRecDay}`);
      // 소급 리플레이 무변경: 기록된 경기일 어디에도 이 지시가 걸리지 않아야(availableTeamPlayers에 그 선수 존재)
      const affectsRecorded = recorded.some((f) => !availableTeamPlayers(my, f.dayIndex).some((p) => p.id === dir!.playerId));
      check('A2 기록된 경기일 라인업 무변경(소급 0)', !affectsRecorded, `기록일 ${recorded.map((f) => f.dayIndex).join(',')} 중 영향=${affectsRecorded}`);
    }
  }

  // ─── A3: unbench = 종결일(과거 유지·미래 복귀) ───
  console.log('═══ A3 unbench 종결일(과거 유지·미래 복귀) ═══');
  {
    G().resetSave(); G().selectTeam(my); setOwnerContext([]);
    const myFix = SEASON.filter((f) => f.homeTeamId === my || f.awayTeamId === my).sort((a, b) => a.dayIndex - b.dayIndex);
    // 벤치 대상: fromDay=0에 벤치했을 때, 과거일(pastDay=중간 기록일)엔 라인업에서 빠지고, 무벤치 기준으론 두 날 다 출전 가능한 선수 찾기
    const pastFix = myFix[4], futFix = myFix[10];
    const pastDay = pastFix.dayIndex, futDay = futFix.dayIndex;
    setOwnerContext([]);
    const availPast0 = new Set(availableTeamPlayers(my, pastDay).map((p) => p.id));
    const availFut0 = new Set(availableTeamPlayers(my, futDay).map((p) => p.id));
    const P = (currentRosters()[my] ?? []).find((id) => availPast0.has(id) && availFut0.has(id) && LEAGUE.players.find((pl) => pl.id === id)?.position !== 'L');
    if (!P) { check('A3 대상 선수', false, '무벤치 기준 두 날 다 출전하는 비리베로 없음'); }
    else {
      // 기록: pastDay까지 치름(playedThroughDay=pastDay). 벤치 fromDay=0 활성.
      const results: Record<string, unknown> = {};
      for (const f of myFix) if (f.dayIndex <= pastDay) results[f.id] = { seed: 1 };
      useGameStore.setState({ results: results as any, currentDay: futDay, benchDirectives: [{ playerId: P, fromDay: 0 }] });
      setOwnerContext([{ playerId: P, fromDay: 0 }]);
      const benchedPastBefore = !availableTeamPlayers(my, pastDay).some((p) => p.id === P);
      const benchedFutBefore = !availableTeamPlayers(my, futDay).some((p) => p.id === P);
      check('A3 벤치 활성 시 과거·미래 둘 다 제외', benchedPastBefore && benchedFutBefore, `past제외=${benchedPastBefore} fut제외=${benchedFutBefore}`);
      // 철회
      G().unbench(P);
      const dir = G().benchDirectives.find((b) => b.playerId === P);
      const toDay = dir?.toDay;
      const benchedPastAfter = !availableTeamPlayers(my, pastDay).some((p) => p.id === P);   // 과거(치른) 유지 → 여전히 제외
      const backFutAfter = availableTeamPlayers(my, futDay).some((p) => p.id === P);          // 미래 복귀 → 출전
      check('A3 unbench 삭제 아님(배열 잔존 + toDay 박힘)', !!dir && toDay != null, `dir존재=${!!dir} toDay=${toDay}`);
      check('A3 toDay == playedThroughDay(과거 경계)', toDay === playedThroughDay(G().results as any), `toDay=${toDay} playedThroughDay=${playedThroughDay(G().results as any)}`);
      check('A3 과거(치른) 경기 벤치 유지(본 역사 보존)', benchedPastAfter, `past제외 유지=${benchedPastAfter}`);
      check('A3 미래(미관전) 경기 복귀', backFutAfter, `fut복귀=${backFutAfter}`);
    }
  }

  console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — pass ${pass} / fail ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
})();
