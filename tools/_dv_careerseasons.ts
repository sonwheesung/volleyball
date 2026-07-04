// 선수 상세 "통산 기록 (N시즌)" 표시 분모 가드 (EC-REC 신설, 2026-07-04 사용자 실기기 발견).
//   버그: 헤더가 career.seasons(시드 age-19 백스토리 포함)를 썼는데, 그 아래 통산 숫자·시즌별기록은
//         인게임 시즌(seasonLines)만 반영 → "4시즌 68경기"처럼 시즌 수와 데이터가 불일치.
//   진실: 표시 분모는 seasonLines.length(=career.matches를 만든 인게임 시즌 수)여야 한다.
// Usage: npx tsx tools/_dv_careerseasons.ts [seasons]
import './_gt_mock';

(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { SEASON } = await import('../data/league');
  const { buildMatchBox } = await import('../data/matchBox');
  const SEASONS = parseInt(process.argv[2] ?? '3', 10);
  const G = () => useGameStore.getState();

  for (let yr = 0; yr < SEASONS; yr++) {
    for (const f of SEASON) {
      const { sim } = buildMatchBox(f.homeTeamId, f.awayTeamId, f.dayIndex, f.seed);
      G().recordResult({ fixtureId: f.id, homeSets: sim.homeSets, awaySets: sim.awaySets });
    }
    G().setDay(164);
    G().endSeason();
  }

  const base = G().playerBase ?? {};
  const players = Object.values(base).filter((p) => (p.career?.matches ?? 0) > 0);
  let fail = 0;
  const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ ' + m); fail++; } else console.log('  ✓ ' + m); };

  // [1] 통산 숫자가 seasonLines로 완전히 설명되는가 (→ 올바른 분모 = seasonLines.length)
  let matchMismatch = 0, sample = '';
  for (const p of players) {
    const sl = p.seasonLines ?? [];
    const sum = sl.reduce((n, l) => n + l.matches, 0);
    if (sum !== p.career.matches) { matchMismatch++; if (!sample) sample = `${p.name}: Σlines=${sum} career.matches=${p.career.matches}`; }
  }
  ok(matchMismatch === 0, `통산 경기수 == Σ(seasonLines.matches) 전원 일치(분모=seasonLines.length 정당). 불일치 ${matchMismatch}명 ${sample}`);

  // [2] 버그 재현: 시드 베테랑은 career.seasons > seasonLines.length (헤더가 백스토리까지 세서 과다)
  const overCounters = players.filter((p) => p.career.seasons > (p.seasonLines?.length ?? 0));
  ok(overCounters.length > 0, `career.seasons > seasonLines.length 인 선수 존재(구 헤더 과다표시 재현): ${overCounters.length}명`);
  const ex = overCounters.sort((a, b) => (b.career.seasons - (b.seasonLines?.length ?? 0)) - (a.career.seasons - (a.seasonLines?.length ?? 0)))[0];
  if (ex) console.log(`      예: ${ex.name} ${ex.age}세 — 헤더(career.seasons)=${ex.career.seasons} vs 실제(seasonLines)=${ex.seasonLines?.length} · 통산 ${ex.career.matches}경기`);

  // [3] 갭 == 시드 백스토리(age-19): 매 시즌 출전 베테랑은 career.seasons·seasonLines가 같이 +1 → 갭 불변
  //     (갭 = 게임 시작 시점 age-19). 음수 갭은 있으면 안 됨(seasonLines가 career.seasons 초과 불가).
  const negGap = players.filter((p) => (p.seasonLines?.length ?? 0) > p.career.seasons);
  ok(negGap.length === 0, `seasonLines.length <= career.seasons 항상 성립(음수 갭 0): 위반 ${negGap.length}명`);

  // [4] A/B 민감도: 분모를 career.seasons로 쓰면 "시즌수 × 평균경기"가 통산과 안 맞는 선수가 생긴다(오라클 이빨)
  //     seasonLines.length를 쓰면 항상 정합. 두 분모의 차이가 실제로 존재함을 수치로.
  const gaps = overCounters.map((p) => p.career.seasons - (p.seasonLines?.length ?? 0));
  const maxGap = gaps.length ? Math.max(...gaps) : 0;
  ok(maxGap >= 1, `두 분모 차이 최대 ${maxGap}시즌(≥1이어야 버그가 실재 — 0이면 구분 불가)`);

  console.log(fail === 0 ? '\nPASS — seasonLines.length가 올바른 표시 분모(통산과 정합)' : `\nFAIL (${fail}건)`);
  process.exit(fail === 0 ? 0 : 1);
})();
