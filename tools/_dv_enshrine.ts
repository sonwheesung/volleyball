// 헌액 화면 선택 불변식 가드(BROADCAST §8.4) — endSeason 직후 app/enshrine.tsx 가 쓰는 필터
// (hallOfFame.filter(legend && retiredSeason === season-1)) 가 '이번 전환에 새로 추가된 레전드'와 정확히 일치하는지.
//   npx tsx tools/_dv_enshrine.ts [시즌=70]
import './_gt_mock';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, SEASON } = await import('../data/league');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const N = Math.max(8, Number(process.argv[2]) || 70);
  const myFix = SEASON.filter((f: any) => f.homeTeamId === my || f.awayTeamId === my);
  G().resetSave(); G().selectTeam(my);

  let totalNew = 0, mismatches = 0, screensShown = 0, maxOnScreen = 0;
  let prevLegendIds = new Set<string>();
  for (let s = 0; s < N; s++) {
    for (const f of myFix) G().recordResult({ fixtureId: f.id, homeSets: 3, awaySets: 1 } as any);
    G().setDay(164); G().endSeason();
    const season = G().season;                       // endSeason 후 = nextSeason
    const hof = G().hallOfFame;
    // enshrine 화면이 고르는 집합
    const onScreen = hof.filter((h) => h.legend && h.retiredSeason === season - 1);
    // 실제로 이번 전환에 새로 생긴 레전드(직전 스냅샷 대비)
    const curLegendIds = new Set(hof.filter((h) => h.legend).map((h) => h.id));
    const actuallyNew = [...curLegendIds].filter((id) => !prevLegendIds.has(id));
    prevLegendIds = curLegendIds;
    // 대조: 화면 집합 == 실제 신규(집합 동일)
    const onSet = new Set(onScreen.map((h) => h.id));
    const same = actuallyNew.length === onSet.size && actuallyNew.every((id) => onSet.has(id));
    if (!same) mismatches++;
    totalNew += onScreen.length;
    if (onScreen.length > 0) screensShown++;
    maxOnScreen = Math.max(maxOnScreen, onScreen.length);
  }

  const log = (m: string) => process.stdout.write(m + '\n');
  log(`=== 헌액 화면 선택 불변식 (${N}시즌) ===`);
  log(`  새 레전드 총 ${totalNew}명 · 화면 표출 시즌 ${screensShown}회 · 한 화면 최대 ${maxOnScreen}명`);
  log(`  화면집합 == 실제신규 불일치: ${mismatches}건`);
  const pass = mismatches === 0 && totalNew > 0;
  log(`\nRESULT: ${pass ? '✅ PASS' : '❌ FAIL'}${mismatches ? ` — ${mismatches}건 불일치` : totalNew === 0 ? ' — 레전드 0(표본 부족)' : ''}`);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
