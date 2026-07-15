// INDEPENDENT GUARD — 화면 명단·캡 표시 정본 = 날짜 인지 명단 (UI-43a/b · UV-1, 2026-07-15).
//   배경(CONFIRMED): squad·office·contracts·team/[id]가 base 명단 직독(getEvolvedTeamPlayers+activeRoster)이라 **시즌 중 FA
//   영입 선수**가 목록·인원·총연봉에서 빠지고 방출 진입점이 없었다. 수정: 공용 셀렉터 activeRosterOnDay(rosterIdsOnDay+evolve+override
//   합성)로 재배선 + 헤더 총연봉은 store 게이트와 동일한 capPayroll(§7, inSeasonCost·override·배신 웃돈)로.
//
//   판정(불변식): 실 store를 구동(selectTeam→시즌 진행→방출→시즌중 재영입→재계약 override)해
//     ① 시즌 중 영입 선수 = activeRosterOnDay에 **포함**(영입 전엔 미포함) ② 방출 선수 = **제외**
//     ③ 재계약 override = 계약 **합성**(overrides 전달 시 새 연봉, 미전달 시 base) ④ 헤더 capPayroll == store 게이트 capPayroll.
//   A/B(허위 오라클 방지): 구 base 셀렉터(getEvolvedTeamPlayers+activeRoster+released)는 시즌 중 영입 선수를 **놓친다**(제외) ↔
//     신 activeRosterOnDay는 **포함**한다 — 셀렉터 교체가 load-bearing임을 실증.
//   결정론: 동일 시나리오 2회 실행 → 명단·캡 서명 동일.
//   Usage: npx tsx tools/_dv_rosterui.ts   (Bash: `npx tsx tools/_dv_rosterui.ts; echo $?`)
import './_gt_mock';

