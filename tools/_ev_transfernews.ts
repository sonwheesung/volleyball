// 측정·가드 — 타팀 이적/방출 뉴스(NEWS_SYSTEM 슬라이스4). 실제 store.endSeason을 N시즌 구동해
//   transfers 연표(이적+방출)를 쌓고, 볼륨(노이즈 게이트 튜닝)·무결성(매달린참조·중복)·결정론을 검사.
//   npx tsx tools/_ev_transfernews.ts [시즌=12]
// 통과 기준: 시즌당 타팀 기사 소수(노이즈 아님)·내 팀 항상·매달린참조 0·중복 0·결정론 일치.
import './_gt_mock';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, SEASON, getPlayer } = await import('../data/league');
  const { buildNewsFeed, newsKey } = await import('../data/news');
  const { overall } = await import('../engine/overall');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const N = Math.max(2, Number(process.argv[2]) || 12);
  const myFix = SEASON.filter((f: any) => f.homeTeamId === my || f.awayTeamId === my);

  // 단일 런(in-process 다중 resetSave는 §3.6 레지스트리 누수로 S1+ 비결정 — 결정론은 뉴스 재빌드로 검사).
  G().resetSave(); G().selectTeam(my);
  const movedPop: { ovr: number; kind: 'release' | 'transfer'; mine: boolean }[] = []; // 게이트 전 전체 이동 모집단(보정용)
  for (let s = 0; s < N; s++) {
    const before = JSON.parse(JSON.stringify((await import('../data/league')).currentRosters()));
    for (const f of myFix) G().recordResult({ fixtureId: f.id, homeSets: 3, awaySets: 1 } as any);
    G().setDay(164); G().endSeason();
    // 게이트 전 모집단: 직전 명단 선수가 새 명단서 사라졌나(방출) / 다른 팀인가(이적)
    const after = (await import('../data/league')).currentRosters();
    const ownerNow: Record<string, string> = {};
    for (const t of Object.keys(after)) for (const id of after[t]) ownerNow[id] = t;
    for (const t of Object.keys(before)) for (const id of before[t]) {
      const p = getPlayer(id); if (!p || p.isForeign) continue;
      const now = ownerNow[id];
      if (!now) movedPop.push({ ovr: overall(p), kind: 'release', mine: t === my });
      else if (now !== t) movedPop.push({ ovr: overall(p), kind: 'transfer', mine: t === my || now === my });
    }
  }
  const A = { transfers: G().transfers, archive: G().archive, season: G().season };
  const tr = A.transfers;
  const releases = tr.filter((t) => t.kind === 'release');
  const transfers = tr.filter((t) => t.kind !== 'release');
  const relMine = releases.filter((t) => t.fromTeam === my);
  const relOther = releases.filter((t) => t.fromTeam !== my);
  const trOther = transfers.filter((t) => t.toTeam !== my && t.fromTeam !== my);

  const fails: string[] = [];
  // 1) 매달린 참조 0 — 모든 이적/방출 선수가 실존(방출자도 playerBase에 잔존)
  const dangling = tr.filter((t) => !getPlayer(t.playerId));
  if (dangling.length) fails.push(`매달린 참조 ${dangling.length}건`);
  // 2) 방출 toTeam='' 정합 + fromTeam 존재
  const badRel = releases.filter((t) => t.toTeam !== '' || !t.fromTeam);
  if (badRel.length) fails.push(`방출 레코드 형식 위반 ${badRel.length}건(toTeam≠''/fromTeam 없음)`);
  // 3) 타팀 이동은 거물(이동 시점 OVR≥REL_NEWS_OVR=71)만 — 노이즈 게이트 실증(내 팀은 OVR 무관).
  //    저장된 t.ovr(이동 시점)로 검사 — 이후 노쇠로 getPlayer OVR이 낮아져도 게이트 판정은 그대로.
  const GATE = 71;
  const leak = [...relOther, ...trOther].filter((t) => (t.ovr ?? 0) < GATE);
  if (leak.length) fails.push(`타팀 비거물 누수 ${leak.length}건(게이트 무력)`);

  // 4) 뉴스 빌드 — release/transfer 기사 중복 0, 빈 헤드라인 0
  const feed = buildNewsFeed(A.archive, [], [], A.season, [], [], 0, my, tr);
  const relItems = feed.filter((n) => n.kind === 'release');
  const trItems = feed.filter((n) => n.kind === 'transfer');
  const keys = new Set<string>(); let dup = 0;
  for (const n of [...relItems, ...trItems]) { const k = newsKey(n); if (keys.has(k)) dup++; keys.add(k); if (!n.headline.trim()) fails.push('빈 헤드라인'); }
  if (dup) fails.push(`뉴스 중복 ${dup}건`);

  // 5b) 엣지 — 구세이브 범람 차단: ovr 없는 타팀 이적(구버전 무게이트 로그)은 렌더서 숨김. 내 팀 무게이트는 보임.
  const others = LEAGUE.teams.filter((t) => t.id !== my);
  const legacyOther = { season: Math.max(0, A.season - 1), playerId: 'legacy-x', name: '구이적', fromTeam: others[0].id, toTeam: others[1].id }; // ovr 없음
  const legacyMine = { season: Math.max(0, A.season - 1), playerId: 'legacy-m', name: '구내이적', fromTeam: others[0].id, toTeam: my };       // ovr 없음·내 팀
  const feedLegacy = buildNewsFeed(A.archive, [], [], A.season, [], [], 0, my, [legacyOther, legacyMine] as any);
  if (feedLegacy.some((n) => n.ref === 'legacy-x')) fails.push('구세이브 타팀 무게이트 이적이 렌더됨(범람)');
  if (!feedLegacy.some((n) => n.ref === 'legacy-m')) fails.push('구세이브 내 팀 이적이 숨겨짐(과교정)');

  // 5) 결정론(내 코드) — 같은 transfers·archive로 뉴스 두 번 빌드 == 동일(resetSave 누수 회피)
  const feed2 = buildNewsFeed(A.archive, [], [], A.season, [], [], 0, my, tr);
  const same = JSON.stringify(feed.map(newsKey)) === JSON.stringify(feed2.map(newsKey));
  if (!same) fails.push('결정론 위반(뉴스 재빌드 상이)');

  // 5c) 방출 렌더 실증(합성 — seed-robust). 조직 방출은 시나리오(내 팀 전승 강팀)에 따라 0건일 수 있어
  //     "조직 방출 존재"에 의존하면 브리틀(엔진 seed 드리프트로 #48류 재발). 대신 합성 방출 1건으로 게이트·문구 경로를 결정론 검증.
  const relSubject = (await import('../data/league')).currentRosters()[my]?.[0];
  const synthRel = { season: A.season, playerId: relSubject, name: '방출테스트', fromTeam: my, toTeam: '', ovr: 85, kind: 'release' as const };
  const feedSynth = buildNewsFeed(A.archive, [], [], A.season, [], [], 0, my, [synthRel] as any);
  const synthItem = feedSynth.find((n) => n.kind === 'release' && n.ref === relSubject);
  if (!synthItem) fails.push('합성 방출이 렌더되지 않음(release 경로 실패)');
  else if (!synthItem.headline.trim() || !synthItem.body?.trim()) fails.push('합성 방출 빈 헤드/본문');

  // ── 보정 진단: 게이트 전 이동 모집단의 OVR 분포(REL_NEWS_OVR 튜닝 근거) ──
  const otherPop = movedPop.filter((m) => !m.mine);
  const bucket = (lo: number, hi: number) => otherPop.filter((m) => m.ovr >= lo && m.ovr < hi).length;
  const perSeasonOther = (relOther.length + trOther.length) / N;
  console.log(`=== 타팀 이적/방출 뉴스 (${N}시즌, 엔진 실측) ===`);
  console.log(`  [보정] 게이트 전 타팀 이동 모집단 ${otherPop.length}건 OVR분포: <70:${bucket(0,70)} 70-74:${bucket(70,74)} 74-78:${bucket(74,78)} 78-82:${bucket(78,82)} 82+:${bucket(82,99)} (방출 ${otherPop.filter(m=>m.kind==='release').length}·이적 ${otherPop.filter(m=>m.kind==='transfer').length})`);
  console.log(`  연표 총 ${tr.length}건 = 이적 ${transfers.length}(타팀 ${trOther.length}) · 방출 ${releases.length}(내팀 ${relMine.length}·타팀 ${relOther.length})`);
  console.log(`  타팀 기사/시즌 = ${perSeasonOther.toFixed(1)}건 (목표: 한 자릿수~십수)`);
  console.log(`  뉴스: release ${relItems.length}건 · transfer ${trItems.length}건 · 매달린참조 ${dangling.length} · 중복 ${dup} · 결정론 ${same ? 'OK' : 'FAIL'}`);
  if (relItems[0]) console.log(`  예) ${relItems[0].headline}`);
  const trOtherItem = trItems.find((n) => trOther.some((t) => t.playerId === n.ref));
  if (trOtherItem) console.log(`  예) ${trOtherItem.headline}`);
  // pass: 무결성 0 + 합성 방출 렌더 실증(위) + 볼륨 노이즈 아님. 조직 방출 존재는 요구하지 않음(seed-robust, 5c로 대체).
  const pass = fails.length === 0 && perSeasonOther <= 40;
  console.log(`  A/B: 타팀 방출 존재=${relOther.length > 0} · 내팀 방출 존재=${relMine.length > 0} · 타팀 이적 존재=${trOther.length > 0}`);
  console.log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}${fails.length ? ' — ' + fails.join(' / ') : ''}`);
  if (!pass) process.exit(1);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
