// 업적 시즌중 반영 가드 (ACHIEVEMENT — 2026-07-04 사용자 버그 12e03390) — 통산 업적(첫 득점·첫 승…)이
// 시즌 중에도 실시간으로 열리는지 + 시즌 경계 이중계산이 없는지 실제 store를 구동해 검증(재구현 오라클 금지).
// (A) 버그 재현: 저장 careerTotals(시즌 중 0)로 평가 → 통산 잠김.  (B) 수정: achTotals(저장+진행분) → 열림.
// (C) 이중계산 없음: 시즌 끝 endSeason 후 새 시즌 진행분 0 · stored 누적.
// Usage: npx tsx tools/_gt_achmid.ts
import './_gt_mock';

(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, SEASON } = await import('../data/league');
  const { buildMatchBox } = await import('../data/matchBox');
  const { evalAchievements } = await import('../engine/achievements');
  const { seasonToDateTotals, achTotals } = await import('../data/careerTotals');

  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  G().selectTeam(my);

  const evalWith = (tot: any) => { const s = G(); return evalAchievements({ myTeamId: my, archive: s.archive, hof: s.hallOfFame, milestones: s.milestones, cash: s.cash, fanScore: s.fanScore, careerLog: s.careerLog, careerTotals: tot }); };
  const unlocked = (st: any[], id: string) => st.find((x) => x.ach.id === id)?.unlocked ?? false;

  // 내 팀 첫 3경기 진행(실제 게임처럼 recordResult + setDay)
  const myFix = SEASON.filter((f) => f.homeTeamId === my || f.awayTeamId === my).sort((a, b) => a.dayIndex - b.dayIndex);
  for (let i = 0; i < 3; i++) { const f = myFix[i]; const { sim } = buildMatchBox(f.homeTeamId, f.awayTeamId, f.dayIndex, f.seed); G().recordResult({ fixtureId: f.id, homeSets: sim.homeSets, awaySets: sim.awaySets }); G().setDay(f.dayIndex); }

  const s = G();
  const stored = s.careerTotals;
  const std = seasonToDateTotals(my, s.results);
  const comb = achTotals(my, s.careerTotals, s.results);
  console.log('stored careerTotals:', JSON.stringify(stored));
  console.log('seasonToDate(진행분):', JSON.stringify(std));
  console.log('combined(achTotals):', JSON.stringify(comb));

  let fail = 0; const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

  console.log('\n── (A) 버그 재현: 저장 careerTotals(시즌중 0)로 평가 → 통산 잠김 ──');
  const stRaw = evalWith(stored);
  ok(stored.points === 0, `저장 careerTotals.points === 0 (시즌 중 미누적, 버그 원인)`);
  ok(unlocked(stRaw, 'first_point') === false, `raw로 first_point 잠김(재현)`);
  ok(unlocked(stRaw, 'first_match_win') === false && unlocked(stRaw, 'first_match_loss') === false, `raw로 첫 승/패 잠김(재현)`);

  console.log('\n── (B) 수정: achTotals(저장+진행분)로 평가 → 통산 열림 ──');
  const stFix = evalWith(comb);
  ok(std.points > 0, `진행분 points > 0 (${std.points})`);
  ok((std.matchWins + std.matchLosses) === 3, `진행분 경기수 == 3 (${std.matchWins}승 ${std.matchLosses}패)`);
  ok(unlocked(stFix, 'first_point') === true, `수정 후 first_point 열림`);
  ok(unlocked(stFix, 'first_set_win') === true, `수정 후 first_set_win 열림`);
  ok(unlocked(stFix, 'first_match_win') || unlocked(stFix, 'first_match_loss'), `수정 후 첫 승 또는 첫 패 열림`);

  console.log('\n── (C) 이중계산 없음: 시즌 완주 → endSeason → 새 시즌 진행분 0 · stored 누적 ──');
  for (const f of SEASON) { if ((f.homeTeamId === my || f.awayTeamId === my) && !G().results[f.id]) { const { sim } = buildMatchBox(f.homeTeamId, f.awayTeamId, f.dayIndex, f.seed); G().recordResult({ fixtureId: f.id, homeSets: sim.homeSets, awaySets: sim.awaySets }); } }
  const endStd = seasonToDateTotals(my, G().results); // 시즌말 진행분
  G().setDay(164); G().endSeason();
  const s2 = G();
  const std2 = seasonToDateTotals(my, s2.results); // 새 시즌 0경기
  ok(std2.points === 0 && std2.matchWins === 0 && std2.matchLosses === 0, `새 시즌 진행분 0 (이중계산 없음)`);
  ok(s2.careerTotals.points > 0, `endSeason 후 stored 누적됨 (points ${s2.careerTotals.points})`);
  // 이음매: endSeason이 더한 값 ≈ 시즌말 진행분(같은 공식·cutoff MAX). setsWon/matchWins 정합만 확인(production은 캐시 타이밍 무관하게 동일).
  ok(s2.careerTotals.matchWins === endStd.matchWins && s2.careerTotals.matchLosses === endStd.matchLosses,
    `stored 승패 == 시즌말 진행분 승패 (${s2.careerTotals.matchWins}-${s2.careerTotals.matchLosses} == ${endStd.matchWins}-${endStd.matchLosses}) — 이음매 정합`);

  console.log(fail === 0 ? '\n✅ 통산 업적 시즌중 실시간 반영 + 이중계산 없음(이음매 정합)' : `\n❌ ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
