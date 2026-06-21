// DETERMINISM + SAVE/RELOAD — (1) same seed + same action sequence → identical store
// state. (2) serialize (partialize) -> rehydrate -> derived standings/rosters identical.
import './_gt_mock';

(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, currentRosters } = await import('../data/league');
  const { computeStandings } = await import('../data/standings');
  const { availableFAsOnDay } = await import('../data/dynamics');

  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;

  // deterministic action script (legit-ish, with some endSeasons)
  function runScript(seed: number): any {
    let rsd = seed >>> 0;
    const rnd = () => { rsd = (rsd * 1103515245 + 12345) & 0x7fffffff; return rsd / 0x7fffffff; };
    G().resetSave();
    G().selectTeam(my);
    for (let i = 0; i < 400; i++) {
      const r = rnd();
      const mine = currentRosters()[my] ?? [];
      if (r < 0.2) G().setDay(Math.floor(rnd() * 164));
      else if (r < 0.35) { const id = mine[Math.floor(rnd()*mine.length)]; if (id) G().release(id); }
      else if (r < 0.45) { const pool = availableFAsOnDay(G().currentDay); const id = pool[Math.floor(rnd()*pool.length)]; if (id) G().signInSeason(id); }
      else if (r < 0.55) G().setAggressive(rnd() < 0.5);
      else if (r < 0.62) { const id = mine[Math.floor(rnd()*mine.length)]; if (id) G().setResign(id, rnd()<0.5); }
      else if (r < 0.66) G().endSeason();
      else if (r < 0.8) { const id = mine[Math.floor(rnd()*mine.length)]; if (id) G().toggleProtect(id); }
      else G().setKeepAsian(rnd()<0.5 ? null : true);
    }
    // capture a signature of final state
    return {
      season: G().season, day: G().currentDay, cash: G().cash,
      rosters: JSON.stringify(currentRosters()),
      standings: JSON.stringify(computeStandings(Number.MAX_SAFE_INTEGER).map(s=>[s.teamId,s.points,s.wins,s.losses])),
      released: JSON.stringify(G().released.slice().sort()),
      archive: G().archive.length, milestones: G().milestones.length, hof: G().hallOfFame.length,
    };
  }

  const a = runScript(424242);
  const b = runScript(424242);
  const detOk = JSON.stringify(a) === JSON.stringify(b);
  console.log(`=== DETERMINISM ===`);
  console.log(`same seed twice identical = ${detOk}`);
  if (!detOk) { for (const k of Object.keys(a)) if ((a as any)[k] !== (b as any)[k]) console.log(`  DIFF ${k}: ${String((a as any)[k]).slice(0,60)} vs ${String((b as any)[k]).slice(0,60)}`); }

  // different seed should (almost surely) differ — sanity that the signature is sensitive
  const c = runScript(999);
  console.log(`different seed differs = ${JSON.stringify(a) !== JSON.stringify(c)} (sanity)`);

  // === SAVE / RELOAD (REAL persist config — false-oracle 교정) ===
  // 기존 버전은 partialize/onRehydrate를 직접 베껴서 검사 → 진짜 store 설정이 바뀌어 필드가 누락돼도
  // 못 잡는 허위 오라클이었다. 여기선 `useGameStore.persist`의 **실제** partialize·onRehydrateStorage를
  // 호출한다 → partialize 누락·rehydrate 단계 누락이 derived state 차이로 드러난다.
  const { resetLeagueBase, getTeamCoach } = await import('../data/league');
  const { setTxContext, setOwnerContext } = await import('../data/dynamics');
  const { setAwardScores } = await import('../data/awardSalary');
  const persist = (useGameStore as any).persist;
  const realPartialize = persist.getOptions().partialize as (s: any) => any;
  const realRehydrate = persist.getOptions().onRehydrateStorage as () => (s: any) => void;

  // derived state 서명 — 순위/로스터/현금/시즌/내 감독(commitStaff·coachPool 복원 확인)/훈련포커스
  const sig = () => JSON.stringify({
    stand: computeStandings(Number.MAX_SAFE_INTEGER).map(s => [s.teamId, s.points, s.wins, s.losses]),
    rosters: currentRosters(),
    cash: G().cash, season: G().season, day: G().currentDay,
    coach: getTeamCoach(my)?.id ?? null,
    focus: getTeamCoach(my)?.trainingFocus ?? null,
  });

  let rsd = 31337;
  const rnd = () => { rsd = (rsd * 1103515245 + 12345) & 0x7fffffff; return rsd / 0x7fffffff; };
  G().resetSave(); G().selectTeam(my);
  for (let i = 0; i < 150; i++) {
    const mine = currentRosters()[my] ?? [];
    const r = rnd();
    if (r < 0.25) G().setDay(Math.floor(rnd() * 164));
    else if (r < 0.4) { const id = mine[Math.floor(rnd() * mine.length)]; if (id) G().release(id); }
    else if (r < 0.5) { const pool = availableFAsOnDay(G().currentDay); const id = pool[Math.floor(rnd() * pool.length)]; if (id) G().signInSeason(id); }
    else if (r < 0.55) G().endSeason();
    else if (r < 0.65) { const c = getTeamCoach(my); if (c?.trainingFocus) G().setTrainingFocus(c.trainingFocus); } // 유효 focus 객체 재설정(영속 경로 자극)
    else if (r < 0.75) { const id = mine[Math.floor(rnd() * mine.length)]; if (id) G().toggleProtect(id); }
  }
  const before = sig();

  // 실제 partialize 산출물(영속되는 그대로) → 리로드 흉내(모듈 컨텍스트 wipe + 실제 rehydrate)
  const saved = JSON.parse(JSON.stringify(realPartialize(G())));
  const reload = (savedState: any) => {
    resetLeagueBase(); setTxContext([], [], ''); setOwnerContext([]); setAwardScores([]); // 리로드=컨텍스트 초기화
    realRehydrate()(savedState);          // 실제 onRehydrateStorage
    useGameStore.setState(savedState);    // 영속된 store 필드 복원(파생 셀렉터가 G().cash 등 읽음)
  };
  reload(saved);
  const after = sig();
  const saveOk = before === after;

  // A/B 자가검증: 영속 필드(rosters)를 일부러 누락 → 차이로 검출해야(허위 오라클 아님)
  const broken = JSON.parse(JSON.stringify(saved)); delete broken.rosters;
  reload(broken);
  const abDetected = sig() !== before;
  reload(saved); // 원복

  console.log(`\n=== SAVE/RELOAD (real persist) ===`);
  console.log(`real partialize+rehydrate identical = ${saveOk}`);
  console.log(`[A/B] partialize 필드(rosters) 누락 검출 = ${abDetected} (true여야 신뢰)`);
  if (!saveOk) { const a = JSON.parse(before), b = JSON.parse(after); for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.log(`  DIFF ${k}`); }

  const allOk = detOk && saveOk && abDetected;
  console.log(`\nDETERMINISM+SAVE OK = ${allOk}`);
  process.exit(allOk ? 0 : 2);
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
