// 측정 전용 A/B — 축1(evoOneCache 콘텐츠 시그니처) + 축3(감독 forward-only 스플라이스) 성능.
//   같은 코드 안에서 "옛 동작(full)" 경로와 "신 동작(splice+reuse)" 경로를 각각 강제해 대조한다.
//     옛 감독영입 = 전체 리셋(캐시 null + commitRosters로 evoOneCache clear = baseVersion 클리어 동형) → 전체 재시뮬.
//     신 감독영입 = hireHeadCoach(hireDay) = 순위·생산 접미 스플라이스 + dyn evoOneCache 시그니처 재사용.
//   실행: npx tsx tools/_ms_axis13.ts     원칙: 콜드 측정, 시드 고정, 중앙값(노이즈 완화).
import './_gt_mock';

const PHONE_MULT = 5; // 폰 배율(dynamics/production 주석 실측 5x)

(async () => {
  const league = await import('../data/league');
  const {
    LEAGUE, SEASON, currentRosters, hireHeadCoach, availableCoaches,
    commitRosters, setFocusTimeline, resetLeagueBase,
  } = league as any;
  const { computeStandings, setStandingsCacheRaw } = await import('../data/standings');
  const { leagueProduction, setProductionCacheRaw } = await import('../data/production');
  const { availableTeamPlayers, setDynCacheRaw } = await import('../data/dynamics');
  const { useGameStore } = await import('../store/useGameStore');

  const my = LEAGUE.teams[0].id;
  const G = () => useGameStore.getState();
  G().resetSave(); G().selectTeam(my);

  const teams = LEAGUE.teams.map((t: any) => t.id);
  const matchdays = ([...new Set(SEASON.map((f: any) => f.dayIndex as number))] as number[]).sort((a, b) => a - b);
  const lastDay = matchdays[matchdays.length - 1];
  const totalFixtures = SEASON.length;

  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const ms = (fn: () => void): number => { const t = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t) / 1e6; };

  // 화면 새로고침이 부르는 전체 파생 = 순위 + 생산 + 그날 명단(dyn) 스윕
  const recompute = (day: number) => {
    computeStandings(day); leagueProduction(day);
    for (const t of teams) availableTeamPlayers(t, day);
  };
  // 워밍(이전 세대 캐시 = 스플라이스 재사용 원천 + evoOneCache 서명 시드)
  const warmFull = () => { setStandingsCacheRaw(null); setProductionCacheRaw(null); setDynCacheRaw(null); commitRosters(currentRosters()); recompute(lastDay); };

  console.log('════════════════════════════════════════════════════════════');
  console.log(' 축1+축3 A/B — 감독 영입/훈련방침 후 화면 재계산 (콜드 · 중앙값3)');
  console.log(` 팀 ${teams.length} · 매치데이 ${matchdays.length}(0..${lastDay}) · 총경기 ${totalFixtures} · 폰추정 ×${PHONE_MULT}`);
  console.log('════════════════════════════════════════════════════════════');
  console.log('   OLD = 전체 재시뮬(옛 감독영입=recordBump0 + evoOneCache 전체 clear)');
  console.log('   NEW = 스플라이스(축3 부임일 접미) + dyn evoOneCache 서명 재사용(축1)');
  console.log('');
  console.log('시나리오                stage        OLD(full)   NEW(opt)   절감%   폰:OLD→NEW');

  const FOCUS = { primary: [2, 3] as [number, number], secondary: [5, 7, 9] as [number, number, number] };
  const STAGES = [{ name: '초반 d40', day: 40 }, { name: '중반 d110', day: 110 }, { name: '종반 d160', day: 160 }];

  // OLD: 워밍 후 전체 무효화(캐시 null + roster 재커밋=evoOne clear) → recompute = 완전 콜드.
  const oldFull = (day: number) => median([0, 1, 2].map(() => {
    warmFull();
    setStandingsCacheRaw(null); setProductionCacheRaw(null); setDynCacheRaw(null); commitRosters(currentRosters()); // 전체 무효화(옛 감독영입 동형)
    return ms(() => recompute(day));
  }));

  // NEW-감독: 워밍 후 시즌 중 감독 영입(hireDay=day) → 스플라이스 + evoOneCache 재사용.
  const newCoach = (day: number) => median([0, 1, 2].map(() => {
    warmFull();
    const c = availableCoaches(my)[0];
    if (!c) throw new Error('no available coach');
    const ok = hireHeadCoach(my, c.id, day);
    if (!ok) throw new Error('hire failed (budget?)');
    const t = ms(() => recompute(day));
    // 원복: 다음 rep 를 위해 세이브 리셋(감독 계약 해제)
    resetLeagueBase(); G().resetSave(); G().selectTeam(my);
    return t;
  }));

  // NEW-훈련: 워밍 후 훈련방침 "그날부터" → 순위·생산 스플라이스(기존 A4) + dyn evoOne 재사용.
  const newFocus = (day: number) => median([0, 1, 2].map(() => {
    warmFull();
    setFocusTimeline(my, [{ fromDay: day, focus: FOCUS }], day);
    const t = ms(() => recompute(day));
    setFocusTimeline(my, [], 0);
    return t;
  }));

  const row = (label: string, st: { name: string; day: number }, oldMs: number, newMs: number) => {
    const save = oldMs > 0 ? (1 - newMs / oldMs) * 100 : 0;
    console.log(`${label.padEnd(22)} ${st.name.padEnd(10)} ${oldMs.toFixed(0).padStart(8)}ms ${newMs.toFixed(0).padStart(8)}ms ${save.toFixed(0).padStart(6)}%   ${(oldMs * PHONE_MULT).toFixed(0)}→${(newMs * PHONE_MULT).toFixed(0)}ms`);
  };

  console.log('── 감독 영입(시즌 중) ──');
  for (const st of STAGES) row('감독영입 mid-season', st, oldFull(st.day), newCoach(st.day));
  console.log('── 훈련방침 변경(그날부터) ──');
  for (const st of STAGES) row('훈련방침 mid-season', st, oldFull(st.day), newFocus(st.day));

  console.log('');
  console.log(' 주: OLD 컬럼은 두 시나리오 공통(전체 재시뮬 비용). NEW 는 각 액션의 최적화 경로.');
  console.log('════════════════════════════════════════════════════════════');
  process.exit(0);
})();
