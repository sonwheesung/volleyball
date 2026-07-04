// 업적 achTotals + 오프시즌 campDoneSeason 엣지 케이스 (2026-07-04) — 경계·가법성·멱등·시즌리셋을 실 store로.
// EDGE_CASES.md 등재분. 재구현 오라클 금지 — 실제 store.finishCamp/endSeason/recordResult 구동.
// Usage: npx tsx tools/_gt_achedge.ts
import './_gt_mock';

(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, SEASON } = await import('../data/league');
  const { buildMatchBox } = await import('../data/matchBox');
  const { evalAchievements } = await import('../engine/achievements');
  const { seasonToDateTotals, achTotals } = await import('../data/careerTotals');

  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  let fail = 0; const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
  const evalWith = (tot: any) => { const s = G(); return evalAchievements({ myTeamId: my, archive: s.archive, hof: s.hallOfFame, milestones: s.milestones, cash: s.cash, fanScore: s.fanScore, careerLog: s.careerLog, careerTotals: tot }); };
  const u = (st: any[], id: string) => st.find((x) => x.ach.id === id)?.unlocked ?? false;
  const myFix = SEASON.filter((f) => f.homeTeamId === my || f.awayTeamId === my).sort((a, b) => a.dayIndex - b.dayIndex);

  G().selectTeam(my);

  console.log('── EC1: 0경기 → 진행분 0, achTotals==stored(가법 항등) ──');
  const std0 = seasonToDateTotals(my, {});
  ok(std0.points === 0 && std0.matchWins === 0 && std0.setsWon === 0, 'EC1a: 0경기 진행분 전부 0');
  const stored = { points: 60, aces: 5, setsWon: 10, setsLost: 8, matchWins: 3, matchLosses: 2 };
  const comb0 = achTotals(my, stored, {});
  ok(comb0.points === 60 && comb0.matchWins === 3 && comb0.setsWon === 10, 'EC1b: 0경기면 achTotals==stored');
  ok(achTotals(my, undefined, {}).points === 0, 'EC1c: stored undefined + 0경기 → 0(무크래시)');

  console.log('── EC2: 2경기 진행 → 가법성(achTotals == stored + 진행분 필드별) ──');
  for (let i = 0; i < 2; i++) { const f = myFix[i]; const { sim } = buildMatchBox(f.homeTeamId, f.awayTeamId, f.dayIndex, f.seed); G().recordResult({ fixtureId: f.id, homeSets: sim.homeSets, awaySets: sim.awaySets }); G().setDay(f.dayIndex); }
  const cur = seasonToDateTotals(my, G().results);
  ok(cur.points > 0 && (cur.matchWins + cur.matchLosses) === 2, `EC2a: 진행분 points ${cur.points}·경기 ${cur.matchWins + cur.matchLosses}`);
  const A = { points: 500, aces: 10, setsWon: 20, setsLost: 15, matchWins: 8, matchLosses: 5 };
  const sum = achTotals(my, A, G().results);
  ok(sum.points === A.points + cur.points && sum.aces === A.aces + cur.aces && sum.matchWins === A.matchWins + cur.matchWins && sum.setsWon === A.setsWon + cur.setsWon,
    'EC2b: achTotals 가법성(모든 필드 stored+진행분)');

  console.log('── EC3: 임계 크로싱 — 저장+진행분 합이 임계 넘어야 열림(단독 미달) ──');
  const nearK = { points: 1000 - cur.points, aces: 0, setsWon: 0, setsLost: 0, matchWins: 0, matchLosses: 0 };
  ok(!u(evalWith(nearK), 'points_1k'), `EC3a: stored 단독(${nearK.points})은 points_1k(1000) 미달`);
  ok(u(evalWith(achTotals(my, nearK, G().results)), 'points_1k'), 'EC3b: stored+진행분=1000 → points_1k 열림(합산이 임계 판정)');
  // 첫 사건류: 진행분만으로 첫 세트/첫 승 열림(저장 0)
  ok(u(evalWith(achTotals(my, undefined, G().results)), 'first_set_win'), 'EC3c: 저장0+진행분 → first_set_win 열림');

  console.log('── EC4: 오프시즌 campDoneSeason — 멱등 ──');
  const beforeSeason = G().season;
  useGameStore.setState({ campDoneSeason: -1 }); // 리셋 상태 가정
  G().finishCamp(); const c1 = G().campDoneSeason;
  G().finishCamp(); const c2 = G().campDoneSeason;
  ok(c1 === beforeSeason, 'EC4a: finishCamp → campDoneSeason == 현재 시즌');
  ok(c2 === c1, 'EC4b: finishCamp 2회 멱등(값 불변)');

  console.log('── EC5: 새 시즌 리셋 — endSeason 후 campDoneSeason(옛시즌) != 새 시즌(오프시즌 게이트 재개) ──');
  for (const f of SEASON) { if ((f.homeTeamId === my || f.awayTeamId === my) && !G().results[f.id]) { const { sim } = buildMatchBox(f.homeTeamId, f.awayTeamId, f.dayIndex, f.seed); G().recordResult({ fixtureId: f.id, homeSets: sim.homeSets, awaySets: sim.awaySets }); } }
  G().setDay(164); G().endSeason();
  ok(G().season === beforeSeason + 1, `EC5a: 시즌 진행 ${beforeSeason}→${G().season}`);
  ok(G().campDoneSeason !== G().season, `EC5b: campDoneSeason(${G().campDoneSeason}) != 새 시즌(${G().season}) → 오프시즌 재개`);
  ok(G().campDoneSeason === beforeSeason, 'EC5c: campDoneSeason은 옛 시즌값 보존(시즌번호 방식 자동 리셋)');

  console.log(fail === 0 ? '\n✅ 업적/오프시즌 엣지 케이스 전부 통과' : `\n❌ ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
