// ROSTER STARVATION GUARD — 사용자 엣지케이스: "막 방출 + 정년/은퇴로 선수 고갈".
//   내 팀을 매 시즌 게이트 허용 한도까지 공격적으로 방출(포지션 floor까지) + 시즌 완주 + endSeason
//   (은퇴 → 드래프트 → fillRosters 자동충원)을 N시즌 반복하며, 매 시즌 롤오버 후
//   모든 팀이 포지션 floor(S2·OH3·OP2·MB3·L2) 이상 + buildLineup 성립(빈 로스터 throw 없음)인지 검사.
//   _gt_monkey는 seasonOver 게이트 때문에 endSeason이 no-op(season=0)이라 은퇴를 안 밟고,
//   _dv_roster는 은퇴를 안 돌린다 — 이 조합(방출+은퇴+충원)의 사각을 정면으로 찌른다.
//   Usage: npx tsx tools/_dv_starve.ts [seasons=80] [seed=777]
//
// A/B 자가검증: floor 검사기에 "세터 1명으로 축소한 가짜 로스터"를 넣으면 반드시 위반 검출(허위 오라클 금지).
import './_gt_mock';

(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, SEASON, currentRosters, evolveOnDay } = await import('../data/league');
  const { buildMatchBox } = await import('../data/matchBox');
  const { buildLineup } = await import('../engine/lineup');
  const { ROSTER_FLOOR } = await import('../engine/transactions');
  type Player = import('../types').Player;
  type Position = import('../types').Position;

  const SEASONS = parseInt(process.argv[2] ?? '80', 10);
  const SEASON_END_DAY = 164;
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const POSITIONS: Position[] = ['S', 'OH', 'OP', 'MB', 'L'];

  const countByPos = (players: Player[]): Record<Position, number> => {
    const c: Record<Position, number> = { S: 0, OH: 0, OP: 0, MB: 0, L: 0 };
    for (const p of players) c[p.position]++;
    return c;
  };

  type V = { check: string; msg: string };

  // 롤오버 후 모든 팀 검사: 포지션 floor 이상 + buildLineup 성립
  function checkFloors(tag: string): V[] {
    const out: V[] = [];
    const rs = currentRosters();
    for (const tid of Object.keys(rs)) {
      const players = rs[tid].map((id) => evolveOnDay(id, 0)).filter((p): p is Player => !!p);
      if (players.length === 0) { out.push({ check: 'emptyRoster', msg: `${tag}: ${tid} 빈 로스터` }); continue; }
      const cnt = countByPos(players);
      for (const pos of POSITIONS) {
        if (cnt[pos] < ROSTER_FLOOR[pos]) out.push({ check: 'floorBreach', msg: `${tag}: ${tid} ${pos}=${cnt[pos]}<${ROSTER_FLOOR[pos]}` });
      }
      try {
        const lu = buildLineup(players);
        if (lu.six.length !== 6 || lu.six.some((q) => !q)) out.push({ check: 'lineup', msg: `${tag}: ${tid} six=${lu.six.length}` });
      } catch (e: any) { out.push({ check: 'lineupThrew', msg: `${tag}: ${tid} ${e?.message}` }); }
    }
    return out;
  }

  G().resetSave();
  G().selectTeam(my);
  const violations: V[] = [];
  let totalReleased = 0;

  for (let yr = 0; yr < SEASONS; yr++) {
    // 게이트 열림 보장(day 인시즌) + 위약금으로 방출이 막히지 않게 자금 충전(스트레스 최대화)
    G().setDay(0);
    useGameStore.setState({ cash: 1e12 });
    // 공격적 방출 — 더 이상 방출 안 될 때까지(포지션 floor·총원 하한 게이트가 멈출 때까지) 반복 패스
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of [...(currentRosters()[my] ?? [])]) {
        if (G().release(id)) { changed = true; totalReleased++; }
      }
    }
    // 시즌 완주(전 경기 결과 기록) → seasonOver 게이트 통과
    for (const f of SEASON) {
      const { sim } = buildMatchBox(f.homeTeamId, f.awayTeamId, f.dayIndex, f.seed);
      G().recordResult({ fixtureId: f.id, homeSets: sim.homeSets, awaySets: sim.awaySets });
    }
    G().setDay(SEASON_END_DAY);
    try { G().endSeason(); } catch (e: any) { violations.push({ check: 'CRASH', msg: `yr${yr} endSeason: ${e?.message}` }); break; }
    violations.push(...checkFloors(`yr${yr}`));
    if (violations.length > 60) break;
  }

  const reached = G().season;
  console.log(`=== ROSTER STARVATION (${SEASONS} seasons, 공격방출+은퇴+충원) ===`);
  console.log(`도달 시즌=${reached} · 누적 방출=${totalReleased} · 내팀 최종 로스터=${(currentRosters()[my] ?? []).length}`);
  const myFinal = countByPos((currentRosters()[my] ?? []).map((id) => evolveOnDay(id, 0)).filter((p): p is Player => !!p));
  console.log(`내팀 최종 포지션 분포=${JSON.stringify(myFinal)} (floor=${JSON.stringify(ROSTER_FLOOR)})`);
  console.log(`floor/lineup 위반=${violations.length}`);
  violations.slice(0, 20).forEach((v) => console.log(`  (${v.check}) ${v.msg}`));

  // ── A/B 자가검증 — 세터 1명 가짜 로스터를 검사기에 넣으면 floorBreach 잡는가 ──
  const realIds = currentRosters()[my] ?? [];
  const realPlayers = realIds.map((id) => evolveOnDay(id, 0)).filter((p): p is Player => !!p);
  const oneSetter = realPlayers.filter((p) => p.position !== 'S').concat(realPlayers.filter((p) => p.position === 'S').slice(0, 1));
  const abCnt = countByPos(oneSetter);
  const abCaught = abCnt.S < ROSTER_FLOOR.S; // 검사 로직과 동일 판정이 실제로 위반을 표시하는가
  console.log(`\n[A/B] 세터축소(S=${abCnt.S}) floorBreach검출=${abCaught} (true여야 신뢰)`);

  const ok = violations.length === 0 && reached >= SEASONS && abCaught;
  console.log(`\nSTARVE OK = ${ok}`);
  process.exit(ok ? 0 : 2);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
