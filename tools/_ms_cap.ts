// 측정 전용 — currentDay high-water cap (REALTIME_SIM §7.7) 콜드 워밍 절감 A/B.
//   같은 코드에서 워밍을 cap(displayCutoff) vs MAX(전 시즌) 로 각각 강제해 첫 콜드 시간을 대조한다.
//   시즌초/중반일수록 미래 경기를 안 시뮬해 절감이 크다. 원칙: 콜드(캐시 폐기)·시드 고정·중앙값3(노이즈 완화).
//   실행: npx tsx tools/_ms_cap.ts
import './_gt_mock';

const PHONE_MULT = 5; // 폰 배율(dynamics/production 주석 실측 5x)

(async () => {
  const { LEAGUE, SEASON } = await import('../data/league');
  const { computeStandings, setStandingsCacheRaw } = await import('../data/standings');
  const { leagueProduction, setProductionCacheRaw } = await import('../data/production');
  const { setDynCacheRaw } = await import('../data/dynamics');
  const { useGameStore } = await import('../store/useGameStore');

  const my = LEAGUE.teams[0].id;
  const G = () => useGameStore.getState();
  G().resetSave(); G().selectTeam(my);

  const MAX = Number.MAX_SAFE_INTEGER;
  const matchdays = ([...new Set(SEASON.map((f: any) => f.dayIndex as number))] as number[]).sort((a, b) => a - b);
  const lastDay = matchdays[matchdays.length - 1];

  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const ms = (fn: () => void): number => { const t = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t) / 1e6; };
  const clearAll = () => { setStandingsCacheRaw(null); setProductionCacheRaw(null); setDynCacheRaw(null); };

  // 콜드 워밍 = 캐시 폐기 후 순위+생산 계산(warmCachesForIntro 가 하는 일).
  const warm = (cap: number) => ms(() => { clearAll(); computeStandings(cap); leagueProduction(cap); });

  console.log('════════════════════════════════════════════════════════════');
  console.log(' cap 워밍 절감 A/B — computeStandings+leagueProduction 첫 콜드(중앙값3)');
  console.log(` 매치데이 0..${lastDay} · 총경기 ${SEASON.length} · 폰추정 ×${PHONE_MULT}`);
  console.log('════════════════════════════════════════════════════════════');
  console.log('currentDay   cap(displayCutoff)   MAX(전시즌)   절감%   폰:cap→MAX');

  const stages = [0, 20, 40, 60, 80, lastDay];
  for (const day of stages) {
    const cap = Math.max(day - 1, -1); // displayCutoff 근사(관전 중 경기 직전까지). day0 → -1(빈 결과 = 즉시).
    const capMs = median([0, 1, 2].map(() => warm(cap)));
    const maxMs = median([0, 1, 2].map(() => warm(MAX)));
    const save = maxMs > 0 ? (1 - capMs / maxMs) * 100 : 0;
    console.log(`d${String(day).padEnd(3)}         ${capMs.toFixed(0).padStart(8)}ms        ${maxMs.toFixed(0).padStart(8)}ms   ${save.toFixed(0).padStart(5)}%   ${(capMs * PHONE_MULT).toFixed(0)}→${(maxMs * PHONE_MULT).toFixed(0)}ms`);
  }

  console.log('');
  console.log(' 주: cap 컬럼 = 워밍을 displayCutoff(현재일 직전)까지만 — 미래 경기 미시뮬. MAX = 전 시즌(미래 포함).');
  console.log('     시즌초일수록 절감 큼(day0=경기0이면 즉시). 시즌말(cap≈MAX)은 동일 비용 = 무해.');
  console.log('════════════════════════════════════════════════════════════');
  process.exit(0);
})();
