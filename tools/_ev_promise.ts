// 측정·가드 — 면담 공약 파기('주전 보장' 약속 후 벤치 → 배신 → 재계약 거부 급등). OWNER_SYSTEM 1.3.
//   npx tsx tools/_ev_promise.ts   (exit 0=PASS / 1=FAIL)
// 시나리오(같은 만료 선수, ownerFx만 다름):
//  A 벤치 + '주전보장'(starter) 약속 성공  → 파기 → 거부 급등(PROMISE_BREACH_REFUSE)
//  B 벤치 + 약속 없음                      → 벤치 불만만(파기 아님)
//  C 벤치 + '전력보강'(reinforce) 약속 성공 → 카드 불일치 → 파기 아님(성공 보정만 → B보다 낮음)
//  D 미벤치 + '주전보장' 약속 성공          → 이행(출전 시킴) → 파기 아님(거부 낮음)
// A/B: A > B(파기 가산) · A > C+0.3(주전 카드 특정) · A ≥ 0.5(이탈권) · D < A(이행≠파기).
import './_gt_mock';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, getEvolvedTeamPlayers } = await import('../data/league');
  const { setOwnerContext } = await import('../data/dynamics');
  const { buildOwnerFx } = await import('../data/owner');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  G().resetSave(); G().selectTeam(my); G().setDay(164);
  const season = G().season;
  const promise = (id: string, card: string) => [{ playerId: id, season, day: 10, topic: 'minutes', card, ok: true } as any];

  // 만료 예정(remaining≤1)·비리베로 — 벤치하면 출전 불만(minutes)이 잘 발화하는 선수
  const cands = getEvolvedTeamPlayers(my, 164).filter((p) => p.position !== 'L' && p.contract.remaining <= 1);
  let chosen: string | null = null, A = 0, B = 0, C = 0, D = 0;
  for (const cand of cands) {
    setOwnerContext([{ playerId: cand.id, fromDay: 0 }]); // 시즌 내내 벤치
    const b = buildOwnerFx([], season, my, 50).refuseProb[cand.id] ?? 0;
    if (b <= 0) { setOwnerContext([]); continue; } // 벤치 불만이 발화한 선수만(minutes 토픽)
    const a = buildOwnerFx(promise(cand.id, 'starter'), season, my, 50).refuseProb[cand.id] ?? 0;
    const c = buildOwnerFx(promise(cand.id, 'reinforce'), season, my, 50).refuseProb[cand.id] ?? 0;
    setOwnerContext([]); // 미벤치(이행)
    const d = buildOwnerFx(promise(cand.id, 'starter'), season, my, 50).refuseProb[cand.id] ?? 0;
    chosen = cand.id; A = a; B = b; C = c; D = d; break;
  }
  setOwnerContext([]);
  if (!chosen) { console.error('벤치 시 출전불만 발화하는 만료 선수 없음 — abort'); process.exit(1); }

  const fails: string[] = [];
  if (!(A > B)) fails.push(`A(파기 ${A.toFixed(2)}) > B(벤치만 ${B.toFixed(2)}) 실패 — 파기 가산 없음`);
  if (!(A > C + 0.3)) fails.push(`A(${A.toFixed(2)}) > C(전력보강 ${C.toFixed(2)})+0.3 실패 — 주전 카드 특정 아님`);
  if (!(A >= 0.5)) fails.push(`A(${A.toFixed(2)}) < 0.5 — 이탈권까지 안 올라감`);
  if (!(D < A)) fails.push(`D(미벤치=이행 ${D.toFixed(2)}) < A 실패 — 이행이 파기처럼 처리됨`);

  console.log('=== 면담 공약 파기(주전보장→벤치) ===');
  console.log(`  선수 ${chosen}`);
  console.log(`  A 벤치+주전약속(파기)  거부 ${A.toFixed(2)}`);
  console.log(`  B 벤치+약속없음        거부 ${B.toFixed(2)}`);
  console.log(`  C 벤치+전력보강약속    거부 ${C.toFixed(2)} (카드 불일치 → 파기 아님, 성공 보정만)`);
  console.log(`  D 미벤치+주전약속(이행) 거부 ${D.toFixed(2)}`);
  console.log(`  A/B: 파기>벤치만=${A > B} · 주전특정(A>C+0.3)=${A > C + 0.3} · 이탈권(A≥0.5)=${A >= 0.5} · 이행<파기(D<A)=${D < A}`);
  const pass = fails.length === 0;
  console.log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}${fails.length ? ' — ' + fails.join(' / ') : ''}`);
  if (!pass) process.exit(1);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
