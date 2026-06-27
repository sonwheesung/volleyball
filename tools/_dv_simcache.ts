// INDEPENDENT — 시뮬 결과 캐시 영속 가드 (REALTIME_SIM Phase1). 실제 store+persist로 검증:
//   ① 재로드 시 캐시 복원(재계산 없이 저장값 사용) ② 캐시 == 재계산(무stale 안전망 — 결정론 위에서만 안전)
//   ③ A/B(캐시를 일부러 깨면 결과가 바뀜 = 캐시가 실제로 읽힌다 증명) + 깬 뒤 재계산은 원값 복구(재계산 정확).
//   npx tsx tools/_dv_simcache.ts
import './_gt_mock';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE } = await import('../data/league');
  const { computeStandings } = await import('../data/standings');
  const { getStandingsCacheRaw, setStandingsCacheRaw } = await import('../data/standings');
  const { leagueProduction, setProductionCacheRaw } = await import('../data/production');
  const { baseVersion } = await import('../data/league');
  const { currentTxVersion, availableFAsOnDay } = await import('../data/dynamics');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const log = (m: string) => process.stdout.write(m + '\n');
  const sig = () => JSON.stringify(computeStandings(Number.MAX_SAFE_INTEGER).map((s) => [s.teamId, s.points, s.wins, s.losses]));

  // 1) 플레이 상태 만들고 순위 워밍(캐시 채움)
  let rsd = 20260627 >>> 0; const rnd = () => { rsd = (rsd * 1103515245 + 12345) & 0x7fffffff; return rsd / 0x7fffffff; };
  G().resetSave(); G().selectTeam(my);
  for (let i = 0; i < 80; i++) {
    const mine = (G() as any).rosters?.[my] ?? [];
    const r = rnd();
    if (r < 0.4) G().setDay(Math.floor(rnd() * 164));
    else if (r < 0.55) { const id = mine[Math.floor(rnd() * mine.length)]; if (id) G().release(id); }
    else if (r < 0.6) G().endSeason();
  }
  const sig1 = sig(); leagueProduction(Number.MAX_SAFE_INTEGER); // 순위+생산 캐시 워밍

  // 2) 실제 partialize → simCache 포함 확인
  const persist = (useGameStore as any).persist;
  const realPartialize = persist.getOptions().partialize as (s: any) => any;
  const realRehydrate = persist.getOptions().onRehydrateStorage as () => (s: any) => void;
  const saved = JSON.parse(JSON.stringify(realPartialize(G())));
  const hasCache = !!saved.simCache && Array.isArray(saved.simCache.standings) && saved.simCache.standings.length > 0;
  log(`[1] partialize에 simCache 포함(워밍): ${hasCache ? '✅' : '❌'}`);

  const reload = (s: any) => { G().resetSave(); realRehydrate()(s); useGameStore.setState(s); };

  // 3) 재로드 → 캐시 복원되어 재계산 없이 sig1과 동일
  reload(saved);
  const restored = getStandingsCacheRaw();
  const restoredHit = !!restored && restored.key === `${baseVersion()}:${currentTxVersion()}`;
  const sig2 = sig();
  log(`[2] 재로드 후 캐시 복원(키 일치=재계산 불요): ${restoredHit ? '✅' : '❌'}`);
  log(`[3] 재로드 순위 == 원본: ${sig2 === sig1 ? '✅' : '❌'}`);

  // 4) 무stale 안전망: 캐시 비우고 강제 재계산 → 여전히 sig1 (저장값이 재계산과 일치)
  setStandingsCacheRaw(null); setProductionCacheRaw(null);
  const sig3 = sig();
  log(`[4] 캐시 비우고 재계산 == 원본(무stale): ${sig3 === sig1 ? '✅' : '❌'}`);

  // 5) A/B: 깨진 simCache(순위 점수 조작) 복원 → computeStandings가 *깨진 값*을 반환해야(캐시가 실제로 읽힌다)
  const broken = JSON.parse(JSON.stringify(saved));
  // 여러 경기의 승패를 뒤집어(homeSets↔awaySets 스왑) 순위가 확실히 달라지게 — 캐시가 읽히면 반영됨
  for (const r of (broken.simCache?.standings ?? []).slice(0, 20)) { const t = r.homeSets; r.homeSets = r.awaySets; r.awaySets = t; }
  reload(broken);
  const sigBroken = sig();
  const abUsed = sigBroken !== sig1; // 캐시가 읽혔다면 조작이 순위에 반영돼 달라짐
  // 깬 뒤 캐시 비우고 재계산하면 원본 복구(재계산은 조작 무시)
  setStandingsCacheRaw(null); setProductionCacheRaw(null);
  const sigHeal = sig();
  log(`[5] A/B 캐시 조작이 결과에 반영(캐시 실제 사용): ${abUsed ? '✅' : '❌'} · 재계산은 원본 복구: ${sigHeal === sig1 ? '✅' : '❌'}`);

  // 6) G3 엔진버전 게이트: 다른 엔진버전 + 조작된 캐시 → 폐기되어 재계산으로 원복(옛-엔진 결과 박제 방지)
  const verBad = JSON.parse(JSON.stringify(saved));
  if (verBad.simCache) {
    verBad.simCache.engineVersion = (verBad.simCache.engineVersion ?? 0) + 999; // 엔진 재튜닝 흉내
    for (const r of (verBad.simCache.standings ?? []).slice(0, 20)) { const t = r.homeSets; r.homeSets = r.awaySets; r.awaySets = t; } // 조작
  }
  reload(verBad);
  const sigVer = sig();
  const g3 = sigVer === sig1; // 조작됐지만 버전 불일치로 폐기→재계산→원본
  log(`[6] G3 엔진버전 불일치 캐시 폐기(재계산 원복): ${g3 ? '✅' : '❌'}`);

  const ok = hasCache && restoredHit && sig2 === sig1 && sig3 === sig1 && abUsed && sigHeal === sig1 && g3;
  log(ok ? '\n결론: ✅ 캐시 영속 — 재로드 재계산 제거 + 무stale + 실제 사용(A/B) + 엔진버전 게이트(G3)' : '\n결론: ❌ 점검 필요');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
