// FOCUSED REPRO #2 — signInSeason charges cash + counts an FA sign even when the
// underlying dynamics applyTx drops the sign (player still owned by another team).
// Money is debited for a roster move that never happens.
import './_gt_mock';

(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, currentRosters } = await import('../data/league');
  const { rosterIdsOnDay } = await import('../data/dynamics');

  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const victimTeam = LEAGUE.teams[2].id;

  G().selectTeam(my);
  const victimId = currentRosters()[victimTeam][0];
  G().setDay(0);
  G().release(victimId);            // phantom-release another team's player → enters FA pool

  const cashBefore = G().cash;
  const faSignsBefore = G().careerLog.faSigns;
  const signOk = G().signInSeason(victimId);
  const cashAfter = G().cash;
  const faSignsAfter = G().careerLog.faSigns;

  const onMine = rosterIdsOnDay(my, 0).includes(victimId);
  const onVictim = rosterIdsOnDay(victimTeam, 0).includes(victimId);

  console.log(`signInSeason returned=${signOk}`);
  console.log(`cash ${cashBefore} -> ${cashAfter}  (charged ${cashBefore - cashAfter})`);
  console.log(`careerLog.faSigns ${faSignsBefore} -> ${faSignsAfter}`);
  console.log(`player actually on MY roster after sign? ${onMine}  (still on ${victimTeam}? ${onVictim})`);
  console.log(`\nLEAK: charged=${cashBefore - cashAfter > 0}, faSignCounted=${faSignsAfter > faSignsBefore}, butPlayerNotAcquired=${!onMine}`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
