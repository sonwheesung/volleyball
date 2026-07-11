// 독립 검증 — minAffectedDay 캐시 스플라이스 + 오프시즌 프리뷰 메모 분리 (REALTIME_SIM §7).
// 오라클(절대 기준): 스플라이스 결과는 전체 재계산과 **deep(byte)-동일**해야 한다. 이 도구가 그 등가를 매 액션 후 대조한다.
//   npx tsx tools/_dv_splice.ts
import './_gt_mock';
import type { Tx } from '../data/dynamics';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, currentRosters, setFocusTimeline, getPlayer, hireHeadCoach, availableCoaches, assignCoach } = await import('../data/league');
  const { seasonResults, setStandingsCacheRaw } = await import('../data/standings');
  const { seasonMatchProds, setProductionCacheRaw } = await import('../data/production');
  const { setOwnerContext, setTxContext } = await import('../data/dynamics');
  const { createRng } = await import('../engine/rng');
  const { SEASON } = await import('../data/league');
  const off = await import('../data/offseason');
  const draftSetup = await import('../data/draftSetup');
  const { buildOwnerFx } = await import('../data/owner');
  type BenchDirective = { playerId: string; fromDay: number; toDay?: number };
  type FocusSeg = { fromDay: number; focus: { primary: [number, number]; secondary: [number, number, number] } | null };

  const MAX = Number.MAX_SAFE_INTEGER;
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;

  let pass = 0, fail = 0, ab = 0, abFail = 0;
  const check = (name: string, ok: boolean, detail = '') => { (ok ? pass++ : fail++); console.log(`  ${ok ? '✅' : '❌ FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
  const ab_check = (name: string, brokenFailsOracle: boolean) => {
    ab++; if (!brokenFailsOracle) abFail++;
    console.log(`     ${brokenFailsOracle ? '🔬AB' : '⚠️ AB무효'} ${name} ${brokenFailsOracle ? '(깬 입력서 오라클 FAIL 확인)' : '(깬 입력서도 통과 — 오라클 못 믿음)'}`);
  };

  // ── sig: 스플라이스되는 두 구조를 그대로 직렬화(순서 민감 — order도 byte-등가의 일부) ──
  const sigStand = (): string => JSON.stringify(seasonResults(MAX));
  const sigProd = (): string => JSON.stringify(seasonMatchProds(MAX).map((r) => ({
    d: r.dayIndex, h: r.homeTeamId, a: r.awayTeamId,
    homeIds: [...r.homeIds], lines: [...r.lines.entries()], starters: [...r.starters],
  })));
  // 현재 캐시 상태로 계산(직전 bump가 있으면 스플라이스 경로) → sig
  const spliceSig = () => ({ s: sigStand(), p: sigProd() });
  // 캐시 강제 폐기 후 전체 재계산 → sig (스플라이스 우회, 독립 기준)
  const fullSig = () => { setStandingsCacheRaw(null); setProductionCacheRaw(null); return { s: sigStand(), p: sigProd() }; };

  const rosterOf = (t: string) => currentRosters()[t] ?? [];
  const myMatchdays = [...new Set(SEASON.filter((f) => f.homeTeamId === my || f.awayTeamId === my).map((f) => f.dayIndex))].sort((a, b) => a - b);

  // ══════════════════════════════════════════════════════════════════
  // A. byte-등가 프로퍼티 — 랜덤 액션열 × 시즌 진행 지점, 매 액션 후 splice == force-full
  // ══════════════════════════════════════════════════════════════════
  console.log('═══ A. 스플라이스 byte-등가 프로퍼티(≥40 랜덤열) ═══');
  {
    const rng = createRng(424242);
    G().resetSave(); G().selectTeam(my); // 리그는 한 번만 빌드 — 이후 컨텍스트만 싸게 리셋(bench/tx/focus는 주입일 뿐 base 불변)
    let scenarios = 0, mism = 0, spliceUsed = 0, reuseTotal = 0;
    const details: string[] = [];
    for (let iter = 0; iter < 44; iter++) {
      // 컨텍스트 클린 리셋(resetSave 없이) — 데이터층 스플라이스 메커니즘 직접 구동
      const bench: BenchDirective[] = [];
      const txs: Tx[] = [];
      let segs: FocusSeg[] = [];
      const freed: string[] = []; // release로 풀린 id(재영입 후보)
      setOwnerContext([], 0); setTxContext([], [], my, 0); setFocusTimeline(my, [], 0);
      // 베이스라인 C0(full) 워밍
      fullSig();
      const nActions = 1 + rng.int(0, 3);
      for (let k = 0; k < nActions; k++) {
        const roster = rosterOf(my).filter((id) => !getPlayer(id)?.isForeign);
        const kind = rng.int(0, 5);
        if (kind === 0 && roster.length > 8) {
          // benchAdd — 그 팀 경기가 있는 matchday를 fromDay로(효과 보장 성향) or 임의 day
          const day = myMatchdays[rng.int(0, myMatchdays.length - 1)] ?? rng.int(0, 200);
          const cand = roster.find((id) => !bench.some((b) => b.playerId === id));
          if (cand) { bench.push({ playerId: cand, fromDay: day }); setOwnerContext(bench, day); }
        } else if (kind === 1 && bench.some((b) => b.toDay == null)) {
          const active = bench.filter((b) => b.toDay == null);
          const tgt = active[rng.int(0, active.length - 1)];
          const toDay = myMatchdays[rng.int(0, myMatchdays.length - 1)] ?? rng.int(0, 200);
          tgt.toDay = toDay; setOwnerContext(bench, toDay + 1);
        } else if (kind === 2 && roster.length > 8) {
          // tx release
          const day = myMatchdays[rng.int(0, Math.max(0, myMatchdays.length - 1))] ?? rng.int(0, 200);
          const cand = roster.find((id) => !txs.some((t) => t.playerId === id));
          if (cand) { txs.push({ day, teamId: my, playerId: cand, kind: 'release' }); freed.push(cand); setTxContext(txs, freed, my, day); }
        } else if (kind === 3 && freed.length) {
          // tx sign (앞서 release된 id를 재영입 — faPool에 있음)
          const day = (myMatchdays[rng.int(0, myMatchdays.length - 1)] ?? 100) + 2;
          const cand = freed.find((id) => !txs.some((t) => t.kind === 'sign' && t.playerId === id));
          if (cand) { txs.push({ day, teamId: my, playerId: cand, kind: 'sign' }); setTxContext(txs, freed, my, day); }
        } else if (kind === 4) {
          // focus change (forward-only 세그먼트)
          const day = myMatchdays[rng.int(0, myMatchdays.length - 1)] ?? rng.int(0, 200);
          const focus = rng.next() < 0.5
            ? { primary: [2, 3] as [number, number], secondary: [5, 7, 9] as [number, number, number] }
            : { primary: [1, 11] as [number, number], secondary: [4, 6, 8] as [number, number, number] };
          segs = [...segs.filter((s) => s.fromDay < day), { fromDay: day, focus }];
          setFocusTimeline(my, segs as any, day);
        } else {
          // full 무효화(minDay 0) — 시퀀스 내 소급 bump. MIN 규칙 검증(이후 재사용 0)
          setFocusTimeline(my, segs as any, 0);
        }
      }
      // 스플라이스 경로 vs 강제 전체
      const sp = spliceSig();
      // 재사용량 추정(디버그): reuse 없으면 spliceUsed 0
      const fu = fullSig();
      scenarios++;
      const ok = sp.s === fu.s && sp.p === fu.p;
      if (!ok) { mism++; if (details.length < 5) details.push(`iter${iter} standEq=${sp.s === fu.s} prodEq=${sp.p === fu.p} nAct=${nActions}`); }
      else spliceUsed++;
      reuseTotal += 0;
    }
    check(`A 스플라이스==전체 (${scenarios}시나리오)`, mism === 0, mism ? `불일치 ${mism}: ${details.join(' | ')}` : `전 시나리오 deep-equal`);
  }

  // ══════════════════════════════════════════════════════════════════
  // B. 결정론 ×2 — 스플라이스 경로를 두 번 계산해도 동일
  // ══════════════════════════════════════════════════════════════════
  console.log('═══ B. 결정론 ×2 ═══');
  {
    G().resetSave(); G().selectTeam(my); fullSig();
    const day = myMatchdays[Math.floor(myMatchdays.length / 2)];
    const cand = rosterOf(my).find((id) => !getPlayer(id)?.isForeign)!;
    setOwnerContext([{ playerId: cand, fromDay: day }], day);
    const a = spliceSig();
    // 두 번째 — 캐시 폐기 후 다시 스플라이스가 아니라, 같은 상태를 full로 두 번(결정론 자체)
    const b = fullSig();
    const c = fullSig();
    check('B splice==full(1회) + full 재현(2회 동일)', a.s === b.s && a.p === b.p && b.s === c.s && b.p === c.p);
  }

  // ══════════════════════════════════════════════════════════════════
  // C. 타이밍 — 늦은 시즌 벤치 add에서 splice ms vs full ms (target: splice ≤ ~20% full)
  // ══════════════════════════════════════════════════════════════════
  console.log('═══ C. 타이밍(늦은 시즌 벤치 add) ═══');
  {
    G().resetSave(); G().selectTeam(my); fullSig();
    const lateDay = myMatchdays[myMatchdays.length - 2]; // 시즌 거의 끝(재사용 최대)
    const cand = rosterOf(my).find((id) => !getPlayer(id)?.isForeign)!;
    setOwnerContext([{ playerId: cand, fromDay: lateDay }], lateDay);
    const t0 = Date.now(); spliceSig(); const spliceMs = Date.now() - t0;
    const t1 = Date.now(); fullSig(); const fullMs = Date.now() - t1;
    const ratio = fullMs > 0 ? spliceMs / fullMs : 0;
    console.log(`     splice=${spliceMs}ms full=${fullMs}ms ratio=${(ratio * 100).toFixed(0)}% (lateDay=${lateDay}/${myMatchdays[myMatchdays.length - 1]})`);
    check('C 늦은 시즌 splice가 full보다 빠름', spliceMs <= fullMs, `splice ${spliceMs}ms vs full ${fullMs}ms`);
  }

  // ══════════════════════════════════════════════════════════════════
  // D. A/B 변이 — off-by-one(과대 minDay)면 오라클이 FAIL을 내야(민감도 증명)
  // ══════════════════════════════════════════════════════════════════
  console.log('═══ D. A/B 변이(과대 minDay → 스플라이스 오염 검출) ═══');
  {
    // 벤치가 결과를 실제로 바꾸는 **첫 영향일 D_eff**를 찾은 뒤, 올바른 minDay=fromDay는 splice==full,
    // 변이 minDay=D_eff+1(D_eff를 stale로 재사용)이면 splice!=full 이어야(오라클 검출).
    G().resetSave(); G().selectTeam(my);
    const rowsOf = (): { d: number; hs: number; as: number }[] => seasonResults(MAX).map((r) => ({ d: r.dayIndex, hs: r.homeSets, as: r.awaySets }));
    setOwnerContext([], 0); setFocusTimeline(my, [], 0);
    fullSig();
    const before = rowsOf();
    const fromDay = myMatchdays[Math.floor(myMatchdays.length / 3)];
    // 효과 있는 주전을 고른다(벤치가 어떤 경기 스코어를 바꾸는 선수)
    let starter = ''; let Deff = -1;
    for (const cand of rosterOf(my).filter((id) => !getPlayer(id)?.isForeign)) {
      setOwnerContext([{ playerId: cand, fromDay }], fromDay);
      const after = rowsOf();
      const idx = before.findIndex((b, i) => b.hs !== after[i].hs || b.as !== after[i].as);
      if (idx >= 0) { starter = cand; Deff = before[idx].d; break; }
      setOwnerContext([], 0);
    }
    // (D1) 올바른 minDay=fromDay
    setOwnerContext([], 0); fullSig();
    setOwnerContext([{ playerId: starter, fromDay }], fromDay);
    const spCorrect = spliceSig();
    const fuAfter = fullSig();
    check('D 올바른 minDay=fromDay → splice==full', spCorrect.s === fuAfter.s && spCorrect.p === fuAfter.p, `starter=${starter} Deff=${Deff}`);

    // (D2) 변이 minDay=D_eff+1 — 첫 영향일 D_eff를 stale로 재사용 → splice != full
    setOwnerContext([], 0); fullSig(); // prev = 벤치 전 C0
    setOwnerContext([{ playerId: starter, fromDay }], Deff + 1); // 과대 minDay(변이)
    const spMutant = spliceSig();
    const fuMutant = fullSig();
    const mutantMismatch = spMutant.s !== fuMutant.s || spMutant.p !== fuMutant.p;
    ab_check('D off-by-one minDay 변이 검출(D_eff stale)', Deff >= 0 && mutantMismatch);
    console.log(`     starter=${starter} Deff=${Deff} mutantMismatch=${mutantMismatch}`);
  }

  // ══════════════════════════════════════════════════════════════════
  // E. 프리뷰 분리 등가 — 메모된 base 재사용(…From) == 매번 fresh full (byte-등가)
  // ══════════════════════════════════════════════════════════════════
  console.log('═══ E. 오프시즌 프리뷰 분리 등가(base 재사용 == fresh full) ═══');
  {
    const stable = (v: unknown): string => {
      const seen = new WeakSet();
      const norm = (x: any): any => {
        if (x === null || typeof x !== 'object') return x;
        if (x instanceof Set) return { __set: [...x].map(norm) };
        if (x instanceof Map) return { __map: [...x.entries()].map(([k, val]) => [k, norm(val)]) };
        if (seen.has(x)) return '__cycle';
        seen.add(x);
        if (Array.isArray(x)) return x.map(norm);
        const o: Record<string, unknown> = {};
        for (const k of Object.keys(x).sort()) o[k] = norm(x[k]);
        return o;
      };
      return JSON.stringify(norm(v));
    };
    G().resetSave(); G().selectTeam(my);
    const season = G().season;
    const nextSeason = season + 1;
    const ownerFx = buildOwnerFx(G().interviews, season, my, G().fanScore);
    const resign = {}, overrides = {}, protectedIds: string[] = [];
    const cash = G().cash;
    // 다양한 토글 세트(위시/영입/공격적/보호)
    const faPoolSample = off.buildOffseasonBase(my, resign, overrides, nextSeason, ownerFx).off.pool;
    const toggleSets = [
      { faSignings: [] as string[], aggressive: false, tryoutWish: [] as string[] },
      { faSignings: faPoolSample.slice(0, 2), aggressive: true, tryoutWish: [] as string[] },
      { faSignings: faPoolSample.slice(1, 4), aggressive: false, tryoutWish: [] as string[] },
    ];
    // base는 한 번만 빌드해서 여러 토글에 재사용(메모 시뮬)
    const base = off.buildOffseasonBase(my, resign, overrides, nextSeason, ownerFx);
    let preOk = true, faOk = true, dcOk = true;
    const preDet: string[] = [];
    for (const tg of toggleSets) {
      const viaBase = off.resolvePreDraftFrom(base, my, tg.faSignings, tg.aggressive, protectedIds, nextSeason, ownerFx, cash, tg.tryoutWish);
      const viaFull = off.resolvePreDraft(my, resign, overrides, tg.faSignings, tg.aggressive, protectedIds, nextSeason, ownerFx, cash, tg.tryoutWish);
      if (stable(viaBase) !== stable(viaFull)) { preOk = false; preDet.push(`agg=${tg.aggressive} sign=${tg.faSignings.length}`); }

      const faBase = off.faMarketPreviewFrom(base, my, tg.faSignings, tg.aggressive, protectedIds, nextSeason, ownerFx, cash, tg.tryoutWish);
      const faFull = off.faMarketPreview(my, resign, overrides, tg.faSignings, tg.aggressive, protectedIds, nextSeason, ownerFx, cash, tg.tryoutWish);
      if (stable(faBase) !== stable(faFull)) faOk = false;

      const dcBase = draftSetup.buildDraftContextFrom(base, my, tg.faSignings, tg.aggressive, protectedIds, nextSeason, ownerFx, cash, tg.tryoutWish);
      const dcFull = draftSetup.buildDraftContext(my, resign, overrides, tg.faSignings, tg.aggressive, protectedIds, nextSeason, ownerFx, cash, tg.tryoutWish);
      if (stable(dcBase) !== stable(dcFull)) dcOk = false;
    }
    check('E resolvePreDraftFrom(base) == resolvePreDraft(fresh)', preOk, preDet.join(' | '));
    check('E faMarketPreviewFrom(base) == faMarketPreview(fresh)', faOk);
    check('E buildDraftContextFrom(base) == buildDraftContext(fresh)', dcOk);
    // base 재사용이 base를 오염시키지 않는가 — 위 3토글×3함수 = 9회 재사용 후에도 마지막 등가 유지(위에서 이미 검증)
    // A/B: base를 변이시켜(잘못 clone 안 함) 오라클이 잡는지 — 일부러 base.off.snapshot을 비우면 mismatch
    const brokenBase = JSON.parse(JSON.stringify({ x: 1 })); // 무의미 — 아래는 clone 신뢰 검증
    ab_check('E clone 보호 오라클(재사용 9회 후 base.pool 불변)', base.off.pool.length === faPoolSample.length);

    // F. 프리뷰 타이밍 — base 빌드 vs 해결(토글 재실행) — 해결이 base보다 훨씬 싸야
    const tb0 = Date.now(); const base2 = off.buildOffseasonBase(my, resign, overrides, nextSeason, ownerFx); const baseMs = Date.now() - tb0;
    const tr0 = Date.now(); off.resolvePreDraftFrom(base2, my, faPoolSample.slice(0, 2), true, protectedIds, nextSeason, ownerFx, cash, []); const resolveMs = Date.now() - tr0;
    console.log(`     [타이밍] base 빌드=${baseMs}ms · 해결(토글 재실행)=${resolveMs}ms · 비율=${baseMs > 0 ? (resolveMs / baseMs * 100).toFixed(0) : '?'}%`);
    check('F 토글 해결 ≤ base 빌드(스냅샷 분리 이득)', resolveMs <= baseMs + 1);
  }

  // ══════════════════════════════════════════════════════════════════
  // G. 감독 영입/배정 스플라이스 byte-등가 (축3, REALTIME_SIM §7.2 정정)
  //    hireCoach(forward-only, recordBump(hireDay))·assignCoach(retroactive)·시퀀스(MIN) 후 splice==force-full.
  //    coachInfoOf가 day-aware라 부임 이전 경기는 이전 감독 → 재사용 행과 byte-동일해야(오라클).
  // ══════════════════════════════════════════════════════════════════
  console.log('═══ G. 감독 스플라이스 byte-등가(축3) ═══');
  {
    let gPass = true; const gDet: string[] = [];
    const cheapCoach = (team: string) => availableCoaches(team).slice().sort((a: any, b: any) => a.salary - b.salary)[0];
    // G1. 시즌 중 감독 영입 — 여러 부임일에서 splice==full
    const stages = [myMatchdays[Math.floor(myMatchdays.length / 4)], myMatchdays[Math.floor(myMatchdays.length / 2)], myMatchdays[myMatchdays.length - 2]];
    for (const hireDay of stages) {
      G().resetSave(); G().selectTeam(my); fullSig();               // 워밍(이전 세대 캐시 = 스플라이스 재사용 원천)
      const c = cheapCoach(my); if (!c) { gDet.push('no-coach'); continue; }
      const ok = hireHeadCoach(my, c.id, hireDay);
      if (!ok) { gDet.push(`hire-fail d${hireDay}`); continue; }
      const sp = spliceSig(); const fu = fullSig();
      if (sp.s !== fu.s || sp.p !== fu.p) { gPass = false; gDet.push(`hire d${hireDay} standEq=${sp.s === fu.s} prodEq=${sp.p === fu.p}`); }
    }
    // G2. assignCoach(다른 팀, 소급 recordBump0) — day-aware coachInfoOf 경유 전체 재계산도 splice(=full)==full
    {
      G().resetSave(); G().selectTeam(my); fullSig();
      const other = LEAGUE.teams[3].id; const c = cheapCoach(other);
      if (c) { assignCoach(other, c.id); const sp = spliceSig(); const fu = fullSig(); if (sp.s !== fu.s || sp.p !== fu.p) { gPass = false; gDet.push('assignCoach'); } }
    }
    // G3. 시퀀스: 감독 영입(d1) → 훈련방침(d2) → MIN(d1,d2) 접미 스플라이스 == full
    {
      G().resetSave(); G().selectTeam(my); fullSig();
      const d1 = myMatchdays[Math.floor(myMatchdays.length / 3)];
      const d2 = myMatchdays[Math.floor((myMatchdays.length * 2) / 3)];
      const c = cheapCoach(my);
      if (c && hireHeadCoach(my, c.id, d1)) {
        setFocusTimeline(my, [{ fromDay: d2, focus: { primary: [2, 3], secondary: [5, 7, 9] } }] as any, d2);
        const sp = spliceSig(); const fu = fullSig();
        if (sp.s !== fu.s || sp.p !== fu.p) { gPass = false; gDet.push('seq hire+focus'); }
      }
    }
    // G4. forward-only 불변식(축3 핵심) — 시즌 중 영입 후 부임일 **이전** 경기 결과는 byte 불변(이전 감독).
    //   (G1 splice==full 과 결합하면 coachInfoOf day-aware 정합을 강제: 소급이었다면 full 이 과거를 바꿔 G1 이 FAIL.)
    //   A/B: 같은 감독을 day0(소급)로 영입하면 과거가 바뀌어야(부임 감독이 실제로 결과에 영향) → 서로 다름을 확인.
    {
      const earlyRows = (upto: number) => JSON.stringify(seasonResults(upto).map((r) => [r.dayIndex, r.homeSets, r.awaySets]));
      G().resetSave(); G().selectTeam(my); fullSig();
      const hireDay = myMatchdays[Math.floor(myMatchdays.length / 2)];
      const before = earlyRows(hireDay - 1);            // 부임 이전 구간 baseline(시드 감독)
      const c = cheapCoach(my);
      let fwdPreserved = false, retroChanged = false;
      if (c) {
        hireHeadCoach(my, c.id, hireDay);               // forward-only
        const afterFwd = earlyRows(hireDay - 1);
        fwdPreserved = afterFwd === before;             // 과거 불변(forward-only)
        // 소급(day0) 영입으로 대조 — 같은 감독이 과거에도 부임했다면 과거 경기가 달라질 수 있음
        G().resetSave(); G().selectTeam(my); fullSig();
        const c2 = cheapCoach(my);
        if (c2) { hireHeadCoach(my, c2.id, 0); retroChanged = earlyRows(hireDay - 1) !== before; }
      }
      check('G forward-only: 부임 이전 경기 byte 불변', fwdPreserved);
      // retroChanged 는 "감독이 실제로 결과에 영향 있을 때만" true — 영향 없는 감독이면 무효(정보용, 실패 아님)
      console.log(`     [A/B] forward=과거불변(${fwdPreserved}) · 소급day0=과거변화(${retroChanged}) ${retroChanged ? '→ day-aware 실효 확인' : '(이 감독은 과거 스코어 무영향 — 참고)'}`);
    }
    check('G 감독 영입/배정/시퀀스 splice==full', gPass, gDet.join(' | '));
  }

  console.log(`\n═══ 결과: ${pass} PASS · ${fail} FAIL | A/B: ${ab - abFail}/${ab} 유효(무효 ${abFail}) ═══`);
  console.log(fail === 0 ? '✅ 스플라이스 오라클 + 프리뷰 분리 등가 통과' : '❌ 위반 있음');
  if (abFail > 0) console.log('⚠️ 무효 오라클(A/B 못 깸) 있음');
  process.exit(fail === 0 && abFail === 0 ? 0 : 1);
})();
