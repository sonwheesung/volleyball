// 진단 스냅샷 생성기 검증 (BACKEND_SYSTEM §13.6 #45) — 실 store N시즌 구동 후 스냅샷 빌드:
//  ① 범위: 시즌 [max(0,cur-10)..cur]만·미래(>cur) 0·오래된 것(<from) 0  ② 결정론(같은 상태→같은 JSON)
//  ③ 비어있지 않음(다시즌이면 archive·players 존재)  ④ 로그 범위 필터  ⑤ 뉴스 미래 누수 0
// 사용: npx tsx tools/_dv_snapshot.ts [seasons]
import './_gt_mock';

(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { SEASON } = await import('../data/league');
  const { buildMatchBox } = await import('../data/matchBox');
  const { buildDiagnosticSnapshot, SNAPSHOT_SPAN } = await import('../data/diagnosticSnapshot');
  const { ENGINE_VERSION } = await import('../engine/match');

  const SEASONS = parseInt(process.argv[2] ?? '14', 10);
  const G = () => useGameStore.getState();
  for (let yr = 0; yr < SEASONS; yr++) {
    for (const f of SEASON) {
      const { sim } = buildMatchBox(f.homeTeamId, f.awayTeamId, f.dayIndex, f.seed);
      G().recordResult({ fixtureId: f.id, homeSets: sim.homeSets, awaySets: sim.awaySets });
    }
    G().setDay(164);
    G().endSeason();
  }

  const s = G();
  const players = Object.values(s.playerBase ?? {});
  const logs = [
    { t: 1, season: s.season, cat: 'x', msg: 'cur' },
    { t: 2, season: Math.max(0, s.season - 3), cat: 'x', msg: 'in' },
    { t: 3, season: 0, cat: 'x', msg: 'old' }, // 범위 밖(시즌 큰 경우)
    { t: 4, season: s.season + 5, cat: 'x', msg: 'future' }, // 미래(제외돼야)
  ];
  const input = () => ({
    season: s.season, currentDay: s.currentDay, myTeamId: s.selectedTeamId ?? '', engineVersion: ENGINE_VERSION,
    archive: s.archive, milestones: s.milestones, hallOfFame: s.hallOfFame, retirements: s.retirements,
    released: s.released, players, logs, now: 1_700_000_000_000,
  });

  const snap = buildDiagnosticSnapshot(input());
  const from = Math.max(0, s.season - SNAPSHOT_SPAN);
  const fails: string[] = [];
  const ck = (c: boolean, m: string) => { if (!c) fails.push(m); };

  // ① 범위
  ck(snap.meta.fromSeason === from && snap.meta.toSeason === s.season, `범위 meta ${snap.meta.fromSeason}..${snap.meta.toSeason} (기대 ${from}..${s.season})`);
  ck(snap.seasons.every((x) => x.season >= from && x.season <= s.season), '시즌 범위 밖 포함');
  ck(!snap.seasons.some((x) => x.season > s.season), '미래 시즌 포함');
  ck(snap.seasons.length === s.season - from + 1, `시즌 개수 ${snap.seasons.length} (기대 ${s.season - from + 1})`);

  // ⑤ 뉴스/마일스톤/선수라인 미래 누수 0
  for (const x of snap.seasons) {
    ck(x.news.every((n) => n.season === x.season), `뉴스 시즌 불일치 @${x.season}`);
    ck(x.milestones.every((m) => m.season === x.season), `마일스톤 시즌 불일치 @${x.season}`);
  }
  ck(snap.players.every((p) => p.seasonLinesInRange.every((l) => l.season >= from && l.season <= s.season)), '선수 seasonLine 범위 밖');

  // ③ 비어있지 않음(다시즌)
  ck(snap.seasons.some((x) => x.archive), 'archive 전부 비어있음');
  ck(snap.players.length > 0, '범위 내 선수 0명');
  ck(snap.seasons.some((x) => x.news.length > 0), '뉴스 전부 비어있음');

  // ④ 로그 범위 필터(미래·오래된 것 제외)
  ck(!snap.logs.some((e) => e.season > s.season), '로그 미래 포함');
  ck(snap.logs.some((e) => e.msg === 'cur') && snap.logs.some((e) => e.msg === 'in'), '범위 내 로그 누락');
  ck(!snap.logs.some((e) => e.msg === 'future'), '미래 로그 미제외');

  // ② 결정론(같은 상태 → 같은 JSON)
  const a = JSON.stringify(buildDiagnosticSnapshot(input()));
  const b = JSON.stringify(buildDiagnosticSnapshot(input()));
  ck(a === b, '비결정론(같은 입력 다른 출력)');

  console.log(`시즌 ${s.season}(cur) · 범위 ${from}..${s.season} · 시즌블록 ${snap.seasons.length} · 선수 ${snap.players.length} · 뉴스 ${snap.seasons.reduce((n, x) => n + x.news.length, 0)} · 로그 ${snap.logs.length}`);
  console.log(fails.length ? '❌ FAIL\n  ' + fails.join('\n  ') : '✅ 진단 스냅샷 PASS (범위·미래제외·비어있지않음·로그필터·결정론)');
  process.exit(fails.length ? 1 : 0);
})();
