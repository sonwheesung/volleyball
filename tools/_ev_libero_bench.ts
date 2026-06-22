// 재현 — (B) 벤치 지시가 가용 리베로를 0으로 만드는가(리베로 가드 부재)
//        (A) suggestStart가 '최약 주전'이 아닌 '최강'을 벤치하는가(코드/주석 모순)
//   Usage: npx tsx tools/_ev_libero_bench.ts
import './_gt_mock';

(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, getEvolvedTeamPlayers } = await import('../data/league');
  const { availableTeamPlayers, setOwnerContext } = await import('../data/dynamics');
  const { buildLineup } = await import('../engine/lineup');
  const { overall } = await import('../engine/overall');
  const log = (m: string) => process.stdout.write(m + '\n');

  const t0 = LEAGUE.teams[0].id;
  const G = () => useGameStore.getState();
  G().selectTeam(t0);

  // ── (B) 리베로 가드 ──
  const squad0 = getEvolvedTeamPlayers(t0, 0);
  const liberos = squad0.filter((p) => p.position === 'L').sort((a, b) => overall(b) - overall(a));
  log(`\n═══ (B) 리베로 벤치 가드 ═══`);
  log(`t0 리베로 보유: ${liberos.map((l) => `${l.name}(OVR ${Math.round(overall(l))})`).join(', ') || '없음'}`);
  setOwnerContext(liberos.map((l) => ({ playerId: l.id, fromDay: 0 }))); // 전 리베로 벤치 지시
  const availB = availableTeamPlayers(t0, 0);
  const luB = buildLineup(availB);
  const liberoOnCourt = luB.libero ? `${luB.libero.name}` : '없음 ✗';
  log(`전 리베로에 벤치 지시 → 코트 리베로: ${liberoOnCourt}  (가용 ${availB.length}명)`);
  log(`B_LIBERO_PRESENT = ${!!luB.libero}`);
  setOwnerContext([]); // 리셋

  // ── (A) suggestStart 인컴번트 선택 ──
  log(`\n═══ (A) suggestStart 인컴번트(벤치 대상) 선택 ═══`);
  let benchedId: string | null = null, accepted = false, tried = 0;
  for (let day = 0; day <= 40 && !accepted; day += 4) {
    G().setDay(day);
    const avail = availableTeamPlayers(t0, day);
    const lu = buildLineup(avail);
    const starterIds = new Set([...lu.six.map((p) => p.id), ...(lu.libero ? [lu.libero.id] : [])]);
    const ohStarters = lu.six.filter((p) => p.position === 'OH').sort((a, b) => overall(b) - overall(a));
    const benchOHs = avail.filter((p) => p.position === 'OH' && !starterIds.has(p.id)).sort((a, b) => overall(b) - overall(a));
    if (!ohStarters.length || !benchOHs.length) continue;
    const before = G().benchDirectives.length;
    for (const cand of benchOHs) {
      tried++;
      const ok = G().suggestStart(cand.id);
      if (ok) {
        accepted = true;
        const nd = G().benchDirectives;
        benchedId = nd[nd.length - 1]?.playerId ?? null;
        const benchedP = squad0.find((p) => p.id === benchedId) ?? getEvolvedTeamPlayers(t0, day).find((p) => p.id === benchedId);
        const strongest = ohStarters[0], weakest = ohStarters[ohStarters.length - 1];
        log(`수락(day ${day}) — 건의 선수: ${cand.name}(OVR ${Math.round(overall(cand))})`);
        log(`OH 주전: 최강 ${strongest.name}(${Math.round(overall(strongest))}) … 최약 ${weakest.name}(${Math.round(overall(weakest))})`);
        log(`→ 실제 벤치된 선수: ${benchedP?.name}(OVR ${benchedP ? Math.round(overall(benchedP)) : '?'})`);
        const benchedStrongest = benchedId === strongest.id;
        const benchedWeakest = benchedId === weakest.id;
        log(`벤치=최강? ${benchedStrongest}  ·  벤치=최약? ${benchedWeakest}`);
        log(`A_BENCHED_STRONGEST = ${benchedStrongest}`);
        break;
      }
    }
  }
  if (!accepted) log(`(${tried}회 시도, 감독 수락 없음 — 표본 부족)`);
  process.exit(0);
})();
