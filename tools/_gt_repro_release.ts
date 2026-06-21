// FOCUSED REPRO — store.release() does not verify the player is on MY roster.
// Releasing another team's player id injects a phantom release tx (teamId=my),
// which adds that player to the FA pool while they remain on their real team →
// single-ownership invariant broken, and they can be double-signed.
//
// A/B self-check: we also confirm the ownership check FIRES on a deliberately
// broken state and PASSES on a clean state (anti-false-oracle).
import './_gt_mock';

(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, currentRosters, getPlayer } = await import('../data/league');
  const { availableFAsOnDay, rosterIdsOnDay } = await import('../data/dynamics');
  const { checkDayOwnership } = await import('./_gt_invariants');

  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const victimTeam = LEAGUE.teams[2].id;

  // ---- A/B oracle proof: clean state must be CLEAN ----
  G().selectTeam(my);
  const cleanV = checkDayOwnership('clean', 0);
  console.log(`[oracle A] clean state violations = ${cleanV.length} (expect 0)`);

  // ---- EXPLOIT ----
  G().selectTeam(my);
  const victimId = currentRosters()[victimTeam][0]; // a player on team t2 (NOT mine)
  console.log(`victim ${victimId} initially on ${victimTeam}? ${currentRosters()[victimTeam].includes(victimId)}`);

  G().setDay(0);
  const relOk = G().release(victimId); // releasing a foreign-team player from MY front office
  console.log(`release(otherTeamPlayer) returned = ${relOk} (gate did NOT reject cross-team release)`);

  const day = 50;
  const faPool = availableFAsOnDay(day);
  const onVictimTeam = rosterIdsOnDay(victimTeam, day).includes(victimId);
  const inFa = faPool.includes(victimId);
  console.log(`day${day}: victim still on ${victimTeam}=${onVictimTeam}, also in FA pool=${inFa}`);

  const exploitV = checkDayOwnership('exploit', day);
  console.log(`[oracle B] exploit-state violations = ${exploitV.length} (expect >0)`);
  for (const v of exploitV.slice(0, 5)) console.log('   ', v.msg);

  // ---- DOUBLE-SIGN: now my team signs the phantom-FA → on two teams at once ----
  // signInSeason needs the id to be in availableFAsOnDay AND not already signed.
  const signOk = G().signInSeason(victimId);
  console.log(`signInSeason(phantomFA) = ${signOk}`);
  if (signOk) {
    const onMine = rosterIdsOnDay(my, day).includes(victimId);
    const stillVictim = rosterIdsOnDay(victimTeam, day).includes(victimId);
    console.log(`AFTER SIGN day${day}: on MY team=${onMine}, on ${victimTeam}=${stillVictim}  -> DOUBLE OWNERSHIP=${onMine && stillVictim}`);
    const v2 = checkDayOwnership('double', day);
    console.log(`double-ownership violations = ${v2.length}`);
    for (const v of v2.slice(0, 6)) console.log('   ', v.msg);
  }

  // ---- SIDE EFFECT 3: phantom releases poison myRosterDelta → DoS my own release gate ----
  // myRosterDelta.size counts ALL released ids (incl. phantom non-roster ids) → believes roster
  // is at ROSTER_MIN after ~6 phantom releases, blocking legitimate self-releases.
  G().selectTeam(my);
  G().setDay(0);
  let phantom = 0;
  for (const id of currentRosters()[victimTeam]) { if (G().release(id)) phantom++; }
  let myReleased = 0;
  for (const id of [...currentRosters()[my]]) { if (G().release(id)) myReleased++; }
  console.log(`\n[DoS] phantom cross-team releases accepted=${phantom}, then my OWN releases accepted=${myReleased} (expected ~6, got ${myReleased})`);
  console.log(`[DoS] my real roster still ${rosterIdsOnDay(my,0).length} but self-release blocked = ${myReleased === 0}`);

  const cleanPass = cleanV.length === 0;
  const exploitCaught = exploitV.length > 0;
  console.log(`\nORACLE VALID: cleanPass=${cleanPass} exploitCaught=${exploitCaught} (both must be true)`);
  console.log(`BUG CONFIRMED: cross-team release accepted = ${relOk}, phantom FA created = ${inFa}`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
