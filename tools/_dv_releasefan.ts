// 가드 — 스타 방출 → 팬 분노 적립(TRANSACTION_SYSTEM 0.5③ · OWNER_SYSTEM §3.2). 엔진 변경 A/B 측정.
//   핵심 오라클은 **releaseAnger 누적값**(방출 시점 인기로 결정 — 비교란). fanScore 절대낙폭은 winRate 등
//   시즌 재계산과 약결합이라 방향성만 본다. A/B: 스타(인기 높음)=분노 적립, 무명(인기<50)=0(인기 게이트).
//   npx tsx tools/_dv_releasefan.ts [N=8]
import './_gt_mock';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, SEASON, currentRosters, evolveOnDay } = await import('../data/league');
  const { awardHistoryOf } = await import('../data/awards');
  const { popularityOf, releaseAngerPenalty } = await import('../engine/owner');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const N = Math.max(4, Number(process.argv[2]) || 8);
  const myFix = SEASON.filter((f: any) => f.homeTeamId === my || f.awayTeamId === my);
  const fails: string[] = [];

  const build = () => {
    G().resetSave(); G().selectTeam(my);
    for (let s = 0; s < N; s++) { for (const f of myFix) G().recordResult({ fixtureId: f.id, homeSets: 3, awaySets: 1 } as any); G().setDay(164); G().endSeason(); }
    for (const f of myFix) G().recordResult({ fixtureId: f.id, homeSets: 3, awaySets: 1 } as any); G().setDay(164);
    useGameStore.setState({ cash: 99_999_999 }); // 위약금 게이트 비활성(분노만 측정)
  };
  // 안정 명성(career·수상·근속, season=0) — releaseAngerOf와 동일 입력(결정론).
  const statOf = (id: string) => { const p = evolveOnDay(id, 164)!; return popularityOf(p.career.points, awardHistoryOf(G().archive, id).length, p.clubTenure, 0); };

  build();
  const roster = (currentRosters()[my] ?? []).filter((id) => { const p = evolveOnDay(id, 164); return p && !p.isForeign; });
  const ranked = roster.map((id) => ({ id, pop: statOf(id) })).sort((a, b) => b.pop - a.pop);
  const star = ranked[0], scrub = [...ranked].reverse().find((r) => r.pop < 30) ?? ranked[ranked.length - 1];

  // (1) 스타 방출 → releaseAnger == releaseAngerPenalty(인기) (비교란 직접 오라클)
  build();
  G().release(star.id);
  const angerStar = G().releaseAnger;
  const expectStar = releaseAngerPenalty(star.pop);
  if (angerStar !== expectStar) fails.push(`스타 분노 ${angerStar} ≠ 기대 ${expectStar}(인기 ${star.pop})`);
  // (2) 당일 철회 → 분노 환불(0)
  G().unrelease(star.id);
  if (G().releaseAnger !== 0) fails.push(`철회 후 분노 ${G().releaseAnger} ≠ 0`);

  // (3) 무명 방출 → 분노 0 (인기 게이트 — 허위 오라클 차단)
  build();
  G().release(scrub.id);
  const angerScrub = G().releaseAnger;
  if (scrub.pop >= 30) fails.push(`무명 후보 인기 ${scrub.pop} ≥ 30 — 게이트 검증 불가`);
  if (angerScrub !== 0) fails.push(`무명 방출 분노 ${angerScrub} ≠ 0 (인기 ${scrub.pop} 게이트 깨짐)`);

  // (4) fanScore 방향성: 스타 방출 시즌 팬심 < 대조(낙폭 크기는 winRate 약결합이라 방향만)
  build(); G().endSeason(); const fanCtl = G().fanScore;
  build(); G().release(star.id); G().endSeason(); const fanStar = G().fanScore;
  if (!(fanStar < fanCtl)) fails.push(`스타 방출이 팬심을 안 낮춤 (대조 ${fanCtl} · 방출 ${fanStar})`);

  // (5) 페널티 함수 단조성
  if (!(releaseAngerPenalty(65) > releaseAngerPenalty(50) && releaseAngerPenalty(50) > releaseAngerPenalty(35) && releaseAngerPenalty(20) === 0)) fails.push('releaseAngerPenalty 단조/게이트 깨짐');

  console.log('=== 스타 방출 → 팬 분노 측정 (N=' + N + ') ===');
  console.log(`  스타 ${evolveOnDay(star.id, 164)?.name}(인기 ${star.pop}) → 분노 ${angerStar}(기대 ${expectStar}) · 철회 후 ${0}`);
  console.log(`  무명 ${evolveOnDay(scrub.id, 164)?.name}(인기 ${scrub.pop}) → 분노 ${angerScrub} (인기 게이트)`);
  console.log(`  팬심 방향성: 대조 ${fanCtl} · 스타 방출 ${fanStar} (낙폭 ${fanCtl - fanStar}, winRate 약결합이라 크기는 참고)`);
  console.log(`\nRESULT: ${fails.length === 0 ? 'PASS' : 'FAIL — ' + fails.join(' / ')}`);
  if (fails.length) process.exit(1);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
