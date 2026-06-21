// FOCUSED REPRO #3 — a team can exceed ROSTER_MAX (18) after endSeason offseason
// orchestration. Found by clean monkey (seed 777). Here we reproduce purely with
// endSeason on a fresh universe + light, legit FA/draft/release churn, and report the
// first season where ANY team's committed roster exceeds ROSTER_MAX or ROSTER_TOTAL+buffer.
import './_gt_mock';

(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, currentRosters, getPlayer } = await import('../data/league');
  const { availableFAsOnDay } = await import('../data/dynamics');
  const { ROSTER_MAX } = await import('../engine/transactions');
  const { checkCommittedRosters } = await import('./_gt_invariants');

  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;

  // A) pure endSeason, no player actions at all — does offseason alone ever oversize a team?
  G().resetSave(); G().selectTeam(my);
  let firstPure = -1;
  for (let s = 0; s < 80; s++) {
    G().endSeason();
    const rs = currentRosters();
    for (const t of LEAGUE.teams) {
      const sz = (rs[t.id] ?? []).length;
      if (sz > ROSTER_MAX) { if (firstPure < 0) { firstPure = s; console.log(`[PURE] season ${s}: ${t.id} size=${sz} > ROSTER_MAX(${ROSTER_MAX})`); } }
    }
  }
  console.log(`[A] pure-endSeason 80 seasons: first oversize season = ${firstPure} (>=0 means BUG without any player action)`);

  // B) endSeason + my-team sign/release churn (legit, own roster only) — does it oversize MY or AI teams?
  G().resetSave(); G().selectTeam(my);
  let rsd = 777 >>> 0; const rnd = () => { rsd = (rsd*1103515245+12345)&0x7fffffff; return rsd/0x7fffffff; };
  let firstChurn = -1; let firstTeam = '';
  for (let s = 0; s < 80; s++) {
    // some in-season churn on my own roster + FA signs
    for (let k = 0; k < 8; k++) {
      const r = rnd();
      const mine = currentRosters()[my] ?? [];
      if (r < 0.4) { const id = mine[Math.floor(rnd()*mine.length)]; if (id) G().release(id); }
      else if (r < 0.7) { const pool = availableFAsOnDay(G().currentDay); const id = pool[Math.floor(rnd()*pool.length)]; if (id) G().signInSeason(id); }
      else G().setDay(Math.floor(rnd()*164));
    }
    G().endSeason();
    const v = checkCommittedRosters(`churn-s${s}`).filter(x => x.check === 'rosterSize');
    if (v.length && firstChurn < 0) { firstChurn = s; firstTeam = v[0].msg; console.log(`[CHURN] season ${s}: ${v[0].msg}`); }
  }
  console.log(`[B] endSeason+churn 80 seasons: first oversize season = ${firstChurn} ${firstTeam}`);

  console.log(`\nOVERSIZE BUG present = ${firstPure >= 0 || firstChurn >= 0}`);
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
