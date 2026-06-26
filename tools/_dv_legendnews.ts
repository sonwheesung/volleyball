// 헌액 번호/계보 뉴스 실제 렌더 확인 — 레전드 HOF·은퇴 기사 본문에 '헌액 번호 N번'·계보 사실이 박히는지.
//   npx tsx tools/_dv_legendnews.ts [시즌=60]
import './_gt_mock';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, SEASON } = await import('../data/league');
  const { buildNewsFeed } = await import('../data/news');
  const { jerseyNumber } = await import('../engine/jersey');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const N = Math.max(8, Number(process.argv[2]) || 60);
  const myFix = SEASON.filter((f: any) => f.homeTeamId === my || f.awayTeamId === my);
  G().resetSave(); G().selectTeam(my);
  for (let s = 0; s < N; s++) { for (const f of myFix) G().recordResult({ fixtureId: f.id, homeSets: 3, awaySets: 1 } as any); G().setDay(164); G().endSeason(); }

  const hof = G().hallOfFame;
  const legends = hof.filter((h) => h.legend);
  const feed = buildNewsFeed(G().archive, [], hof, G().season, [], [], 0, my, [], G().retirements);
  console.log(`=== 레전드 ${legends.length}명 (HOF ${hof.length}) — ${N}시즌 ===`);
  for (const L of legends.slice(0, 6)) {
    const num = jerseyNumber(L.id);
    console.log(`\n• ${L.name} (${L.teamId}) · 헌액 번호 ${num}번 · 통산 ${L.points.toLocaleString()}점 · ${L.retiredSeason + 1}시즌 은퇴`);
    const item = feed.find((n) => n.kind === 'hof' && n.body?.includes(L.name));
    if (item) console.log(`  HEAD: ${item.headline}\n  BODY: ${item.body}`);
  }
  // 같은 번호 충돌(계보) 있는지 — 같은 팀 같은 번호 레전드 2명 이상
  const grp: Record<string, string[]> = {};
  for (const L of legends) (grp[`${L.teamId}#${jerseyNumber(L.id)}`] ??= []).push(L.name);
  const collides = Object.entries(grp).filter(([, v]) => v.length >= 2);
  console.log(`\n번호 계보 발생(같은 팀·같은 번호 레전드 2+): ${collides.length}건` + (collides.length ? ' → ' + collides.map(([k, v]) => `${k}:${v.join('/')}`).join(', ') : ' (이 표본엔 없음 — 희귀)'));
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