(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, currentRosters, getPlayer, evolveOnDay, getEvolvedTeamPlayers } = await import('../data/league');
  const { activeRosterOnDay, rosterIdsOnDay } = await import('../data/dynamics');
  const { activeRoster, capPayroll } = await import('../data/roster');
  const { inSeasonCost } = await import('../engine/transactions');
  const { marketVal } = await import('../data/awardSalary');

  const G = () => useGameStore.getState();
  const f = (n: number) => (n / 10000).toFixed(2) + '억';
  const DAY = 30;
  const my = LEAGUE.teams[0].id;

  // 헤더 총연봉(화면 산식) — office/contracts와 동일: rosterIdsOnDay + capPayroll(override·inSeasonCost·배신).
  const headerCap = () => {
    const s = G();
    const isBetrayed = (id: string) => s.inSeasonTx.some((t) => t.kind === 'release' && t.teamId === my && t.playerId === id);
    const signed = new Set(s.inSeasonTx.filter((t) => t.kind === 'sign' && t.teamId === my).map((t) => t.playerId));
    const players = rosterIdsOnDay(my, DAY).map((id) => evolveOnDay(id, DAY)).filter((p): p is NonNullable<typeof p> => !!p);
    return capPayroll(players, s.contractOverrides, signed, isBetrayed);
  };
  // store 게이트 산식(signInSeason/reSign 내부) — 그날 유효 명단 = rosterIds.filter(!myReleased)+mySigned.
  const storeCap = () => {
    const s = G();
    const rosterIds = currentRosters()[my] ?? [];
    const myReleased = new Set(s.inSeasonTx.filter((t) => t.kind === 'release' && t.teamId === my).map((t) => t.playerId));
    const mySigned = s.inSeasonTx.filter((t) => t.kind === 'sign' && t.teamId === my).map((t) => t.playerId);
    const isBetrayed = (id: string) => s.inSeasonTx.some((t) => t.kind === 'release' && t.teamId === my && t.playerId === id);
    const players = [...rosterIds.filter((id) => !myReleased.has(id)), ...mySigned].map((id) => evolveOnDay(id, DAY)).filter((p): p is NonNullable<typeof p> => !!p);
    return capPayroll(players, s.contractOverrides, new Set(mySigned), isBetrayed);
  };

  const runScenario = (fails: string[]) => {
    G().resetSave();
    G().selectTeam(my);
    G().setDay(DAY);
    useGameStore.setState({ cash: 500_000 }); // 위약금·영입비 넉넉(캡 게이트만 시험)

    const baseIds = currentRosters()[my] ?? [];
    const nationals = baseIds.map((id) => getPlayer(id)!).filter((p) => p && !p.isForeign && p.contract.remaining >= 1);
    if (nationals.length < 3) { fails.push('국내 선수 3명 미만 — 시나리오 불가'); return null; }

    // ── (3) 재계약 override 합성 — 최고 연봉 국내 선수 P를 −10%로 재계약(캡 안전) ──
    const P = [...nationals].sort((a, b) => b.contract.salary - a.contract.salary)[0];
    const lowered = Math.max(3000, Math.round(P.contract.salary * 0.9 / 100) * 100);
    const rs = G().reSign(P.id, { salary: lowered, years: 2, remaining: 2, signedAtAge: P.age });
    if (!rs.ok) fails.push(`reSign(P) 거부: ${rs.reason}`);
    const withOv = activeRosterOnDay(my, DAY, G().contractOverrides).find((p) => p.id === P.id);
    const noOv = activeRosterOnDay(my, DAY, {}).find((p) => p.id === P.id);
    if (withOv?.contract.salary !== lowered) fails.push(`override 합성 실패: ${withOv?.contract.salary} ≠ ${lowered}`);
    if (noOv?.contract.salary !== P.contract.salary) fails.push(`overrides 미전달인데 base 아님: ${noOv?.contract.salary} ≠ ${P.contract.salary}`);

    // ── (2) 방출 → 제외. 가장 싼 국내 선수(P 제외)부터 방출 가능한 첫 선수 R을 찾는다(포지션 floor 통과) ──
    let R: typeof P | null = null;
    for (const c of [...nationals].filter((p) => p.id !== P.id).sort((a, b) => a.contract.salary - b.contract.salary)) {
      const before = activeRosterOnDay(my, DAY, G().contractOverrides).some((p) => p.id === c.id);
      if (!before) { fails.push(`방출 전 ${c.name} 명단에 없음(비정상)`); continue; }
      if (G().release(c.id)) { R = c; break; }   // 방출 성공 = R
    }
    if (!R) { fails.push('방출 가능한 국내 선수를 찾지 못함'); return null; }
    const afterRelease = activeRosterOnDay(my, DAY, G().contractOverrides).some((p) => p.id === R!.id);
    if (afterRelease) fails.push(`방출한 ${R.name}이 여전히 명단에 있음(제외 실패)`);

    // ── (1) 시즌 중 재영입 → 포함(영입 전엔 위에서 미포함 확인) ──
    const signOk = G().signInSeason(R.id);
    if (!signOk) fails.push(`signInSeason(R=${R.name}) 실패(캡/정원/자금)`);
    const afterSign = activeRosterOnDay(my, DAY, G().contractOverrides).find((p) => p.id === R!.id);
    if (!afterSign) fails.push(`재영입한 ${R.name}이 명단에 없음(포함 실패 — UV-1 버그)`);
    // 표시 연봉 = 캡 산입액(inSeasonCost, betrayed=자기 방출자 ×1.5)
    const signedSet = new Set(G().inSeasonTx.filter((t) => t.kind === 'sign' && t.teamId === my).map((t) => t.playerId));
    if (!signedSet.has(R.id)) fails.push('inSeasonSigned 집합에 R 없음');

    // ── (4) 헤더 capPayroll == store 게이트 capPayroll ──
    const hc = headerCap();
    const sc = storeCap();
    if (hc !== sc) fails.push(`헤더 캡 ${hc} ≠ store 게이트 캡 ${sc}`);

    // ── A/B: 구 base 셀렉터는 시즌 중 영입 R을 놓친다 ↔ 신 셀렉터는 포함 ──
    const oldRoster = activeRoster(getEvolvedTeamPlayers(my, DAY), G().contractOverrides, G().released);
    const oldHasR = oldRoster.some((p) => p.id === R.id);
    const newHasR = activeRosterOnDay(my, DAY, G().contractOverrides).some((p) => p.id === R.id);
    if (oldHasR) fails.push('A/B 무효: 구 base 셀렉터가 R을 포함(민감도 없음)');
    if (!newHasR) fails.push('A/B 무효: 신 셀렉터가 R을 미포함');

    // 서명(결정론) = 정렬 명단 id + 헤더 캡 + override 연봉
    const sig = activeRosterOnDay(my, DAY, G().contractOverrides).map((p) => p.id).sort().join(',') + `|${hc}|${lowered}`;
    return { sig, hc, sc, P: P.name, R: R.name, lowered, oldHasR, newHasR, signOk, signCost: inSeasonCost(marketVal(afterSign ?? R), true) };
  };

  const fails: string[] = [];
  const r1 = runScenario(fails);
  const fails2: string[] = [];
  const r2 = runScenario(fails2);
  const deterministic = !!r1 && !!r2 && r1.sig === r2.sig;
  if (!deterministic) fails.push(`결정론 깨짐: ${r1?.sig} ≠ ${r2?.sig}`);

  console.log('=== 화면 명단·캡 표시 정본 검증(UI-43 UV-1) ===');
  if (r1) {
    console.log(`  재계약 P=${r1.P} → 연봉 ${f(r1.lowered)} (override 합성 확인)`);
    console.log(`  방출 R=${r1.R} → 명단 제외 확인 → 시즌 중 재영입 → 명단 포함 확인 (취득가 ${f(r1.signCost)})`);
    console.log(`  헤더 캡 ${f(r1.hc)} == store 게이트 캡 ${f(r1.sc)} : ${r1.hc === r1.sc}`);
    console.log(`  [A/B] 구 base 셀렉터 R 포함=${r1.oldHasR}(기대 false) · 신 셀렉터 R 포함=${r1.newHasR}(기대 true)`);
    console.log(`  [결정론] 2회 서명 동일=${deterministic}`);
  }
  console.log(`\nRESULT: ${fails.length === 0 ? 'ROSTERUI_GUARD PASS' : 'ROSTERUI_GUARD FAIL — ' + fails.join(' / ')}`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
