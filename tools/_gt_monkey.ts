// MONKEY FUZZER — drive the real store with thousands of random adversarial action
// sequences, checking invariants every step. Seed-deterministic + replayable.
// Usage: npx tsx tools/_gt_monkey.ts [steps] [seed]
import './_gt_mock';
import type { Violation } from './_gt_invariants';

(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, currentRosters, getPlayer, evolveOnDay, availableCoaches, availableAssistants, availableScouts } = await import('../data/league');
  const { availableFAsOnDay, rosterIdsOnDay } = await import('../data/dynamics');
  const { faMarketPreview } = await import('../data/offseason');
  const inv = await import('./_gt_invariants');
  const { SEASON } = await import('../data/league');

  const STEPS = parseInt(process.argv[2] ?? '5000', 10);
  const SEED = parseInt(process.argv[3] ?? '12345', 10);
  const CLEAN_RELEASE = process.argv[4] === 'clean'; // only release my own roster (isolate non-release bugs)

  // deterministic RNG
  let rs = SEED >>> 0;
  const rnd = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
  const pick = <T>(a: T[]): T | undefined => (a.length ? a[Math.floor(rnd() * a.length)] : undefined);
  const randId = () => { // sometimes a totally bogus id (adversarial)
    const r = rnd();
    if (r < 0.15) return ''; // empty
    if (r < 0.3) return 'NONEXISTENT_' + Math.floor(rnd() * 1e6);
    const rs2 = currentRosters();
    const all = Object.values(rs2).flat();
    return pick(all) ?? 'x';
  };

  const matchdays = [...new Set(SEASON.map((f) => f.dayIndex))].sort((a, b) => a - b);

  const t0 = LEAGUE.teams[0].id;
  useGameStore.getState().selectTeam(t0);

  const actionLog: string[] = [];
  let violations: Violation[] = [];
  let crashes: Array<{ step: number; action: string; err: string }> = [];

  const G = () => useGameStore.getState();

  // action menu
  const actions: { name: string; fn: () => void }[] = [
    { name: 'release', fn: () => { const id = CLEAN_RELEASE ? (pick(currentRosters()[G().selectedTeamId ?? ''] ?? []) ?? '') : randId(); G().release(id); } },
    { name: 'release-myreal', fn: () => { const ids = currentRosters()[G().selectedTeamId ?? ''] ?? []; const id = pick(ids); if (id) G().release(id); } },
    { name: 'unrelease', fn: () => { const id = pick(G().released) ?? randId(); G().unrelease(id); } },
    { name: 'reSign', fn: () => { // 적대 계약 섞기(음수·0·거대 연봉·비정상 연수) — EC-TX-04 커버리지 갭 보강
      const ids = currentRosters()[G().selectedTeamId ?? ''] ?? [];
      const id = (rnd() < 0.5 ? pick(ids) : randId()) ?? randId();
      const r = rnd();
      const salary = r < 0.3 ? -Math.floor(rnd() * 1e7) : r < 0.5 ? 0 : r < 0.7 ? Math.floor(rnd() * 1e9) : Math.floor(rnd() * 50000) + 3000;
      const years = rnd() < 0.3 ? Math.floor((rnd() - 0.5) * 10) : Math.floor(rnd() * 5) + 1;
      G().reSign(id, { salary, years, remaining: years, signedAtAge: 25 });
    } },
    { name: 'signInSeason', fn: () => { const day = G().currentDay; const pool = availableFAsOnDay(day); const id = (CLEAN_RELEASE || rnd() < 0.5) ? pick(pool) : randId(); if (id !== undefined) G().signInSeason(id); } },
    { name: 'setDay', fn: () => { const r = rnd(); const d = r < 0.6 ? (pick(matchdays) ?? 0) : r < 0.85 ? Math.floor((rnd() - 0.3) * 400) : (r < 0.93 ? NaN : Infinity); G().setDay(d); if (!Number.isFinite(G().currentDay)) throw new Error(`currentDay 오염=${G().currentDay} (EC-ST-01 — setDay NaN/Inf 미가드)`); } },
    { name: 'recordResult', fn: () => { const f = pick(SEASON); if (f) G().recordResult({ fixtureId: f.id, homeSets: Math.floor(rnd()*4), awaySets: Math.floor(rnd()*4) }); } },
    { name: 'signFA', fn: () => G().signFA(randId()) },
    { name: 'unsignFA', fn: () => G().unsignFA(pick(Object.keys(G().faOffers)) ?? randId()) },
    { name: 'setResign', fn: () => G().setResign(randId(), rnd() < 0.5) },
    { name: 'toggleProtect', fn: () => G().toggleProtect(randId()) },
    { name: 'toggleMoneyOnly', fn: () => G().toggleMoneyOnly(randId()) },
    { name: 'toggleDraftPick', fn: () => G().toggleDraftPick(randId()) },
    { name: 'setAggressive', fn: () => G().setAggressive(rnd() < 0.5) },
    { name: 'hireCoach', fn: () => { const c = pick(availableCoaches(G().selectedTeamId ?? '')); G().hireCoach(c?.id ?? randId()); } },
    { name: 'fireCoach', fn: () => G().fireCoach() },
    { name: 'resignCoach', fn: () => G().resignCoach() },
    { name: 'hireAssistant', fn: () => { const a = pick(availableAssistants()); G().hireAssistant(a?.id ?? randId()); } },
    { name: 'releaseAssistant', fn: () => G().releaseAssistant(randId()) },
    { name: 'hireScout', fn: () => { const s = pick(availableScouts()); G().hireScout(s?.id ?? randId()); } },
    { name: 'releaseScout', fn: () => G().releaseScout(randId()) },
    { name: 'suggestBench', fn: () => G().suggestBench(randId(), pick(['noResign','form','prospect'] as any) as any) },
    { name: 'suggestStart', fn: () => G().suggestStart(randId()) },
    { name: 'unbench', fn: () => G().unbench(randId()) },
    { name: 'replaceForeign', fn: () => G().replaceForeign(pick(G().foreignAltPool) ?? randId()) },
    { name: 'replaceAsian', fn: () => G().replaceAsian(pick(G().asianAltPool) ?? randId()) },
    { name: 'toggleTryoutWish', fn: () => G().toggleTryoutWish(randId()) },
    { name: 'toggleAsianWish', fn: () => G().toggleAsianWish(randId()) },
    { name: 'setKeepForeign', fn: () => G().setKeepForeign(rnd() < 0.33 ? null : rnd() < 0.5) },
    { name: 'setKeepAsian', fn: () => G().setKeepAsian(rnd() < 0.33 ? null : rnd() < 0.5) },
    { name: 'endSeason', fn: () => G().endSeason() },
    { name: 'requestInterview', fn: () => { const id = randId(); try { G().requestInterview(id, pick(['reinforce','starter','raise','franchise'] as any) as any); } catch {} } },
  ];

  const checkNow = (tag: string) => {
    const my = G().selectedTeamId ?? '';
    const day = G().currentDay;
    const v = inv.checkAll(tag, my, day);
    if (v.length) violations.push(...v.map((x) => ({ check: x.check, msg: `[step ${actionLog.length}] ${x.msg}` })));
    return v.length;
  };

  // initial sanity
  checkNow('init');

  for (let step = 0; step < STEPS; step++) {
    // endSeason is heavy + rare to avoid running away; weight it down
    let a = pick(actions)!;
    if (a.name === 'endSeason' && rnd() > 0.04) a = actions[Math.floor(rnd() * (actions.length - 1))];
    actionLog.push(a.name);
    try {
      a.fn();
    } catch (e: any) {
      crashes.push({ step, action: a.name, err: e?.message ?? String(e) });
      if (crashes.length > 30) break;
    }
    // check invariants every step (lightweight subset) + full check periodically
    try {
      if (step % 50 === 0) checkNow(a.name);
      else {
        // cheap per-step: roster size + ownership
        const my = G().selectedTeamId ?? '';
        const v = inv.checkCommittedRosters(a.name).concat(inv.checkDayOwnership(a.name, G().currentDay));
        if (v.length) violations.push(...v.map((x) => ({ check: x.check, msg: `[step ${step}:${a.name}] ${x.msg}` })));
      }
    } catch (e: any) {
      crashes.push({ step, action: 'INVARIANT_CHECK', err: e?.message ?? String(e) });
    }
    if (violations.length > 200) break;
  }

  // dedup violations by check+msg-head
  const seen = new Set<string>();
  const uniq = violations.filter((v) => { const k = v.check + '|' + v.msg.replace(/step \d+/,'').replace(/\d+/g,'#').slice(0,80); if (seen.has(k)) return false; seen.add(k); return true; });

  console.log(`\n=== MONKEY seed=${SEED} steps=${STEPS} ===`);
  console.log(`crashes=${crashes.length} violationsTotal=${violations.length} uniqueViolations=${uniq.length}`);
  console.log(`final season=${G().season} day=${G().currentDay} cash=${G().cash}`);
  if (crashes.length) {
    console.log('\n--- CRASHES (first 15) ---');
    for (const c of crashes.slice(0, 15)) console.log(`step ${c.step} [${c.action}]: ${c.err}`);
  }
  if (uniq.length) {
    console.log('\n--- UNIQUE VIOLATIONS (first 40) ---');
    for (const v of uniq.slice(0, 40)) console.log(`(${v.check}) ${v.msg}`);
  }
  if (!crashes.length && !violations.length) console.log('\nNO CRASHES, NO INVARIANT VIOLATIONS.');
  // exit code reflects findings for CI-style use
  process.exit(crashes.length || violations.length ? 2 : 0);
})().catch((e) => { console.error('HARNESS FAIL', e); process.exit(1); });
