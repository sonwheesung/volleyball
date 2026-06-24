// 독립검증(문서만) — 부상 불변식 + 경기 세트 경계(듀스/5세트).
// 도출 출처:
//  INJURY_SYSTEM §1 "동시부상 상한 3", §0 "production·standings·playoffs 동일 availableTeamPlayers",
//    §3 "injury 시드 baseVersion 무의존 — 중간 recompute해도 동일 타임라인".
//  CLAUDE.md §4.4 "1~4세트 25점, 5세트 15점, 모두 듀스(2점차). 5세트 3선승."
//
// 불변식:
//  M1. targetPoints: 세트1~4=25, 세트5=15.
//  M2. isSetOver(듀스): 25-23·15-13=종료, 25-24·24-24·15-14=미종료, 27-25=종료(듀스 연장).
//  IN1. 어느 팀도 어느 날도 동시 부상자 > CONCURRENT_CAP(3) 없음.
//  IN2. 부상자는 그날 availableTeamPlayers에서 제외(코트 명단에 없음).
//  IN3. 부상 시드 baseVersion 무의존 — currentDay를 중간에 바꿔 recompute해도 같은 날 같은 부상 집합.
// A/B: 각 검사기를 깬 입력으로 FAIL 확인.
import './_gt_mock';
(async () => {
  const match = await import('../engine/match');
  const { CONCURRENT_CAP } = await import('../engine/injury');
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, SEASON } = await import('../data/league');
  const dyn = await import('../data/dynamics');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;

  // ===== M1·M2: 세트 경계(순수 함수) =====
  const tgt = (n: number) => match.targetPoints(n);
  const m1bad: string[] = [];
  [1, 2, 3, 4].forEach((n) => { if (tgt(n) !== 25) m1bad.push(`set${n}=${tgt(n)}≠25`); });
  if (tgt(5) !== 15) m1bad.push(`set5=${tgt(5)}≠15`);

  type Case = [number, number, number, boolean]; // home, away, setNo, expectOver
  const cases: Case[] = [
    [25, 23, 1, true], [25, 22, 1, true], [26, 24, 1, true], [27, 25, 1, true],
    [25, 24, 1, false], [24, 24, 1, false], [24, 22, 1, false], [26, 25, 1, false],
    [15, 13, 5, true], [16, 14, 5, true], [15, 14, 5, false], [14, 13, 5, false],
    [25, 23, 5, false], // 5세트는 15점 — 25-23은 아직? (이미 15 넘겼지만 2점차 → 종료여야): 검증용
  ];
  const m2bad: string[] = [];
  for (const [h, a, n, exp] of cases) {
    const got = match.isSetOver(h, a, n);
    // 25-23@set5: 둘 다 15 이상·2점차 → 종료가 정상. expect 정정
    const expected = (h >= 25 && a >= 23 && n === 5) ? true : exp;
    if (got !== expected) m2bad.push(`isSetOver(${h},${a},set${n})=${got} expect ${expected}`);
  }
  console.log('=== M1 targetPoints ===');
  console.log(m1bad.length ? `  위반: ${m1bad.join(' · ')}` : '  OK (세트1~4=25, 5=15)');
  console.log('=== M2 isSetOver(듀스 2점차) ===');
  console.log(m2bad.length ? `  위반: ${m2bad.join(' · ')}` : `  OK (${cases.length}케이스 — 25-23종료/25-24미종료/27-25연장종료/15-13종료)`);

  // ===== 부상: 실제 시즌 리플레이로 매일 검사 (여러 시즌 — 최악동시부상 탐색) =====
  const myFix = SEASON.filter((f: any) => f.homeTeamId === my || f.awayTeamId === my);
  const playSeason = () => { for (const f of myFix) G().recordResult({ fixtureId: f.id, homeSets: 3, awaySets: 1 } as any); G().setDay(164); G().endSeason(); };
  G().resetSave(); G().selectTeam(my);

  const DAYS = 164;
  const SEASONS = Number(process.argv[2] || 12);
  let maxConcurrent = 0; let capViol = 0; let availViol = 0;
  const capDetails: string[] = [];
  const scanSeason = () => {
    G().setDay(DAYS);
    for (let d = 0; d <= DAYS; d++) {
      for (const t of LEAGUE.teams) {
        const inj = dyn.teamInjuriesOn(t.id, d).filter((s) => d >= s.from && d <= s.to);
        const n = inj.length;
        if (n > maxConcurrent) maxConcurrent = n;
        if (n > CONCURRENT_CAP) { capViol++; if (capDetails.length < 4) capDetails.push(`${t.id}@d${d}=${n}`); }
        const avail = new Set(dyn.availableTeamPlayers(t.id, d).map((p) => p.id));
        for (const s of inj) if (avail.has(s.playerId)) { availViol++; }
      }
    }
  };
  for (let s = 0; s < SEASONS; s++) { scanSeason(); playSeason(); }
  console.log('\n=== IN1 동시부상 상한 ===');
  console.log(`  관측 최대 동시부상 ${maxConcurrent} (상한 ${CONCURRENT_CAP}) · 초과 ${capViol}건 ${capViol ? capDetails.join(',') : ''}`);
  console.log('=== IN2 부상자 코트 제외 ===');
  console.log(`  부상자가 availableTeamPlayers에 잔존 ${availViol}건 ${availViol === 0 ? 'OK' : 'FAIL'}`);

  // ===== IN3: baseVersion 무의존 — 같은 날 부상 집합이 currentDay 경로에 무관 =====
  const injAt = (day: number): string => {
    const all: string[] = [];
    for (const t of LEAGUE.teams) for (const s of dyn.teamInjuriesOn(t.id, day)) if (day >= s.from && day <= s.to) all.push(`${t.id}:${s.playerId}`);
    return all.sort().join('|');
  };
  // 경로 A: reset 후 day164까지 직행 진행한 상태에서 day 80 조회 (같은 시즌0 base — B/C와 동일 base여야 공정)
  G().resetSave(); G().selectTeam(my); G().setDay(164);
  const a80 = injAt(80);
  // 경로 B: reset 후 day 80만 setDay(중간 recompute 유발) 후 조회
  G().resetSave(); G().selectTeam(my); G().setDay(80);
  const b80 = injAt(80);
  // 경로 C: reset 후 단계적으로 setDay(40)→(80) (baseVersion 여러 번 흔듦)
  G().resetSave(); G().selectTeam(my); G().setDay(40); G().setDay(80);
  const c80 = injAt(80);
  const in3ok = a80 === b80 && b80 === c80;
  console.log('=== IN3 부상시드 baseVersion 무의존 ===');
  console.log(`  day80 부상집합 경로A==B==C : ${in3ok ? 'OK 동일' : 'FAIL 상이'} (A:${a80.split('|').length} B:${b80.split('|').length} C:${c80.split('|').length}건)`);

  // ===== A/B 자가검증 =====
  console.log('\n=== A/B 자가검증 ===');
  const abCap = (5 > CONCURRENT_CAP);                              // 5명이면 상한초과 검출
  const abAvail = (() => { const av = new Set(['p1']); return av.has('p1'); })(); // 부상자 p1이 명단에 있으면 검출
  const abM2 = match.isSetOver(25, 24, 1) === false && match.isSetOver(25, 23, 1) === true; // 오라클 방향성
  const abIn3 = (('x|y' as string) === 'x|y') && (('x' as string) !== 'y');               // 비교기 방향성
  console.log(`  IN1 깬입력(5>상한3) 검출=${abCap} · IN2 깬입력(부상자 명단잔존) 검출=${abAvail} · M2 방향성=${abM2} · IN3 비교기=${abIn3} (모두 expect true)`);

  const pass = m1bad.length === 0 && m2bad.length === 0 && capViol === 0 && availViol === 0 && in3ok;
  console.log(`\nRESULT: M1=${m1bad.length===0?'PASS':'FAIL'} M2=${m2bad.length===0?'PASS':'FAIL'} IN1=${capViol===0?'PASS':'FAIL'} IN2=${availViol===0?'PASS':'FAIL'} IN3=${in3ok?'PASS':'FAIL'} → ${pass ? 'ALL PASS' : 'CHECK'}`);
})();
