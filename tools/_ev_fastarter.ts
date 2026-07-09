// 측정·가드 — FA '주전 보장' 레버 대가(FA_SYSTEM §2.8 Phase2 ①). 계약 flag(contract.starterGuarantee)로
//   데려온 FA를 이후 시즌에 벤치하면, 면담 로그가 전혀 없어도 '공약 파기'가 재파생돼 재계약 거부가 급등한다
//   (PROMISE_BREACH_REFUSE). faOffers는 오프시즌 후 비워지므로 계약 flag가 '주전 보장 약속'의 두 번째 출처.
//   npx tsx tools/_ev_fastarter.ts   (exit 0=PASS / 1=FAIL)
// 같은 만료(remaining≤1)·비리베로 선수, ownerContext(벤치)/계약(보장)만 다르게:
//   N  벤치 + 보장 없음(면담 X)     → 벤치 불만만(파기 아님)
//   G  벤치 + 계약 보장(면담 X)     → 파기 → 거부 급등(N보다↑, ≥0.5 이탈권)
//   H  미벤치 + 계약 보장           → 이행(주전) → 파기 아님(< G)
//   (민감도) expectsPlayOf: 보장 시 = 1 (무명에게 주전 약속하고 앉히는 공짜 회피 차단)
import './_gt_mock';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, getEvolvedTeamPlayers, getPlayer, commitPlayerBase } = await import('../data/league');
  const { setOwnerContext } = await import('../data/dynamics');
  const { buildOwnerFx, discontentNow, expectsPlayOf } = await import('../data/owner');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const DAY = 164;
  G().resetSave(); G().selectTeam(my); G().setDay(DAY);
  const season = G().season;
  const fails: string[] = [];

  // 후보 = force-bench 시 출전 불만(minutes)이 나는 만료 선수(보장 없이도) — _ev_promise와 동일 선정 원칙(브리틀 방지).
  const cands = getEvolvedTeamPlayers(my, DAY).filter((p) => p.position !== 'L' && p.contract.remaining <= 1);
  let chosen: string | null = null, N = 0;
  for (const cand of cands) {
    setOwnerContext([{ playerId: cand.id, fromDay: 0 }]); // 시즌 내내 벤치
    const dn = discontentNow(getEvolvedTeamPlayers(my, DAY).find((p) => p.id === cand.id)!, my, DAY);
    if (dn.topic !== 'minutes') { setOwnerContext([]); continue; }
    N = buildOwnerFx([], season, my, 50).refuseProb[cand.id] ?? 0; // 벤치 + 보장 없음 + 면담 없음
    chosen = cand.id; break;
  }
  setOwnerContext([]);
  if (!chosen) { console.error('force-bench 시 minutes 불만 나는 만료 선수 없음 — abort'); process.exit(1); }

  // 이 선수의 계약에 주전 보장 flag를 박는다(=내가 FA 주전보장으로 데려온 것과 동일 상태). remaining≤1 유지.
  const base = getPlayer(chosen)!;
  commitPlayerBase({ [chosen]: { ...base, contract: { ...base.contract, starterGuarantee: true } } });

  // 민감도: 보장 시 주전 기대치=1
  const eGuard = expectsPlayOf(getEvolvedTeamPlayers(my, DAY).find((p) => p.id === chosen)!, my, DAY);
  if (eGuard !== 1) fails.push(`expectsPlayOf(보장)=${eGuard.toFixed(2)} ≠ 1 — 보장 기대치 상향 미발동`);

  // G: 벤치 + 계약 보장(면담 없음) → 파기
  setOwnerContext([{ playerId: chosen, fromDay: 0 }]);
  const Gp = buildOwnerFx([], season, my, 50).refuseProb[chosen] ?? 0;
  // H: 미벤치 + 계약 보장 → 이행
  setOwnerContext([]);
  const Hp = buildOwnerFx([], season, my, 50).refuseProb[chosen] ?? 0;
  setOwnerContext([]);

  if (!(Gp > N)) fails.push(`G(보장+벤치=파기 ${Gp.toFixed(2)}) > N(벤치만 ${N.toFixed(2)}) 실패 — FA 보장 파기 가산 없음`);
  if (!(Gp >= 0.5)) fails.push(`G(${Gp.toFixed(2)}) < 0.5 — 이탈권까지 안 올라감`);
  if (!(Hp < Gp)) fails.push(`H(미벤치=이행 ${Hp.toFixed(2)}) < G 실패 — 이행이 파기처럼 처리됨`);

  console.log('=== FA 주전보장 레버 대가(계약 flag → 벤치 → 파기) ===');
  console.log(`  선수 ${chosen} · expectsPlay(보장)=${eGuard.toFixed(2)}`);
  console.log(`  N 벤치+보장없음      거부 ${N.toFixed(2)}`);
  console.log(`  G 벤치+계약보장(파기) 거부 ${Gp.toFixed(2)}`);
  console.log(`  H 미벤치+보장(이행)  거부 ${Hp.toFixed(2)}`);
  console.log(`  A/B: 파기>벤치만=${Gp > N} · 이탈권(G≥0.5)=${Gp >= 0.5} · 이행<파기(H<G)=${Hp < Gp}`);

  if (fails.length) { console.error('\nRESULT: FAIL\n - ' + fails.join('\n - ')); process.exit(1); }
  console.log('\nRESULT: PASS');
})();
