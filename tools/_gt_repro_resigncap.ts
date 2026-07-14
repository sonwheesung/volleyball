// EC-TX-05 재현 + 가드 A/B — reSign 개인상한 우회. 결정론.
//   A) 수정 검증: 개인상한 초과 reSign → 거부(override 비어있음), 정상 reSign → 적용.
//   B) 가드 A/B(이빨): 불변식이 읽는 커밋 계약에 over-cap을 직접 주입 → 불변식(_gt_invariants 개인상한)이 잡는가(즉시 원복).
//   둘 다 참이어야 신뢰(허위 오라클 아님). Usage: npx tsx tools/_gt_repro_resigncap.ts
import './_gt_mock';
import { checkCommittedRosters } from './_gt_invariants';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, currentRosters, getPlayer } = await import('../data/league');
  const { maxSalaryFor } = await import('../engine/cap');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;

  G().resetSave(); G().selectTeam(my);
  const id = (currentRosters()[my] ?? []).find((i) => !getPlayer(i)?.isForeign);
  if (!id) { console.error('국내 선수 없음'); process.exit(1); }
  const cap = maxSalaryFor(getPlayer(id)!);

  // A) 개인상한 초과 reSign → 거부
  G().reSign(id, { salary: cap + 50000, years: 2, remaining: 2, signedAtAge: 25 });
  const rejected = G().contractOverrides[id] === undefined;

  // B) 정상(상한 이하) reSign → 적용
  const v = Math.min(cap, 40000);
  G().reSign(id, { salary: v, years: 2, remaining: 2, signedAtAge: 25 });
  const applied = G().contractOverrides[id]?.salary === v;

  // C) 가드 A/B(이빨 증명): 개인상한 초과 계약이 **커밋 로스터에 실제로 들어가면** 불변식이 잡는가.
  //   [브리틀 수리 2026-07-14] 기존 경로(contractOverrides 강제 주입 → endSeason 롤오버)는 비만료 선수의
  //   override를 롤오버가 커밋 계약(playerMap)에 반영하지 않아 getPlayer(id).contract.salary가 그대로라
  //   불변식이 읽을 over-cap이 애초에 안 생김(허위 FAIL·이빨 상실). → 불변식이 실제로 읽는 지점
  //   (committed contract)에 직접 over-cap을 주입해 검출을 증명하고 즉시 원복(변이 박제 금지·결정론 유지).
  const target = getPlayer(id)!;
  const origContract = target.contract;
  (target as any).contract = { ...(origContract ?? {}), salary: cap + 100000 };
  const guardCatches = checkCommittedRosters('ab').some((x) => x.check === 'num' && x.msg.includes('개인상한'));
  (target as any).contract = origContract; // 변이 원복

  console.log(`[EC-TX-05] 개인상한(${cap}) 초과 reSign 거부=${rejected} · 정상 reSign 적용=${applied}`);
  console.log(`[가드 A/B] 커밋 계약에 over-cap 직접 주입 → 불변식 검출=${guardCatches} (true여야 신뢰)`);
  const ok = rejected && applied && guardCatches;
  console.log(`\nRESIGNCAP OK = ${ok}`);
  process.exit(ok ? 0 : 2);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
