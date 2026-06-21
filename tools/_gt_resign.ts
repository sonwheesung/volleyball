// 악질 reSign 테스트 — 검증 없는 contractOverrides가 offseason 캡/계약을 뚫는지.
// A/B: 컨트롤(reSign 없음) vs 익스플로잇(음수 연봉 reSign). 미퍼징 액션(monkey 미포함).
import './_gt_mock';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, currentRosters, evolveOnDay } = await import('../data/league');
  const { LEAGUE_CAP } = await import('../engine/cap');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;

  // 리그 전체 음수/NaN 연봉 스캔 + 내 팀 국내 payroll
  const scan = (tag: string) => {
    let bad = 0, minSal = Infinity; const ex: string[] = [];
    for (const t of LEAGUE.teams) for (const id of currentRosters()[t.id] ?? []) {
      const p = evolveOnDay(id, 0); if (!p) continue;
      const s = p.contract.salary;
      if (!Number.isFinite(s) || s < 0) { bad++; if (ex.length < 3) ex.push(`${id}=${s}`); }
      if (s < minSal) minSal = s;
    }
    const myIds = currentRosters()[my] ?? [];
    const myPay = myIds.reduce((a, id) => { const p = evolveOnDay(id, 0); return a + (p && !p.isForeign ? p.contract.salary : 0); }, 0);
    console.log(`[${tag}] 음수/NaN연봉 ${bad}건 ${ex.join(',')} · 최소연봉 ${minSal} · 내 국내payroll ${myPay} (캡 ${LEAGUE_CAP}, 초과=${myPay>LEAGUE_CAP})`);
    return { bad, myPay };
  };

  // ---- A: 컨트롤 ----
  G().resetSave(); G().selectTeam(my);
  G().endSeason();
  const ctrl = scan('컨트롤');

  // ---- B: 익스플로잇 — 내 로스터 전원 음수 연봉 reSign ----
  G().resetSave(); G().selectTeam(my);
  const before = currentRosters()[my] ?? [];
  for (const id of before) {
    const p = evolveOnDay(id, 0); if (!p || p.isForeign) continue;
    G().reSign(id, { salary: -9_999_999, years: 5, remaining: 5, signedAtAge: p.age });
  }
  console.log(`reSign ${before.length}명 음수 연봉 주입(검증 없음)`);
  G().endSeason();
  const exp = scan('익스플로잇');

  console.log(`\nORACLE: 컨트롤 깨끗=${ctrl.bad===0} (expect true)`);
  console.log(`BUG: 음수연봉 리그 잔존=${exp.bad>0} · 내 payroll 음수/이상=${exp.myPay<0} (둘 중 하나라도 true면 검증 부재)`);
})();
