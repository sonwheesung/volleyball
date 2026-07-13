// 측정 — §7.9 진화 점진 캐시(c1) dyn 콜드 A/B. dynamics.compute()의 진화 전진 패스가
//   evolveOnDay(id,d) 콜드 O(day) → 준이차였던 것을 체크포인트 재개로 O(Δday) 선형화.
//   BEFORE = NO_EVORESUME(재개 무력화, 매 콜 base 콜드) · AFTER = 재개. commitRosters로 캐시 완전 콜드 강제.
//   실행: npx tsx tools/_ms_evoresume.ts   (엔진 무수정 — 순수 캐시 프리미티브)
import './_gt_mock';

(async () => {
  const { LEAGUE, currentRosters, commitRosters } = await import('../data/league') as any;
  const { seasonInjuryReport } = await import('../data/dynamics') as any;
  const { useGameStore } = await import('../store/useGameStore');

  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  G().resetSave(); G().selectTeam(my);

  const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  // 한 번의 콜드 dyn 계산 시간(ms) — commitRosters가 evoOne/checkpoint/dyn 캐시를 전부 비우고 baseVersion++
  const coldDyn = (): number => {
    commitRosters(currentRosters());   // 완전 콜드 강제(캐시 클리어)
    const t0 = performance.now();
    seasonInjuryReport();              // = dyn().injuries → compute() 전진 패스
    return performance.now() - t0;
  };

  const REP = 5;
  // BEFORE
  process.env.NO_EVORESUME = '1';
  coldDyn(); // 워밍(모듈 JIT)
  const before: number[] = []; for (let i = 0; i < REP; i++) before.push(coldDyn());
  // AFTER
  delete process.env.NO_EVORESUME;
  coldDyn(); // 워밍
  const after: number[] = []; for (let i = 0; i < REP; i++) after.push(coldDyn());

  const b = median(before), a = median(after);
  console.log(`\n═══ §7.9 dyn 콜드 A/B (데스크톱, 중앙값 of ${REP}) ═══`);
  console.log(`  BEFORE(NO_EVORESUME, base 콜드 매 콜): ${b.toFixed(1)}ms   [${before.map((x) => x.toFixed(0)).join(', ')}]`);
  console.log(`  AFTER (체크포인트 재개)             : ${a.toFixed(1)}ms   [${after.map((x) => x.toFixed(0)).join(', ')}]`);
  console.log(`  개선: ${(b / a).toFixed(1)}배 · ${(100 * (1 - a / b)).toFixed(1)}% 절감`);
  process.exit(0);
})();
