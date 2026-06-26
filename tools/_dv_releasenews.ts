// 방출 뉴스 절친 사실 한 줄 — "각별한 동료 XX를 (팀)에 남기고 떠난다"가 실제로 박히나(가짜 드라마 0).
// 자연 표본은 드물어, 친구쌍을 찾아 **합성 방출**을 주입해 결정론적으로 증명 + A/B(절친 없는 방출엔 줄 없음).
//   npx tsx tools/_dv_releasenews.ts
import './_gt_mock';
(async () => {
  const { LEAGUE, getPlayer, currentBasePlayers } = await import('../data/league');
  const { buildNewsFeed } = await import('../data/news');
  const { setRelationContext, topFriendOnTeam } = await import('../data/relationships');
  const { affinity } = await import('../engine/relationships');
  const { teamPlayerIds } = await import('../data/league');
  setRelationContext({}); // bonds 없이도 innate 친구 존재

  // 1) 같은 팀 국내 친구쌍(affinity≥0.4) 찾기
  let pair: { team: string; a: string; b: string } | null = null;
  for (const t of LEAGUE.teams) {
    const ids = teamPlayerIds(t.id).map((id) => getPlayer(id)!).filter((p) => p && !p.isForeign);
    for (let i = 0; i < ids.length && !pair; i++)
      for (let j = i + 1; j < ids.length; j++) {
        if (affinity(ids[i], ids[j], 0, true) >= 0.4) { pair = { team: t.id, a: ids[i].id, b: ids[j].id }; break; }
      }
    if (pair) break;
  }
  const log = (m: string) => process.stdout.write(m + '\n');
  if (!pair) { log('⚠ 친구쌍 없음(시드 이상) — 검증 불가'); process.exit(1); }
  const pa = getPlayer(pair.a)!, pb = getPlayer(pair.b)!;
  log(`친구쌍: ${pa.name}(${pair.a}) ↔ ${pb.name}(${pair.b}) @ ${pair.team} · affinity ${affinity(pa, pb, 0, true).toFixed(2)}`);

  // 2) A를 방출(합성 transfer record). B는 그 팀에 남아 있음 → "절친 B를 남기고 떠난다" 기대.
  const my = LEAGUE.teams[0].id;
  const relTransfer = [{ season: 0, playerId: pair.a, name: pa.name, fromTeam: pair.team, toTeam: '', kind: 'release', ovr: 80 } as any];
  const feed = buildNewsFeed([], [], [], 1, [], [], 0, my, relTransfer, []); // transfers = 9번째 인자

  // 기대 = topFriendOnTeam(A, 그 팀)의 실제 최상위 친구(pb가 아닐 수 있음 — 더 친한 동료가 있으면 그쪽)
  const expected = topFriendOnTeam(pair.a, pair.team)!;
  const relNews = feed.find((n) => n.kind === 'release' && n.body?.includes(pa.name));
  const has = !!relNews && relNews.body!.includes('각별한 동료') && relNews.body!.includes(expected.name);
  log(`기대 최상위 절친: ${expected.name}(affinity ${expected.v.toFixed(2)})`);
  log(`\n[방출+잔류절친] 뉴스: ${relNews ? '생성' : '없음'}`);
  if (relNews) log(`  ${relNews.body}`);
  log(`  → "각별한 동료 ${expected.name}" 포함: ${has ? '✅' : '❌'}`);

  // 3) A/B(허위 오라클 차단): 같은 팀에 친구가 없는 선수를 방출하면 절친 줄이 없어야 함
  //    친구 없는 국내 선수 찾기(그 팀 동료 전원과 affinity<0.4)
  let lonelyId: string | null = null, lonelyTeam = '';
  for (const t of LEAGUE.teams) {
    const ids = teamPlayerIds(t.id).map((id) => getPlayer(id)!).filter((p) => p && !p.isForeign);
    for (const p of ids) {
      const anyFriend = ids.some((q) => q.id !== p.id && affinity(p, q, 0, true) >= 0.4);
      if (!anyFriend) { lonelyId = p.id; lonelyTeam = t.id; break; }
    }
    if (lonelyId) break;
  }
  let abOk = true;
  if (lonelyId) {
    const lp = getPlayer(lonelyId)!;
    const feed2 = buildNewsFeed([], [], [], 1, [], [], 0, my, [{ season: 0, playerId: lonelyId, name: lp.name, fromTeam: lonelyTeam, toTeam: '', kind: 'release', ovr: 80 } as any], []);
    const n2 = feed2.find((n) => n.kind === 'release' && n.body?.includes(lp.name));
    abOk = !!n2 && !n2.body!.includes('각별한 동료');
    log(`\n[A/B 대조] 친구없는 ${lp.name} 방출 → 절친 줄 없음: ${abOk ? '✅' : '❌ (허위 — 친구 없는데 줄 박힘)'}`);
  } else { log('\n[A/B 대조] 친구없는 선수 못 찾음(생략)'); }

  const pass = has && abOk;
  log(`\nRESULT: ${pass ? '✅ PASS' : '❌ FAIL'}`);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
