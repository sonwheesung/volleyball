// DIRECT ADVERSARIAL — feed malicious inputs straight into data-layer pure functions
// (buildDraftContext / faMarketPreview / endSeason-equivalent) bypassing UI gates.
// Checks invariants on outputs. No store; operates on the live league registry which
// we reset between cases.
import './_gt_mock'; // for consistency (some transitive imports)

(async () => {
  const L = await import('../data/league');
  const { buildDraftContext } = await import('../data/draftSetup');
  const { faMarketPreview } = await import('../data/offseason');
  const { resolveDraft } = await import('../engine/draft');
  const { fillRosters } = await import('../data/rookies');
  const { ROSTER_MIN, ROSTER_MAX } = await import('../engine/transactions');
  const { LEAGUE_CAP } = await import('../engine/cap');
  const { domesticPayroll } = await import('../data/roster');
  const inv = await import('./_gt_invariants');
  const { aiTargetOf } = await import('../data/rosterTarget');

  let fails = 0;
  const FAIL = (name: string, msg: string) => { fails++; console.log(`  FAIL [${name}] ${msg}`); };
  const okList: string[] = [];

  // Run one offseason->draft->fill cycle with given adversarial params, then check rosters.
  function cycle(name: string, opts: {
    my?: string; resign?: Record<string, boolean>; faSign?: string[]; aggressive?: boolean;
    protect?: string[]; nextSeason?: number; cash?: number; tryoutWish?: string[]; asianWish?: string[];
    moneyOnly?: string[]; draftPicks?: string[]; keepForeign?: boolean | null; keepAsian?: boolean | null;
  }) {
    L.resetLeagueBase();
    const my = opts.my ?? L.LEAGUE.teams[0].id;
    L.setMyTeamStaff(my);
    try {
      const ctx = buildDraftContext(my, opts.resign ?? {}, {}, opts.faSign ?? [], opts.aggressive ?? false,
        opts.protect ?? [], opts.nextSeason ?? 1, undefined, opts.cash, opts.tryoutWish ?? [],
        opts.keepForeign ?? null, opts.moneyOnly ?? [], opts.asianWish ?? [], opts.keepAsian ?? null);
      const snapshot = ctx.snapshot;
      const styleOf = (tid: string) => L.getTeam(tid)?.coachStyle ?? 'balanced';
      const drafted = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], my, opts.draftPicks ?? [], styleOf, L.teamScoutReveal, [], aiTargetOf());
      for (const p of drafted.picked) snapshot[p.id] = p;
      const filled = fillRosters(drafted.rosters, (id) => snapshot[id], opts.nextSeason ?? 1);
      for (const r of filled.newPlayers) snapshot[r.id] = r;

      // commit and run the standard committed-roster invariants
      L.commitPlayerBase(snapshot);
      L.commitRosters(filled.rosters);
      const v = inv.checkCommittedRosters(name);
      if (v.length) { for (const x of v.slice(0, 4)) FAIL(name, x.msg); }
      else okList.push(name);
    } catch (e: any) {
      FAIL(name, `THREW: ${e?.message ?? e}`);
    }
  }

  console.log('=== DIRECT ADVERSARIAL (data layer) ===');

  // 1) bogus ids everywhere
  cycle('bogus-ids', { faSign: ['NOPE','','t99p99'], protect: ['ghost','',], draftPicks: ['xxx',''], tryoutWish: ['none'], asianWish: ['none'], moneyOnly: ['ghost'] });
  // 2) negative cash
  cycle('negative-cash', { cash: -999999 });
  // 3) zero cash, aggressive, huge wishlist of every league player (sign everyone)
  {
    L.resetLeagueBase();
    const my = L.LEAGUE.teams[0].id;
    const everyone = Object.values(L.currentRosters()).flat();
    cycle('cash0-sign-everyone', { cash: 0, aggressive: true, faSign: everyone, moneyOnly: everyone });
  }
  // 4) protect more than allowed (huge protect list)
  {
    const everyone = Object.values(L.currentRosters()).flat();
    cycle('protect-all', { protect: everyone });
  }
  // 5) resign decisions all false (release everyone) → must still fill to >= ROSTER_MIN
  {
    const mine = L.currentRosters()[L.LEAGUE.teams[0].id] ?? [];
    const allFalse: Record<string, boolean> = {};
    for (const id of mine) allFalse[id] = false;
    cycle('resign-all-false', { resign: allFalse });
  }
  // 6) giant season number
  cycle('huge-season', { nextSeason: 1e9 });
  // 7) negative season number
  cycle('neg-season', { nextSeason: -5 });
  // 8) NaN cash
  cycle('nan-cash', { cash: NaN });
  // 9) keepForeign/keepAsian true with no cash (should be gated → no import)
  cycle('keep-imports-broke', { cash: 0, keepForeign: true, keepAsian: true });
  // 10) draftPicks of every class id duplicated
  cycle('draft-dup-picks', { draftPicks: ['c1','c1','c1','bogus','bogus'] });

  // 11) MANY consecutive seasons from one universe (does it stay sound long-term?)
  L.resetLeagueBase();
  const my = L.LEAGUE.teams[0].id; L.setMyTeamStaff(my);
  let longFails = 0;
  for (let s = 1; s <= 60; s++) {
    try {
      const everyone = Object.values(L.currentRosters()).flat();
      const wish = everyone.slice(0, 3); // try to sign a few
      const ctx = buildDraftContext(my, {}, {}, wish, true, [], s, undefined, 99999999, [], null, [], [], null);
      const snapshot = ctx.snapshot;
      const styleOf = (tid: string) => L.getTeam(tid)?.coachStyle ?? 'balanced';
      const d = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => snapshot[id], my, [], styleOf, L.teamScoutReveal, [], aiTargetOf());
      for (const p of d.picked) snapshot[p.id] = p;
      const f = fillRosters(d.rosters, (id) => snapshot[id], s);
      for (const r of f.newPlayers) snapshot[r.id] = r;
      L.commitPlayerBase(snapshot); L.commitRosters(f.rosters);
      const v = inv.checkCommittedRosters(`long-s${s}`);
      if (v.length) { longFails++; if (longFails <= 3) for (const x of v.slice(0,3)) FAIL(`long-s${s}`, x.msg); }
    } catch (e: any) { FAIL(`long-s${s}`, `THREW ${e?.message ?? e}`); longFails++; }
  }
  if (!longFails) okList.push('60-season-soak');

  L.resetLeagueBase();
  console.log(`\nPASSED: ${okList.length} cases [${okList.join(', ')}]`);
  console.log(`TOTAL FAILS: ${fails}`);
  process.exit(fails ? 2 : 0);
})().catch((e) => { console.error('HARNESS FAIL', e); process.exit(1); });
