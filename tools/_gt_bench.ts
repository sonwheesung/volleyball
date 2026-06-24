// 시나리오 테스트 — 주전/벤치: 라인업 불변식(buildLineup·벤치 제외·마지막 리베로 가드 EC-LU-01·7인 가드)
// + 벤치 건의 스토어 가드(suggestBench/suggestStart: 로스터·쿨다운). 라인업은 setOwnerContext로 벤치 지시를
// 직접 주입해 결정론 검사(수락 난수 의존 제거). simStarters(선발 파이프라인 G1·G2)와 상보적.
//   npx tsx tools/_gt_bench.ts
import './_gt_mock';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, currentRosters, evolveOnDay, getPlayer } = await import('../data/league');
  const { availableTeamPlayers } = await import('../data/injury');
  const { setOwnerContext } = await import('../data/dynamics');
  const { buildLineup } = await import('../engine/lineup');
  const { benchCauseOf } = await import('../data/owner');
  const { overall } = await import('../engine/overall');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const other = LEAGUE.teams[1].id;

  let pass = 0, fail = 0;
  const check = (name: string, ok: boolean, detail = '') => { (ok ? pass++ : fail++); console.log(`  ${ok ? '✅' : '❌ FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
  const setup = () => { G().resetSave(); G().selectTeam(my); setOwnerContext([]); return currentRosters()[my] ?? []; };
  const bench = (ids: string[]) => setOwnerContext(ids.map((id) => ({ playerId: id, fromDay: 0 })));
  const availIds = () => availableTeamPlayers(my, 0).map((p) => p.id);
  const pos = (id: string) => getPlayer(id)?.position;

  console.log('═══ 라인업 불변식(벤치 지시 직접 주입) ═══');
  // L1 무벤치 → 6주전 + 리베로(가용 시) + 세터 포함
  { setup(); const lu = buildLineup(availableTeamPlayers(my, 0)); const liberoExists = (currentRosters()[my] ?? []).some((id) => pos(id) === 'L');
    check('L1 6주전+리베로·세터 포함', lu.six.length === 6 && (!liberoExists || !!lu.libero) && lu.six.some((p) => p.position === 'S'), `six ${lu.six.length}·리베로 ${lu.libero ? lu.libero.name : '없음'}`); }
  // L2 비리베로 주전 벤치 → 가용·라인업서 제외
  { setup(); const lu0 = buildLineup(availableTeamPlayers(my, 0)); const victim = lu0.six.find((p) => p.position !== 'L')!; bench([victim.id]);
    const inAvail = availIds().includes(victim.id); const lu1 = buildLineup(availableTeamPlayers(my, 0)); const inLu = lu1.six.some((p) => p.id === victim.id);
    check('L2 벤치 주전 → 가용·라인업 제외', !inAvail && !inLu, `${victim.position} ${victim.name}`); }
  // L3 리베로 전원 벤치 → 가용에 리베로 남음(마지막 리베로 가드 EC-LU-01)
  { const ids = setup(); const liberos = ids.filter((id) => pos(id) === 'L'); if (liberos.length) { bench(liberos); const liberoLeft = availableTeamPlayers(my, 0).some((p) => p.position === 'L');
    check('L3 리베로 전원 벤치 → 가용 리베로 보존', liberoLeft, `리베로 ${liberos.length}명 벤치, 가용 리베로=${liberoLeft}`); } else check('L3 마지막 리베로 가드', true, '로스터에 리베로 없음 — skip'); }
  // L4 7인 미만 되게 대량 벤치 → 벤치 무시(경기 성립 우선) — 벤치한 선수 가용 잔존
  { const ids = setup(); const benchN = Math.max(0, ids.length - 6); if (benchN > 0) { const benched = ids.slice(0, benchN); bench(benched);
    const stillAvail = benched.some((id) => availIds().includes(id)); check('L4 7인 미만 벤치 → 무시(잔존)', stillAvail, `${benchN}명 벤치(가용<7 가드) → 벤치 무효`); } else check('L4 7인 가드', true, 'skip'); }
  // C1 벤치된 선수 사유 == ownerBenched
  { setup(); const lu0 = buildLineup(availableTeamPlayers(my, 0)); const victim = lu0.six.find((p) => p.position !== 'L')!; bench([victim.id]);
    const cause = benchCauseOf(evolveOnDay(victim.id, 0)!, my, 0); check('C1 벤치 사유 = ownerBenched', cause === 'ownerBenched', `사유=${cause}`); }

  console.log('\n═══ 벤치/선발 건의 스토어 가드 ═══');
  // B1 타팀 선수 벤치 건의 → 거부
  { setup(); const opp = currentRosters()[other]![0]; const ok = G().suggestBench(opp, 'form'); check('B1 타팀 선수 벤치 건의 거부', ok === false && !G().benchDirectives.some((b) => b.playerId === opp)); }
  // B2 같은 선수 연속 벤치 건의 → 2번째 쿨다운 거부
  { const ids = setup(); const p = ids[0]; G().suggestBench(p, 'form'); const cd = G().benchCooldown[p]; const second = G().suggestBench(p, 'form'); check('B2 연속 벤치 건의 쿨다운 거부', second === false && cd > 0, `쿨다운 day=${cd}`); }
  // B3 타팀 선수 선발 건의 → 거부
  { setup(); const opp = currentRosters()[other]![0]; const ok = G().suggestStart(opp); check('B3 타팀 선수 선발 건의 거부', ok === false); }
  // B4 suggestStart 수락 시 동포지션 '최약 주전'을 벤치(최강 아님 — EC-LU-02). setOwnerContext 우회 안 하고 실제 액션 구동.
  //    ≥2 동포지션 주전이 있는 후보를 스캔(최약≠최강이라야 의미). 수락 케이스에서 벤치된 선수가 최약인지 단언.
  { let found = false, ok = false, detail = '수락 케이스 못 찾음';
    for (let day = 0; day < 60 && !found; day++) {
      G().resetSave(); G().selectTeam(my); setOwnerContext([]); G().setDay(day);
      const d = G().currentDay;
      const lu = buildLineup(availableTeamPlayers(my, d));
      const starters = lu.six;
      for (const cand of currentRosters()[my] ?? []) {
        const cp = evolveOnDay(cand, d); if (!cp) continue;
        const inc = starters.filter((p) => p.position === cp.position && p.id !== cand);
        if (inc.length < 2) continue; // 최약≠최강 보장
        if (starters.some((p) => p.id === cand)) continue; // 후보는 비주전이어야 자리 이음
        const before = G().benchDirectives.length;
        if (!G().suggestStart(cand)) continue; // 거절 — 다음 후보
        const dir = G().benchDirectives[G().benchDirectives.length - 1];
        if (!dir || G().benchDirectives.length !== before + 1) break;
        const weakest = inc.slice().sort((a, b) => overall(a) - overall(b))[0];
        const strongest = inc.slice().sort((a, b) => overall(b) - overall(a))[0];
        ok = dir.playerId === weakest.id && weakest.id !== strongest.id;
        detail = `${cp.position} ${cp.name} 건의 → 벤치 ${getPlayer(dir.playerId)?.name}(${overall(evolveOnDay(dir.playerId, d)!)}) · 최약 ${weakest.name}(${overall(weakest)})·최강 ${strongest.name}(${overall(strongest)})`;
        found = true; break;
      }
    }
    check('B4 suggestStart 최약 주전 벤치(EC-LU-02 실제 액션)', found && ok, detail); }

  console.log(`\n═══ 결과: ${pass} PASS · ${fail} FAIL ═══`);
  console.log(fail === 0 ? '✅ 전 시나리오 통과' : '❌ 실패 시나리오 있음 — 위 ❌ 확인');
  process.exit(fail === 0 ? 0 : 1);
})();
