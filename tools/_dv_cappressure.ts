// 캡 밀착(cap pressure) 상설 가드 — 팀 국내 페이롤/샐러리캡(35억) 분포가 "컨텐더는 캡에 밀착"이라는
// FA_SYSTEM 실측 프로필을 유지하는지 감시. 성장 C 디플레(연봉 −11% → 중앙 74%→~66%)로 밀착이 조용히
// 느슨해졌던 클래스(EC-FA-07 — 분포 이동 vs 절대 캡)의 재발 방지. 시대 앵커(SALARY 2장)가 시대 불변으로 만든다.
// ~~기준(2026-07-02): 중앙 74% · 밴드 [69,80].~~ → **재기준(2026-07-14, #74)**: 가변 로스터 전환(#73, ce2591e)이
//   슬롯 16→floor12(값싼 신인 유입)로 국내 페이롤 합/캡 중앙을 74%→~61%로 낮춤(git 이분탐색 확증: 091d0d3=73% PASS→ce2591e=60% FAIL).
//   버그 아닌 의도된 설계 부수효과 — 밴드를 실측에 맞춰 재설정. 실측(N=8/15/30 = 58/61/63%, 최대 93~102% = 상위는 여전히 밀착).
// 밴드: 중앙 ∈[57,70] — 실측 58~63 통과 + −11% 디플레(A/B) 하한 초과(63×0.89=56.1<57 거부). 최대 ≥88%(상위 밀착 유지).
// npx tsx tools/_dv_cappressure.ts [시즌=15]  → exit 0/1
import './_gt_mock';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, SEASON, currentRosters, getPlayer } = await import('../data/league');
  const { LEAGUE_CAP } = await import('../engine/cap');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const N = Math.max(4, Number(process.argv[2]) || 15);
  const myFix = SEASON.filter((f: any) => f.homeTeamId === my || f.awayTeamId === my);
  G().resetSave(); G().selectTeam(my);
  const ratios: number[] = [];
  for (let s = 0; s < N; s++) {
    for (const t of LEAGUE.teams) {
      let pay = 0;
      for (const id of currentRosters()[t.id] ?? []) {
        const p = getPlayer(id);
        if (p && !p.isForeign) pay += p.contract.salary;
      }
      ratios.push(pay / LEAGUE_CAP);
    }
    for (const f of myFix) G().recordResult({ fixtureId: f.id, homeSets: 3, awaySets: 1 } as any);
    G().setDay(164); G().endSeason();
  }
  // 오라클: 분포 프로필 판정(중앙 밴드·최대·105% 초과) — 손상 입력에도 같은 오라클을 적용해 민감도 증명(A/B)
  const judge = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b);
    const med = s[Math.floor(s.length / 2)];
    const max = s[s.length - 1];
    const over105 = s.filter((r) => r > 1.05).length; // EC-CA-03 keep 예외 허용선(×1.05)
    return { med, max, over105, ok: med >= 0.57 && med <= 0.70 && max >= 0.88 && over105 === 0 };
  };
  const real = judge(ratios);
  console.log(`n=${ratios.length} (${N}시즌×${LEAGUE.teams.length}팀)`);
  console.log(`페이롤/캡: 중앙 ${(real.med * 100).toFixed(0)}% · 최대 ${(real.max * 100).toFixed(0)}% · 105%초과 ${real.over105}건 (기준: 중앙 ~61[57,70]·최대 ~100 — 가변로스터 #73 재기준 2026-07-14)`);

  // A/B 이빨(허위 오라클 차단): 실제 실패 사례(성장 C −11% 디플레)를 주입한 분포는 같은 오라클이 거부해야 한다.
  const deflated = judge(ratios.map((r) => r * 0.89));
  console.log(`[A/B] −11% 디플레 주입: 중앙 ${(deflated.med * 100).toFixed(0)}% → 오라클 거부 ${!deflated.ok ? '✅' : '❌(이빨 없음)'}`);

  const pass = real.ok && !deflated.ok;
  console.log(`\nCAPPRESSURE ${pass ? 'PASS' : 'FAIL'} (실측 ${real.ok ? 'ok' : 'band-out'} · A/B 검출 ${!deflated.ok})`);
  if (!pass) process.exit(1);
})();
