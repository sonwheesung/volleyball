// 독립 검증 — currentDay high-water cap (REALTIME_SIM §7.7). 전방 확장 축(cap)이 풀-시즌 계산과 byte-동일함을 증명.
// 오라클(절대 기준): cap 이하 행은 풀 계산과 deep(byte)-동일해야 한다(day 루프 인과적 — day D는 day<D만 참조).
//   ① 부분(K)→확장(K') == fresh(K') · ② cap∘splice 합성(K→minDay<K bump→K'') == fresh · ③ day0/시즌경계.
//   현행 코드(항상 풀 계산 후 필터)에서도 GREEN 이어야(오라클 sanity) — 구현 후엔 cap 경로가 이 등가를 유지.
//   실행: npx tsx tools/_dv_cap.ts
import './_gt_mock';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, getPlayer, currentRosters, SEASON } = await import('../data/league');
  const { seasonResults, setStandingsCacheRaw, getStandingsCacheRaw } = await import('../data/standings');
  const { seasonMatchProds, leagueProductionRange, setProductionCacheRaw, getProductionCacheRaw } = await import('../data/production');
  const { setOwnerContext } = await import('../data/dynamics');
  const { SEASON_DAYS } = await import('../engine/calendar');

  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const MAX = Number.MAX_SAFE_INTEGER;

  let pass = 0, fail = 0;
  const check = (name: string, ok: boolean, detail = ''): void => {
    (ok ? pass++ : fail++);
    console.log(`  ${ok ? '✅' : '❌ FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };
  const cu = () => `stand.cu=${(getStandingsCacheRaw() as any)?.computedUpto} prod.cu=${(getProductionCacheRaw() as any)?.computedUpto}`;

  // ── sig(K): 순위 + 경기별 생산 + 구간 생산을 그대로 직렬화(순서 민감 — order도 byte-등가의 일부) ──
  const sigStand = (K: number): string => JSON.stringify(seasonResults(K));
  const sigProd = (K: number): string => JSON.stringify(seasonMatchProds(K).map((r) => ({
    d: r.dayIndex, h: r.homeTeamId, a: r.awayTeamId,
    homeIds: [...r.homeIds], lines: [...r.lines.entries()], starters: [...r.starters],
  })));
  const sigRange = (K: number): string => JSON.stringify([...leagueProductionRange(0, K).entries()]);
  const sig = (K: number): string => `${sigStand(K)}‖${sigProd(K)}‖${sigRange(K)}`;
  const clear = (): void => { setStandingsCacheRaw(null); setProductionCacheRaw(null); };
  const fresh = (K: number): string => { clear(); return sig(K); }; // 캐시 폐기 후 = 스플라이스/cap 우회, 독립 기준

  const myMatchdays = [...new Set(SEASON.filter((f) => f.homeTeamId === my || f.awayTeamId === my).map((f) => f.dayIndex))].sort((a, b) => a - b);
  const q = (frac: number) => myMatchdays[Math.min(myMatchdays.length - 1, Math.max(0, Math.floor(myMatchdays.length * frac)))];

  // ══════════════════════════════════════════════════════════════════
  // ① 부분(K) → 확장(K') == fresh(K')  (전방 확장 등가)
  // ══════════════════════════════════════════════════════════════════
  console.log('═══ ① 부분(K)→확장(K\') byte-등가 ═══');
  {
    G().resetSave(); G().selectTeam(my); setOwnerContext([], 0);
    const pairs: [number, number][] = [
      [q(0.25), q(0.7)], [q(0.1), q(0.5)], [0, SEASON_DAYS], [q(0.5), q(0.5) + 1],
      [q(0.4), MAX], [q(0.5), q(0.5)], // K'==K(재요청) 도 안정
    ];
    for (const [K, Kp] of pairs) {
      clear(); sig(K);                 // 부분 계산(캐시 computedUpto≈K)
      const cuAfterK = cu();
      const extended = sig(Kp);        // 확장(computedUpto K→K')
      const cuAfterKp = cu();
      const fr = fresh(Kp);            // fresh 풀-후-필터(독립 기준)
      check(`① K=${K}→K'=${Kp}`, extended === fr, `${cuAfterK} → ${cuAfterKp}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // ② cap ∘ splice 합성 — 부분(K) 후 minDay<K bump → 확장(K'') == fresh
  //    reuseThreshold = min(minDay, computedUpto+1) 로 두 축이 한 경로에서 합성되는지 증명.
  // ══════════════════════════════════════════════════════════════════
  console.log('═══ ② cap∘splice 합성 byte-등가 ═══');
  {
    const scenarios: { K: number; minDay: number; Kp: number }[] = [
      { K: q(0.5), minDay: q(0.25), Kp: q(0.8) },   // minDay<K, 확장
      { K: q(0.5), minDay: q(0.25), Kp: q(0.5) },   // minDay<K, K''=K(확장 없음)
      { K: q(0.3), minDay: q(0.15), Kp: MAX },      // 부분→MAX 확장 + splice
      { K: q(0.6), minDay: q(0.6), Kp: q(0.9) },    // minDay==K 경계
    ];
    for (const { K, minDay, Kp } of scenarios) {
      G().resetSave(); G().selectTeam(my); setOwnerContext([], 0);
      clear(); sig(K);                                            // 부분 워밍(seq=s0, computedUpto=K)
      const cand = (currentRosters()[my] ?? []).find((id: string) => !getPlayer(id)?.isForeign);
      if (!cand) { check(`② (K=${K},minDay=${minDay},K''=${Kp})`, false, 'no-cand'); continue; }
      setOwnerContext([{ playerId: cand, fromDay: minDay }], minDay); // splice bump (txVersion++, recordBump(minDay))
      const spliced = sig(Kp);                                    // cap-확장 + splice 를 한 경로에서 합성
      const cuS = cu();
      const fr = fresh(Kp);                                       // 같은 bench 상태로 fresh
      check(`② splice(minDay=${minDay})∘cap(K=${K}→${Kp})`, spliced === fr, cuS);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // ③ day0 / 시즌경계
  // ══════════════════════════════════════════════════════════════════
  console.log('═══ ③ day0 / 시즌경계 ═══');
  {
    G().resetSave(); G().selectTeam(my); setOwnerContext([], 0);
    clear();
    check('③ seasonResults(-1)=[]', seasonResults(-1).length === 0);
    check('③ seasonMatchProds(-1)=[]', seasonMatchProds(-1).length === 0);
    check('③ leagueProductionRange(0,-1)=∅', leagueProductionRange(0, -1).size === 0);
    // day0 확장 안정 — 부분(0) 후 재요청(0) == fresh(0)
    clear(); sig(0); const day0ext = sig(0); const day0fr = fresh(0);
    check('③ day0 부분→재요청==fresh', day0ext === day0fr);
    // 0 → SEASON_DAYS 확장 == fresh(SEASON_DAYS) (시즌 전체)
    clear(); sig(0); const seasonExt = sig(SEASON_DAYS); const seasonFr = fresh(SEASON_DAYS);
    check('③ 0→SEASON_DAYS 확장==fresh', seasonExt === seasonFr, cu());
    // SEASON_DAYS == MAX (경계 위로는 경기 0 — 동일해야)
    const sdFr = fresh(SEASON_DAYS); const maxFr = fresh(MAX);
    check('③ fresh(SEASON_DAYS)==fresh(MAX)', sdFr === maxFr);
  }

  console.log(`\n═══ 결과: ${pass} PASS · ${fail} FAIL ═══`);
  console.log(fail === 0 ? '✅ cap 오라클 통과(전방 확장 byte-등가)' : '❌ 위반 있음');
  process.exit(fail === 0 ? 0 : 1);
})();
