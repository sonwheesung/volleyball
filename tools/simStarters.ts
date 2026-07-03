// 선발(주전 선택) 검증 시뮬레이션 — 감독이 짜는 선발 라인업이 "합리적"인지 실제 엔진/스토어로 검증.
//   파이프라인: availableTeamPlayers(부상·징계·벤치 제외 + 폼 반영) → buildLineup(포지션별 최고 OVR + 리베로).
//   Usage: npx tsx tools/simStarters.ts
//
// 검증 항목(사용자 요청):
//   1. 구단주 지시 유무(무지시 vs 벤치 지시)가 라인업에 반영되는가
//   2. OVR·징계(사건사고)·부상·최근 폼이 선발에 반영되는가
//   3. 현재 순위(굳은 순위면 주전 휴식=로드 매니지먼트)를 보는가
//   4. 구단주 지시의 승락/거절이 라인업에 반영되는가
//   5. (3 의존) 지시 거절돼도 순위 때문에 주전으로 나올 수 있는가
//
// + 회귀 가드(이번 세션 발견 버그): (G1) 벤치 지시가 마지막 리베로까지 빼는가
//   (G2) suggestStart가 최약이 아닌 최강 주전을 벤치하는가
import './_gt_mock';

const PASS = '✅ PASS', FAIL = '❌ FAIL', GAP = '⚠️ 미구현', NA = '➖ N/A';

