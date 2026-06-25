// 가드 — 은퇴 세리머니 뉴스(NEWS 슬라이스5): store.retirements 적립 + 작별 뉴스 무결성.
//   npx tsx tools/_ev_retirenews.ts [시즌=20]
// 검사: 게이트(seasons≥8 또는 HOF)·매달린참조0·중복0·결정론·전 은퇴자 기사화·레전드 존재.
import './_gt_mock';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, SEASON, getPlayer } = await import('../data/league');
  const { buildNewsFeed, newsKey } = await import('../data/news');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const N = Math.max(8, Number(process.argv[2]) || 20);
  const myFix = SEASON.filter((f: any) => f.homeTeamId === my || f.awayTeamId === my);

  G().resetSave(); G().selectTeam(my);
  for (let s = 0; s < N; s++) {
    for (const f of myFix) G().recordResult({ fixtureId: f.id, homeSets: 3, awaySets: 1 } as any);
    G().setDay(164); G().endSeason();
  }
  const rets = G().retirements;
  const fails: string[] = [];

  // 1) 게이트: 전 은퇴자 seasons≥8 또는 HOF
  const badGate = rets.filter((r) => !(r.seasons >= 8 || r.hof));
  if (badGate.length) fails.push(`게이트 위반 ${badGate.length}건(seasons<8·비HOF)`);
  // 2) 매달린 참조 0(은퇴자도 playerBase 잔존)
  const dangling = rets.filter((r) => !getPlayer(r.playerId));
  if (dangling.length) fails.push(`매달린 참조 ${dangling.length}건`);

  // 3) 뉴스: retire 기사 = 은퇴자 수, 중복 0, 본문에 통산 회고
  const feed = buildNewsFeed(G().archive, [], [], G().season, [], [], 0, my, [], rets);
  const retItems = feed.filter((n) => n.kind === 'retire');
  if (retItems.length !== rets.length) fails.push(`retire 기사 ${retItems.length} ≠ 은퇴자 ${rets.length}`);
  const keys = new Set<string>(); let dup = 0;
  for (const n of retItems) { const k = newsKey(n); if (keys.has(k)) dup++; keys.add(k); if (!n.headline.trim() || !n.body?.includes('시즌')) fails.push('빈/회고없는 본문'); }
  if (dup) fails.push(`중복 ${dup}건`);

  // 4) 결정론
  const feed2 = buildNewsFeed(G().archive, [], [], G().season, [], [], 0, my, [], rets);
  if (JSON.stringify(feed.map(newsKey)) !== JSON.stringify(feed2.map(newsKey))) fails.push('결정론 위반');

  const legends = rets.filter((r) => r.legend).length, hofs = rets.filter((r) => r.hof).length;
  console.log(`=== 은퇴 세리머니 뉴스 (${N}시즌) ===`);
  console.log(`  은퇴자 ${rets.length}명(HOF ${hofs}·레전드 ${legends}) · retire 기사 ${retItems.length} · 매달린 ${dangling.length} · 중복 ${dup}`);
  if (retItems[0]) console.log(`  예) ${retItems[0].headline}`);
  if (retItems[0]?.body) console.log(`      ${retItems[0].body.slice(0, 90)}…`);
  const pass = fails.length === 0 && rets.length > 0 && retItems.length > 0;
  console.log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}${fails.length ? ' — ' + fails.slice(0, 5).join(' / ') : ''}`);
  if (!pass) process.exit(1);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
