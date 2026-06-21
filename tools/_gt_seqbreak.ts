// SEQUENCE-BREAK — endSeason called with no/partial games played, repeatedly,
// and interleaved offseason actions out of order. Check no crash / no soft-lock /
// rosters stay valid. (endSeason has NO guard requiring the season to be complete.)
import './_gt_mock';

(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, currentRosters } = await import('../data/league');
  const inv = await import('./_gt_invariants');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;

  let fails = 0;
  const check = (tag: string) => { const v = inv.checkCommittedRosters(tag); if (v.length) { fails += v.length; for (const x of v.slice(0,3)) console.log(`  FAIL ${x.msg}`); } };

  // 1) endSeason 50x with zero games played each season
  G().resetSave(); G().selectTeam(my);
  for (let i = 0; i < 50; i++) {
    G().endSeason();
    check(`zerogame-s${i}`);
  }
  console.log(`[A] 50x endSeason @ day0: season=${G().season} cash=${G().cash} fails=${fails}`);

  // 2) offseason actions BEFORE any game, then endSeason; then sign/draft toggles after endSeason
  G().resetSave(); G().selectTeam(my);
  G().signFA('whatever'); G().toggleDraftPick('x'); G().toggleProtect('y'); G().setResign('z', false);
  G().endSeason();
  check('preseason-actions');
  G().signFA('after'); G().toggleProtect('after2');
  G().endSeason();
  check('post-actions');
  console.log(`[B] out-of-order offseason actions: season=${G().season} fails=${fails}`);

  // 3) interleave setDay backward (should be monotonic — setDay uses Math.max) then endSeason
  G().resetSave(); G().selectTeam(my);
  G().setDay(100); const d1 = G().currentDay;
  G().setDay(10);  const d2 = G().currentDay; // should NOT go backward
  console.log(`[C] setDay(100) then setDay(10): day ${d1} -> ${d2} (monotonic = ${d2 === 100})`);
  G().endSeason();
  console.log(`    after endSeason day reset to ${G().currentDay} (expect 0)`);
  check('setday-backward');

  // 4) resetSave mid-everything then immediately endSeason (no team selected)
  G().resetSave();
  let threw = false;
  try { G().endSeason(); } catch (e: any) { threw = true; console.log(`[D] endSeason with no team selected THREW: ${e?.message}`); }
  if (!threw) console.log(`[D] endSeason with no team selected: did not throw, season=${G().season}`);

  console.log(`\nSEQ-BREAK total roster-invariant fails = ${fails}`);
  process.exit(fails ? 2 : 0);
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
