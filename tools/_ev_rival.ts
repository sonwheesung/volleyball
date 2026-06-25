// 가드 — 라이벌 구도(CLUB_IDENTITY 6): rivalOf가 순위 인접·접전 상대전적에서 숙적을 정확히 고르는가.
//   npx tsx tools/_ev_rival.ts [시즌=12]
// (A) 합성 A/B: ±1위 반복 팀=라이벌·먼 팀 제외·무인접=null·접전 가중. (B) 실경기: 유효 라이벌·독립최대·결정론.
import './_gt_mock';
(async () => {
  const { rivalOf } = await import('../data/rivalry');
  const fails: string[] = [];

  // ── (A) 합성 ──
  const teams = ['me', 'X', 'Y', 'Z', 'W', 'V', 'U', 'T'];
  // me는 매 시즌 2위, X는 1위(±1 인접) 4회, Y는 8위(먼) — 라이벌=X
  const arch = (rankOrder: string[]): any => ({ season: 0, championId: '', awards: {}, standings: rankOrder });
  const order = ['X', 'me', 'Z', 'W', 'V', 'U', 'T', 'Y']; // me=2위·X=1위(인접)·Y=8위
  const archive4 = [arch(order), arch(order), arch(order), arch(order)];
  const r1 = rivalOf('me', archive4, {}, [], teams);
  if (r1?.teamId !== 'X') fails.push(`±1위 반복 팀이 라이벌 아님(got ${r1?.teamId})`);
  if (r1 && r1.teamId === 'Y') fails.push('먼 팀(8위)이 라이벌');
  // 무인접(me 2위지만 1·3위가 매 시즌 바뀜·충분 누적 없음) → null
  const r2 = rivalOf('me', [arch(['A', 'me', 'B', 'C', 'D', 'E', 'F', 'G'])], {}, [], ['me', 'A', 'B', 'C', 'D', 'E', 'F', 'G']);
  if (r2 !== null) fails.push(`1시즌 인접만(점수<3)인데 라이벌(got ${r2?.teamId})`);
  // 접전 상대전적 가중 — Z와 풀세트 접전 3회면 라이벌
  const fixtures = [1, 2, 3].map((i) => ({ id: `f${i}`, round: i, dayIndex: i, homeTeamId: 'me', awayTeamId: 'Z', seed: i } as any));
  const results: any = { f1: { fixtureId: 'f1', homeSets: 3, awaySets: 2 }, f2: { fixtureId: 'f2', homeSets: 2, awaySets: 3 }, f3: { fixtureId: 'f3', homeSets: 3, awaySets: 2 } };
  const r3 = rivalOf('me', [], results, fixtures, teams);
  if (r3?.teamId !== 'Z') fails.push(`접전 3회 상대가 라이벌 아님(got ${r3?.teamId})`);
  if (r3 && r3.close !== 3) fails.push(`접전 카운트 ${r3.close}≠3`);
  // A/B 깬입력: 인접/접전 모두 없으면 null
  const r4 = rivalOf('me', [], {}, [], teams);
  if (r4 !== null) fails.push('데이터 없는데 라이벌 생성(오검출)');

  // ── (B) 실경기 ──
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, SEASON } = await import('../data/league');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const myFix = SEASON.filter((f: any) => f.homeTeamId === my || f.awayTeamId === my);
  G().resetSave(); G().selectTeam(my);
  const N = Math.max(6, Number(process.argv[2]) || 12);
  for (let s = 0; s < N; s++) { for (const f of myFix) G().recordResult({ fixtureId: f.id, homeSets: 3, awaySets: 1 } as any); G().setDay(164); G().endSeason(); }
  for (const f of myFix.slice(0, 4)) G().recordResult({ fixtureId: f.id, homeSets: 3, awaySets: 2 } as any); // 이번 시즌 접전 일부
  const allTeams = LEAGUE.teams.map((t) => t.id);
  const rv = rivalOf(my, G().archive, G().results, SEASON, allTeams);
  if (rv) {
    if (rv.teamId === my || !allTeams.includes(rv.teamId)) fails.push(`실경기 라이벌 무효(${rv.teamId})`);
    // 독립 최대 검증
    const adj: Record<string, number> = {};
    for (const a of G().archive.slice(-5)) { const o = a.standings; if (!o) continue; const mr = o.indexOf(my); if (mr < 0) continue; for (let r = 0; r < o.length; r++) if (o[r] !== my && Math.abs(r - mr) <= 1) adj[o[r]] = (adj[o[r]] ?? 0) + 1; }
    let bestAdj = -1, bestT = ''; for (const t of allTeams) if (t !== my && (adj[t] ?? 0) > bestAdj) { bestAdj = adj[t] ?? 0; bestT = t; }
    // 라이벌은 인접 최다 근처여야(접전 가중으로 약간 달라질 수 있어 인접≥최대−1만 확인)
    if ((adj[rv.teamId] ?? 0) < bestAdj - 1) fails.push(`라이벌 인접 ${adj[rv.teamId] ?? 0} ≪ 최대 ${bestAdj}`);
  }
  const rv2 = rivalOf(my, G().archive, G().results, SEASON, allTeams);
  if (JSON.stringify(rv) !== JSON.stringify(rv2)) fails.push('결정론 위반');

  console.log('=== 라이벌 구도 검증 ===');
  console.log(`  합성: ±1위반복=라이벌(${r1?.teamId}) · 1시즌만=null · 접전3회=라이벌(${r3?.teamId}) · 무데이터=null`);
  console.log(`  실경기(${N}시즌): 라이벌 ${rv ? `${rv.teamId}(인접 ${rv.adjacent}·${rv.h2hW}승${rv.h2hL}패·접전 ${rv.close})` : '없음'}`);
  const pass = fails.length === 0;
  console.log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}${fails.length ? ' — ' + fails.slice(0, 5).join(' / ') : ''}`);
  if (!pass) process.exit(1);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
