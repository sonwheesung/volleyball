// 가드 — 계약 관리(국내 전용) 외인 차단. 외인/아시아쿼터는 방출·재계약 비대상(FOREIGN_SYSTEM 3장).
// 버그(리뷰 발견 2026-06-25): app/contracts.tsx가 외인을 국내 선수처럼 방출 노출 + store.release에 외인 차단 없음
//   → 외인을 방출하면 FA 풀로도 안 가(리그 떠남) 그 자리가 시즌 1회 교체 외엔 못 메우는 공석.
// 수정: store.release/reSign 외인 거부 + UI에서 외인 분리(읽기전용) + willBeFA에 !isForeign.
//   npx tsx tools/_dv_foreign_contract.ts   (exit 0=PASS / 1=FAIL)
// A/B: 같은 외인에 (국내 대조군) 방출은 true·재계약은 override 생성 — 도구가 차단/허용을 정확히 구분.
import './_gt_mock';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, evolveOnDay } = await import('../data/league');
  const { rosterIdsOnDay } = await import('../data/dynamics');
  const { willBeFA } = await import('../engine/faMarket');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const fails: string[] = [];

  G().resetSave(); G().selectTeam(my); G().setDay(0);
  const ros = rosterIdsOnDay(my, 0).map((id) => evolveOnDay(id, 0));
  const fgn = ros.find((p) => p?.isForeign && !p?.isAsianQuota);
  const asn = ros.find((p) => p?.isAsianQuota);
  const dom = ros.find((p) => p && !p.isForeign);
  if (!fgn || !dom) { console.error('시드에 외인/국내 없음 — abort'); process.exit(1); }

  // 1) 외인 방출 거부
  const relFgn = G().release(fgn!.id);
  if (relFgn) fails.push(`release(외인)=true — 차단 실패(공석 버그)`);
  // 2) 아시아쿼터 방출 거부
  if (asn) { const relAsn = G().release(asn!.id); if (relAsn) fails.push(`release(아시아쿼터)=true — 차단 실패`); }
  // 3) 국내 방출 허용(대조군 — 과교정 아님)
  const relDom = G().release(dom!.id);
  if (!relDom) fails.push(`release(국내)=false — 국내 방출이 깨짐(과교정)`);

  // 4) 외인 재계약 거부(override 미생성) / 국내 재계약 허용
  G().resetSave(); G().selectTeam(my); G().setDay(0);
  G().reSign(fgn!.id, { salary: 50000, years: 2, remaining: 2, signedAtAge: fgn!.age } as any);
  if (G().contractOverrides[fgn!.id]) fails.push(`reSign(외인)이 override 생성 — 차단 실패`);
  G().reSign(dom!.id, { salary: 20000, years: 2, remaining: 2, signedAtAge: dom!.age } as any);
  if (!G().contractOverrides[dom!.id]) fails.push(`reSign(국내)가 override 미생성 — 국내 재계약 깨짐(과교정)`);

  // 5) willBeFA는 외인 비대상
  if (willBeFA({ ...fgn!, isForeign: true, career: { ...(fgn as any).career, seasons: 9 }, contract: { ...fgn!.contract, remaining: 1 } } as any))
    fails.push(`willBeFA(외인)=true — 외인이 국내 FA 예정에 노출`);
  if (!willBeFA({ isForeign: false, career: { seasons: 9 }, contract: { remaining: 1 } } as any))
    fails.push(`willBeFA(국내 9시즌 만료)=false — 정상 FA 예정이 안 잡힘(과교정)`);

  // ── A/B 자가검증: 외인 isForeign 플래그를 끈 "가짜 국내"로 보면 방출이 허용돼야(도구가 분기를 본다) ──
  // (release는 getPlayer로 판정하므로 직접 못 끔 → reSign 분기로 민감도 입증: 국내는 통과·외인은 차단을 위에서 이미 보임)
  const abSensitive = !G().contractOverrides[fgn!.id] && !!G().contractOverrides[dom!.id]; // 외인 차단·국내 통과 동시 = 분기 작동

  console.log('=== 계약 관리 외인 차단 가드 ===');
  console.log(`  release: 외인=${relFgn}(기대 false)${asn ? ` · 아시아=${G().released.includes(asn.id)}(기대 false)` : ''} · 국내=${relDom}(기대 true)`);
  console.log(`  reSign override: 외인=${!!G().contractOverrides[fgn!.id]}(기대 false) · 국내=${!!G().contractOverrides[dom!.id]}(기대 true)`);
  console.log(`  A/B 분기작동(외인차단·국내통과)=${abSensitive}`);
  const pass = fails.length === 0 && abSensitive;
  console.log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}${fails.length ? ' — ' + fails.join(' / ') : ''}`);
  if (!pass) process.exit(1);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
