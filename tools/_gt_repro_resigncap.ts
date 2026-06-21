// EC-TX-05 재현 + 가드 A/B — reSign 개인상한 우회. 결정론.
//   A) 수정 검증: 개인상한 초과 reSign → 거부(override 비어있음), 정상 reSign → 적용.
//   B) 가드 A/B: reSign을 우회해 over-cap override를 강제 주입 → 롤오버 후 불변식(_gt_invariants 개인상한)이 잡는가.
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

  // C) 가드 A/B: reSign 우회로 over-cap override 강제 주입 → 롤오버(endSeason) → 불변식이 잡는가
  useGameStore.setState({ contractOverrides: { ...G().contractOverrides, [id]: { salary: cap + 100000, years: 3, remaining: 3, signedAtAge: 25 } } });
  G().setDay(164); G().endSeason();
  const guardCatches = checkCommittedRosters('ab').some((x) => x.check === 'num' && x.msg.includes('개인상한'));

  console.log(`[EC-TX-05] 개인상한(${cap}) 초과 reSign 거부=${rejected} · 정상 reSign 적용=${applied}`);
  console.log(`[가드 A/B] reSign 우회 over-cap 주입 → 롤오버 후 불변식 검출=${guardCatches} (true여야 신뢰)`);
  const ok = rejected && applied && guardCatches;
  console.log(`\nRESIGNCAP OK = ${ok}`);
  process.exit(ok ? 0 : 2);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
