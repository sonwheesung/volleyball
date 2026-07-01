// A8 검증 — 선수 상세 "시즌별 소속팀(seasonLines)" + "수상 이력(awardHistoryOf)"이 실제로 채워지는지.
// 실제 store를 N시즌 구동(전 경기 결과 기록→endSeason) 후 베테랑 선수를 들여다본다(재구현 오라클 금지).
// Usage: npx tsx tools/_a8_verify.ts [seasons] [seed]
import './_gt_mock';

(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { SEASON } = await import('../data/league');
  const { buildMatchBox } = await import('../data/matchBox');
  const { awardHistoryOf } = await import('../data/awards');
  const { getEvolvedPlayer } = await import('../data/league');

  const SEASONS = parseInt(process.argv[2] ?? '14', 10);
  const SEASON_END_DAY = 164;
  const G = () => useGameStore.getState();

  for (let yr = 0; yr < SEASONS; yr++) {
    for (const f of SEASON) {
      const { sim } = buildMatchBox(f.homeTeamId, f.awayTeamId, f.dayIndex, f.seed);
      G().recordResult({ fixtureId: f.id, homeSets: sim.homeSets, awaySets: sim.awaySets });
    }
    G().setDay(SEASON_END_DAY);
    G().endSeason();
  }

  const s = G();
  const base = s.playerBase ?? {};
  const ids = Object.keys(base);
  console.log(`시즌 진행: ${s.season} · 선수 베이스 ${ids.length}명`);

  let withLines = 0, multiTeam = 0, maxLines = 0;
  const teamChangers: string[] = [];
  for (const id of ids) {
    const sl = base[id].seasonLines ?? [];
    if (sl.length > 0) withLines++;
    maxLines = Math.max(maxLines, sl.length);
    const teams = new Set(sl.map((l) => l.teamId));
    if (teams.size > 1) { multiTeam++; if (teamChangers.length < 5) teamChangers.push(id); }
  }
  console.log(`seasonLines 보유: ${withLines}/${ids.length} · 최다 ${maxLines}시즌 · 다팀(이적이력) ${multiTeam}명`);

  let withAwards = 0; const awardSamples: string[] = [];
  for (const id of ids) {
    const ah = awardHistoryOf(s.archive, id);
    if (ah.length > 0) { withAwards++; if (awardSamples.length < 3) awardSamples.push(id); }
  }
  console.log(`수상 이력 보유: ${withAwards}명`);

  console.log('\n=== 이적 이력 샘플(시즌별 소속팀) ===');
  for (const id of teamChangers.slice(0, 3)) {
    const p = getEvolvedPlayer(id, s.currentDay) ?? base[id];
    console.log(`\n[${p.name}] ${p.position} ${p.age}세`);
    for (const l of (base[id].seasonLines ?? [])) {
      console.log(`  ${l.season + 1}시즌 · ${l.teamId} · ${l.matches}경기 ${l.points}점`);
    }
  }

  console.log('\n=== 수상 이력 샘플 ===');
  for (const id of awardSamples) {
    const p = base[id];
    console.log(`\n[${p.name}]`);
    for (const a of awardHistoryOf(s.archive, id)) console.log(`  ${a.season + 1}시즌 · ${a.label}`);
  }

  const pass = withLines > 50 && multiTeam > 0 && withAwards > 0 && maxLines >= 3;
  console.log(`\n${pass ? 'PASS' : 'FAIL'} — seasonLines(다팀 이력 포함)·수상 이력 모두 채워짐: ${pass}`);
  process.exit(pass ? 0 : 1);
})();
