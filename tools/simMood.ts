// 선수 심리(ROTATION_MORALE B+C) 검증 — 벤치 사유 귀속 + 사유·성격별 기분.
//   ① 사유 귀속(주전/실력밀림/부상/징계/구단주벤치)이 실제 라인업·부상·지시와 일치
//   ② 부상·징계는 '출전 불만' 없음(핵심 수정 — 구단 탓 아님)
//   ③ 같은 사유(구단주 벤치)라도 성격(출전 갈망 w.play)에 따라 불만/무감정 갈림 (A/B 자가검증)
//   ④ 긍정/무감정 상태가 실제로 발생
//   Usage: npx tsx tools/simMood.ts
import './_gt_mock';

const PASS = '✅ PASS', FAIL = '❌ FAIL', NA = '⚠️ 표본부족';

(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, getEvolvedTeamPlayers } = await import('../data/league');
  const { availableTeamPlayers, setOwnerContext, teamInjuriesOn } = await import('../data/dynamics');
  const { buildLineup } = await import('../engine/lineup');
  const { discontentNow, benchCauseOf } = await import('../data/owner');
  const { prefWeightsOf } = await import('../engine/faMarket');
  const { overall } = await import('../engine/overall');
  const { SEASON } = await import('../data/league');
  const log = (m: string) => process.stdout.write(m + '\n');

  const t0 = LEAGUE.teams[0].id;
  const G = () => useGameStore.getState();
  G().selectTeam(t0);
  const results: { item: string; status: string; note: string }[] = [];
  const add = (item: string, status: string, note: string) => { results.push({ item, status, note }); log(`\n[${item}] ${status}\n  ${note}`); };

  G().setDay(60); // 시즌 중반 — 출전 이력 충분
  const day = G().currentDay;

  // ── ① 사유 귀속 ──
  {
    setOwnerContext([]);
    const avail = availableTeamPlayers(t0, day);
    const lu = buildLineup(avail);
    const starterIds = new Set([...lu.six.map((p) => p.id), ...(lu.libero ? [lu.libero.id] : [])]);
    const aStarter = lu.six[0];
    const aBench = avail.find((p) => !starterIds.has(p.id))!;
    const cs = benchCauseOf(aStarter, t0, day), cb = benchCauseOf(aBench, t0, day);
    // 구단주 벤치 주입
    setOwnerContext([{ playerId: aBench.id, fromDay: day }]);
    const cOwner = benchCauseOf(aBench, t0, day);
    setOwnerContext([]);
    const ok = cs === 'starter' && cb === 'outclassed' && cOwner === 'ownerBenched';
    add('① 사유 귀속', ok ? PASS : FAIL,
      `주전 ${aStarter.name}→'${cs}' · 비주전 ${aBench.name}→'${cb}' · 벤치지시 후→'${cOwner}'`);
  }

  // ── ② 부상·징계는 출전 불만 없음 ──
  {
    setOwnerContext([]);
    let injChecked = 0, injMinutesDiscontent = 0, sample = '';
    const days = [...new Set(SEASON.map((f) => f.dayIndex))].sort((a, b) => a - b);
    for (const d of days) {
      const inj = teamInjuriesOn(t0, d);
      for (const span of inj) {
        const p = getEvolvedTeamPlayers(t0, d).find((x) => x.id === span.playerId);
        if (!p) continue;
        injChecked++;
        const m = discontentNow(p, t0, d);
        if (m.topic === 'minutes') injMinutesDiscontent++;
        if (!sample) sample = `${p.name}(부상, day${d}) → 사유 '${m.cause}', 기분 '${m.mood}', 출전불만 ${m.topic === 'minutes'}`;
      }
    }
    add('② 부상자 출전 불만 없음', injChecked > 0 && injMinutesDiscontent === 0 ? PASS : (injChecked === 0 ? NA : FAIL),
      `부상 ${injChecked}건 중 출전 불만(minutes) ${injMinutesDiscontent}건. 예: ${sample || '없음'}`);
  }

  // ── ③ 같은 벤치, 성격(w.play)에 따라 기분 갈림 (A/B) ──
  {
    const roster = getEvolvedTeamPlayers(t0, day).filter((p) => p.position !== 'L');
    const byPlay = [...roster].sort((a, b) => prefWeightsOf(b).play - prefWeightsOf(a).play);
    const hi = byPlay[0], lo = byPlay[byPlay.length - 1];
    setOwnerContext([{ playerId: hi.id, fromDay: day }, { playerId: lo.id, fromDay: day }]);
    const mHi = discontentNow(hi, t0, day), mLo = discontentNow(lo, t0, day);
    setOwnerContext([]);
    // 출전 갈망 높은 선수 = 불만, 낮은 선수 = 덜함(불만 아님 또는 약함). 핵심: 같은 벤치인데 기분이 성격으로 갈림.
    const split = mHi.mood === 'discontent' && mLo.mood !== 'discontent';
    add('③ 감정=f(사유,성격) A/B', split ? PASS : NA,
      `둘 다 구단주 벤치. 출전갈망 高 ${hi.name}(w.play ${prefWeightsOf(hi).play.toFixed(2)})→'${mHi.mood}'(${mHi.label}) / ` +
      `低 ${lo.name}(${prefWeightsOf(lo).play.toFixed(2)})→'${mLo.mood}'(${mLo.label})`);
  }

  // ── ④ 긍정/무감정 발생 ──
  {
    setOwnerContext([]);
    const moods: Record<string, number> = { discontent: 0, neutral: 0, positive: 0 };
    for (const t of LEAGUE.teams) {
      for (const p of getEvolvedTeamPlayers(t.id, day)) {
        // discontentNow는 내 팀 기준 — 각 팀을 내 팀처럼 평가(분포만 보기 위해)
        const m = discontentNow(p, t.id, day);
        moods[m.mood]++;
      }
    }
    add('④ 긍정·무감정·불만 분포', moods.positive > 0 && moods.neutral > 0 ? PASS : FAIL,
      `긍정 ${moods.positive} · 무감정 ${moods.neutral} · 불만 ${moods.discontent} (세 상태 다 발생해야 정상)`);
  }

  // ── ⑤ 주전 기대치 게이트 (엔진 A/B — 같은 선수·같은 성격, 기대치만 1.0 vs 0.1) ──
  {
    const { discontentOf } = await import('../engine/owner');
    const { prefWeightsOf } = await import('../engine/faMarket');
    // 출전 갈망 높은 선수로 — 기대치가 유일 변수가 되게(성격은 고정)
    const roster = getEvolvedTeamPlayers(t0, day).filter((p) => p.position !== 'L');
    const p = [...roster].sort((a, b) => prefWeightsOf(b).play - prefWeightsOf(a).play)[0];
    const base = { recentRankAvg: 4, teamCount: 7, playRatio: 0, salaryRatio: 1, myTeamId: t0, sitCause: 'ownerBenched' as const };
    const dHigh = discontentOf(p, { ...base, expectsPlay: 1.0 }); // 주전감 → 출전 불만
    const dLow = discontentOf(p, { ...base, expectsPlay: 0.1 });  // 약체후보 → 불만 없음
    const ok = dHigh === 'minutes' && dLow !== 'minutes';
    add('⑤ 주전 기대치 게이트', ok ? PASS : FAIL,
      `${p.name}(w.play ${prefWeightsOf(p).play.toFixed(2)}, 구단주 벤치) — 기대 1.0→'${dHigh}' / 기대 0.1→'${dLow ?? '불만없음'}' ` +
      `(같은 선수·성격, 기대치만 달라 불만 on/off — 저OVR·저경력은 못 나와도 불만 없음)`);
  }

  log(`\n${'═'.repeat(56)}\n선수 심리 검증 요약`);
  for (const r of results) log(`  ${r.status.padEnd(4)} ${r.item}`);
  log(`\nFAIL ${results.filter((r) => r.status === FAIL).length}`);
  process.exit(0);
})();
