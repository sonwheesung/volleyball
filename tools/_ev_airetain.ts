// 측정 — AI 재계약 절벽 컷(aiKeepsFA) → 확률(aiRetainProb) 비교. 실제 리그 N시즌의 AI 로스터 모집단으로
//   나이/OVR 구간별 잔류율(이진 vs 확률)을 떠서 "절벽이 사라지고 엘리트는 유지되는가" + 순잔류율 정합 확인.
//   npx tsx tools/_ev_airetain.ts [시즌=12]
import './_gt_mock';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, SEASON, currentRosters, evolveOnDay } = await import('../data/league');
  const { aiKeepsFA, aiRetainProb, medianOvr, MED_REF } = await import('../engine/aiGM');
  const { overall } = await import('../engine/overall');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const N = Math.max(4, Number(process.argv[2]) || 12);
  const myFix = SEASON.filter((f: any) => f.homeTeamId === my || f.awayTeamId === my);

  const pop: { age: number; ovr: number; old: boolean; prob: number }[] = [];
  G().resetSave(); G().selectTeam(my);
  for (let s = 0; s < N; s++) {
    // 시즌 모집단 먼저 수집 → 중앙값 계산 → 확률(엔진과 동일한 상대 앵커 순서, FA_SYSTEM 4 2026-07-02)
    const seasonPop: import('../types').Player[] = [];
    for (const t of LEAGUE.teams) {
      if (t.id === my) continue; // AI 팀만
      for (const id of currentRosters()[t.id] ?? []) {
        const p = evolveOnDay(id, 164); if (!p || p.isForeign) continue;
        seasonPop.push(p);
      }
    }
    const med = medianOvr(seasonPop);
    for (const p of seasonPop) pop.push({ age: p.age, ovr: overall(p), old: aiKeepsFA(p), prob: aiRetainProb(p, med) });
    for (const f of myFix) G().recordResult({ fixtureId: f.id, homeSets: 3, awaySets: 1 } as any);
    G().setDay(164); G().endSeason();
  }

  const n = pop.length;
  const oldRate = pop.filter((x) => x.old).length / n;
  const newRate = pop.reduce((a, x) => a + x.prob, 0) / n;
  const band = (lo: number, hi: number, key: 'age' | 'ovr') => pop.filter((x) => x[key] >= lo && x[key] < hi);
  const rateOf = (arr: typeof pop) => arr.length ? { old: arr.filter((x) => x.old).length / arr.length, prob: arr.reduce((a, x) => a + x.prob, 0) / arr.length, n: arr.length } : { old: 0, prob: 0, n: 0 };
  const fmt = (r: { old: number; prob: number; n: number }) => `구(${(r.old * 100).toFixed(0)}%) 신(${(r.prob * 100).toFixed(0)}%) [n=${r.n}]`;

  console.log(`=== AI 재계약 절벽→확률 (${N}시즌 AI 모집단 n=${n}) ===`);
  console.log(`전체 잔류율: 구 이진 ${(oldRate * 100).toFixed(1)}% · 신 확률 기대 ${(newRate * 100).toFixed(1)}%`);
  console.log(`\n나이 구간별 잔류율(절벽 확인 — 구는 31→32에서 급락):`);
  for (const [lo, hi, lbl] of [[20, 29, '~28'], [29, 31, '29-30'], [31, 33, '31-32'], [33, 35, '33-34'], [35, 99, '35+']] as const)
    console.log(`  ${lbl.padEnd(6)} ${fmt(rateOf(band(lo, hi, 'age')))}`);
  console.log(`\nOVR 구간별 잔류율(구는 70에서 급락):`);
  for (const [lo, hi, lbl] of [[0, 70, '<70'], [70, 76, '70-75'], [76, 82, '76-81'], [82, 88, '82-87'], [88, 99, '88+']] as const)
    console.log(`  ${lbl.padEnd(6)} ${fmt(rateOf(band(lo, hi, 'ovr')))}`);

  // 엘리트 노장(OVR>=84) 나이별 — 구는 32세부터 0%, 신은 소프트 플로어 유지여야
  console.log(`\n엘리트(OVR≥84) 나이별 잔류율(구 32세↑=0%, 신=유지 기대):`);
  const elite = pop.filter((x) => x.ovr >= 84);
  for (const [lo, hi, lbl] of [[20, 32, '~31'], [32, 35, '32-34'], [35, 99, '35+']] as const)
    console.log(`  ${lbl.padEnd(6)} ${fmt(rateOf(elite.filter((x) => x.age >= lo && x.age < hi)))}`);

  // 연속성: 신 확률이 0/1만이 아니라 중간값(0.05~0.95)을 의미있게 가지는가(절벽 아님)
  const mid = pop.filter((x) => x.prob > 0.05 && x.prob < 0.95).length / n;
  console.log(`\n연속성: 신 확률이 중간대(0.05~0.95) 비율 ${(mid * 100).toFixed(0)}% (이진이면 0% — 절벽). 단조성 sanity:`);
  // A/B 단조: 같은 나이서 OVR↑→prob↑, 같은 OVR서 나이↑→prob↓
  // 합성 검사는 보정 기준 시대(med=MED_REF)로 고정 — 절대 앵커 의미(62·70·88) 유지
  const f = (p: any) => aiRetainProb(p, MED_REF);
  const mk = (age: number, ovr: number) => ({ age, position: 'OH', isForeign: false,
    jump: ovr, agility: ovr, staminaMax: ovr, staminaRegen: ovr, reaction: ovr, positioning: ovr, focus: ovr, consistency: ovr, vq: ovr,
    skSpike: ovr, skBlock: ovr, skDig: ovr, skReceive: ovr, skSet: ovr, skServe: ovr, height: 185, potential: {}, traits: [] }) as any;
  const monoOvr = f(mk(28, 88)) > f(mk(28, 70)) && f(mk(28, 70)) > f(mk(28, 62));
  const monoAge = f(mk(26, 80)) >= f(mk(33, 80)) && f(mk(33, 80)) > f(mk(37, 80));
  const eliteOld = f(mk(33, 88)) >= 0.6; // 33세 에이스는 여전히 높게(절벽 아님)
  console.log(`  OVR↑→prob↑: ${monoOvr} · 나이↑→prob↓: ${monoAge} · 33세 에이스 prob≥0.6: ${eliteOld} (${f(mk(33, 88)).toFixed(2)})`);

  // ── 가드 판정 ──
  const age3334 = rateOf(band(33, 35, 'age')).prob; // 구=0%(절벽). 매끄러우면 >0
  const ovrLow = rateOf(band(0, 70, 'ovr')).prob;   // 구=0%(절벽)
  const noCliff = age3334 > 0.15 && ovrLow > 0.03;
  const netOk = newRate >= 0.50 && newRate <= 0.62; // 구 58.9% 근방(과이탈/고착 방지)
  const pass = noCliff && netOk && monoOvr && monoAge && eliteOld && mid > 0.5;
  console.log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'} (절벽해소 age33-34=${(age3334 * 100).toFixed(0)}%·ovr<70=${(ovrLow * 100).toFixed(0)}% · 순잔류 ${(newRate * 100).toFixed(1)}% · 단조 ${monoOvr && monoAge} · 연속 ${(mid * 100).toFixed(0)}%)`);
  if (!pass) process.exit(1);
})();