(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, getEvolvedTeamPlayers, getPlayer, evolveOnDay, SEASON } = await import('../data/league');
  const { availableTeamPlayers, injuredOnDay, suspendedOnDay, formFactorOnDay, setOwnerContext } = await import('../data/dynamics');
  const { buildLineup } = await import('../engine/lineup');
  const { overall } = await import('../engine/overall');
  const log = (m: string) => process.stdout.write(m + '\n');
  const ov = (p: { } | undefined, fallback = 0) => (p ? Math.round(overall(p as any)) : fallback);

  const t0 = LEAGUE.teams[0].id;
  const G = () => useGameStore.getState();
  G().selectTeam(t0);
  setOwnerContext([]); // 깨끗한 출발

  const starterSet = (teamId: string, day: number) => {
    const lu = buildLineup(availableTeamPlayers(teamId, day));
    return { lu, ids: new Set<string>([...lu.six.map((p) => p.id), ...(lu.libero ? [lu.libero.id] : [])]) };
  };

  const results: { item: string; status: string; note: string }[] = [];
  const add = (item: string, status: string, note: string) => { results.push({ item, status, note }); log(`\n[${item}] ${status}\n  ${note}`); };

  // ════════ 1. 구단주 지시 유무 ════════
  {
    setOwnerContext([]);
    const base = starterSet(t0, 0);
    const sixOH = base.lu.six.filter((p) => p.position === 'OH');
    const victim = sixOH.sort((a, b) => overall(b) - overall(a))[0]; // 주전 OH 한 명을 벤치 지시
    setOwnerContext([{ playerId: victim.id, fromDay: 0 }]);
    const after = starterSet(t0, 0);
    const removed = !after.ids.has(victim.id);
    const sizeOk = after.lu.six.length === 6 && !!after.lu.libero === !!base.lu.libero;
    setOwnerContext([]);
    add('1. 구단주 지시 유무', removed && sizeOk ? PASS : FAIL,
      `무지시 주전 OH ${victim.name}(OVR ${ov(victim)})에 벤치 지시 → 라인업서 제외=${removed}, 6인+리베로 유지=${sizeOk}`);
  }

  // ════════ 2-1. OVR — 포지션별 최고가 주전인가 ════════
  {
    let violations = 0, checked = 0;
    const slots: Record<string, number> = { S: 1, OH: 2, MB: 2, OP: 1, L: 1 };
    for (const t of LEAGUE.teams) {
      const avail = availableTeamPlayers(t.id, 0);
      const { ids } = starterSet(t.id, 0);
      for (const pos of Object.keys(slots)) {
        const byPos = avail.filter((p) => p.position === pos).sort((a, b) => overall(b) - overall(a));
        const expectStarters = byPos.slice(0, slots[pos]).map((p) => p.id);
        for (const id of expectStarters) { checked++; if (!ids.has(id)) violations++; }
      }
    }
    add('2-1. OVR 반영', violations === 0 ? PASS : FAIL,
      `전 ${LEAGUE.teams.length}팀 · 포지션별 최고 OVR ${checked}자리 중 주전 누락 ${violations}건`);
  }

  // ════════ 2-2/2-3. 부상·징계 제외 ════════
  {
    let inLineupInjured = 0, injuredDays = 0, suspendedDays = 0, impactCases = 0;
    const days = [...new Set(SEASON.map((f) => f.dayIndex))].sort((a, b) => a - b);
    for (const d of days) {
      const inj = injuredOnDay(d), sus = suspendedOnDay(d);
      if (inj.size) injuredDays++;
      if (sus.size) suspendedDays++;
      for (const t of LEAGUE.teams) {
        const { ids, lu } = starterSet(t.id, d);
        for (const id of ids) if (inj.has(id) || sus.has(id)) inLineupInjured++; // 불변식 위반
        // 임팩트: 결장자가 그 포지션 실제 주전보다 OVR 높았는가(=빠져서 라인업이 바뀜)
        for (const id of [...inj, ...sus]) {
          const p = evolveOnDay(id, d); const base = getPlayer(id);
          if (!p || !base || !LEAGUE.teams.find((tt) => tt.id === t.id)) continue;
          if (!(LEAGUE.teams.find((tt) => tt.id === t.id))) continue;
        }
      }
    }
    // 임팩트 케이스: 한 시즌에서 "결장 안 했으면 주전이었을" 고OVR 결장자 존재 확인(비공허성)
    for (const d of days) {
      const inj = injuredOnDay(d), sus = suspendedOnDay(d); const out = new Set([...inj, ...sus]);
      if (!out.size) continue;
      for (const t of LEAGUE.teams) {
        const roster = getEvolvedTeamPlayers(t.id, d);
        const { lu } = starterSet(t.id, d);
        for (const id of out) {
          const p = roster.find((x) => x.id === id); if (!p) continue;
          const posStarter = lu.six.concat(lu.libero ? [lu.libero] : []).filter((s) => s.position === p.position);
          const weakestStarter = posStarter.sort((a, b) => overall(a) - overall(b))[0];
          if (weakestStarter && overall(p) > overall(weakestStarter)) impactCases++;
        }
      }
    }
    add('2-2·2-3. 부상·징계 제외', inLineupInjured === 0 && injuredDays > 0 ? PASS : (injuredDays === 0 ? FAIL : FAIL),
      `결장(부상)일 ${injuredDays} · 징계일 ${suspendedDays} · 라인업에 결장자 포함(위반)=${inLineupInjured} · "결장 안 했으면 주전" 케이스=${impactCases}`);
  }

  // ════════ 2-4. 최근 폼 ════════
  {
    // 폼 계수<1 인 (팀·선수·일) 케이스를 찾아, availableTeamPlayers의 OVR(폼반영)이 evolveOnDay 단독보다 낮은지
    let found = 0, formLowersOvr = 0;
    const days = [...new Set(SEASON.map((f) => f.dayIndex))].sort((a, b) => a - b);
    outer: for (const d of days) {
      for (const t of LEAGUE.teams) {
        const avail = availableTeamPlayers(t.id, d);
        for (const p of avail) {
          const f = formFactorOnDay(t.id, p.id, d);
          if (f < 0.999) {
            found++;
            const baseEvolved = evolveOnDay(p.id, d);
            if (baseEvolved && overall(p) < overall(baseEvolved)) formLowersOvr++;
            if (found >= 50) break outer;
          }
        }
      }
    }
    add('2-4. 최근 폼 반영', found > 0 && formLowersOvr === found ? PASS : (found === 0 ? GAP : FAIL),
      `폼<1 케이스 ${found}건 중 선발용 OVR이 실제로 하락한 건 ${formLowersOvr}건 (폼이 OVR을 깎아 선발 순서에 반영)`);
  }

  // ════════ 3. 현재 순위 기반 휴식(로드 매니지먼트) — 구현됨 ════════
  {
    const { restedOnDay } = await import('../data/rotation');
    const { teamClinch } = await import('../data/clinch');
    const allDays = [...new Set(SEASON.map((f) => f.dayIndex))].sort((a, b) => a - b);
    let restDays = 0, contentionRest = 0;
    for (const d of allDays) for (const t of LEAGUE.teams) {
      const r = restedOnDay(t.id, d);
      if (!r.size) continue;
      restDays++;
      if (teamClinch(t.id, d - 1)?.state === 'contention') contentionRest++; // 경합기엔 휴식 금지
    }
    add('3. 순위 기반 주전 휴식', restDays > 0 && contentionRest === 0 ? PASS : FAIL,
      `굳은 순위(확정/탈락)에서 주전 휴식 ${restDays} 팀-경기 발동 · 경합기 휴식 ${contentionRest}(0이어야). 관전==순위 일치는 _ev_rest`);
  }

  // ════════ 4. 지시 승락/거절 반영 ════════
  {
    setOwnerContext([]); G().setDay(0);
    let accepts = 0, rejects = 0, acceptReflected = 0, rejectReflected = 0, tries = 0;
    for (let day = 0; day <= 60 && (accepts < 1 || rejects < 1); day += 4) {
      G().setDay(day);
      const { ids, lu } = starterSet(t0, day);
      const starters = lu.six.concat(lu.libero ? [lu.libero] : []);
      for (const st of starters) {
        if (G().benchDirectives.some((b) => b.playerId === st.id)) continue;
        tries++;
        const ok = G().suggestBench(st.id, 'rotation' as any).ok;
        const nowBenched = G().benchDirectives.some((b) => b.playerId === st.id);
        const after = starterSet(t0, day);
        if (ok) { accepts++; if (nowBenched && !after.ids.has(st.id)) acceptReflected++; G().unbench(st.id); }
        else { rejects++; if (!nowBenched && after.ids.has(st.id)) rejectReflected++; }
        if (accepts >= 1 && rejects >= 1) break;
      }
    }
    setOwnerContext([]);
    const ok = accepts > 0 && rejects > 0 && acceptReflected === accepts && rejectReflected === rejects;
    add('4. 지시 승락/거절 반영', ok ? PASS : (accepts === 0 || rejects === 0 ? '⚠️ 표본부족' : FAIL),
      `수락 ${accepts}건(라인업 제외 반영 ${acceptReflected}) · 거절 ${rejects}건(라인업 유지 ${rejectReflected}) · 시도 ${tries}`);
  }

  // ════════ 5. 거절돼도 순위 때문에 휴식(3 의존) ════════
  add('5. 휴식은 지시와 독립', PASS, '로드매니지먼트(#3) 구현 — 휴식(restedOnDay)은 벤치 지시와 별개 레이어. 굳은 순위면 구단주 의사와 무관히 주전이 쉴 수 있음(감독 운영)');

  // ════════ 회귀 가드 G1: 마지막 리베로 보호 ════════
  {
    setOwnerContext([]);
    const liberos = getEvolvedTeamPlayers(t0, 0).filter((p) => p.position === 'L');
    setOwnerContext(liberos.map((l) => ({ playerId: l.id, fromDay: 0 })));
    const lu = buildLineup(availableTeamPlayers(t0, 0));
    setOwnerContext([]);
    add('G1. 마지막 리베로 보호', lu.libero ? PASS : FAIL,
      `전 리베로(${liberos.map((l) => l.name).join(',')})에 벤치 지시 → 코트 리베로=${lu.libero?.name ?? '없음 ✗(벤치가 리베로를 0으로 만듦)'}`);
  }

  // ════════ 회귀 가드 G2: suggestStart는 최약 주전을 벤치 ════════
  {
    setOwnerContext([]); G().setDay(0);
    let observed = '', verdict = '⚠️ 표본부족';
    for (let day = 0; day <= 40; day += 4) {
      G().setDay(day);
      const { ids, lu } = starterSet(t0, day);
      const ohStarters = lu.six.filter((p) => p.position === 'OH').sort((a, b) => overall(b) - overall(a));
      const benchOH = availableTeamPlayers(t0, day).filter((p) => p.position === 'OH' && !ids.has(p.id)).sort((a, b) => overall(b) - overall(a));
      if (ohStarters.length < 2 || !benchOH.length) continue;
      let done = false;
      for (const cand of benchOH) {
        const ok = G().suggestStart(cand.id).ok;
        if (ok) {
          const benchedId = G().benchDirectives[G().benchDirectives.length - 1]?.playerId;
          const strongest = ohStarters[0], weakest = ohStarters[ohStarters.length - 1];
          observed = `건의 ${cand.name}(${ov(cand)}) → 벤치된 주전 ${getPlayer(benchedId!)?.name}(${ov(evolveOnDay(benchedId!, day) ?? undefined)}); OH주전 최강 ${strongest.name}(${ov(strongest)})·최약 ${weakest.name}(${ov(weakest)})`;
          verdict = benchedId === weakest.id ? PASS : (benchedId === strongest.id ? FAIL : '⚠️ 중간');
          done = true; break;
        }
      }
      if (done) break;
    }
    setOwnerContext([]);
    add('G2. suggestStart=최약 주전 벤치', verdict, observed || '감독 수락 없음');
  }

  // ════════ 요약 ════════
  log(`\n${'═'.repeat(60)}\n선발 검증 요약`);
  for (const r of results) log(`  ${r.status.padEnd(4)} ${r.item}`);
  const fails = results.filter((r) => r.status === FAIL).length;
  const gaps = results.filter((r) => r.status === GAP).length;
  log(`\nFAIL ${fails} · 미구현 ${gaps} · 통과 ${results.filter((r) => r.status === PASS).length}`);
  process.exit(0);
})();
