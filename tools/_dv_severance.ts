// 가드 — 방출 위약금(TRANSACTION_SYSTEM 0.5①). release가 cash에서 severanceFee 차감, unrelease가 환불,
//   지갑 부족 시 방출 불가. A/B: 위약금 0 가정이면 cash 불변이어야(민감도).
//   npx tsx tools/_dv_severance.ts
import './_gt_mock';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE } = await import('../data/league');
  const { getPlayer } = await import('../data/league');
  const { severanceFee } = await import('../engine/transactions');
  const G = () => useGameStore.getState();
  const fails: string[] = [];

  const my = LEAGUE.teams[0].id;
  G().resetSave(); G().selectTeam(my);

  // 내 국내 로스터에서 잔여연수 있는 선수 하나
  const rosterIds = (G().selectedTeamId === my) ? LEAGUE.teams[0].players : [];
  const target = rosterIds.map((id) => getPlayer(id)).find((p) => p && !p.isForeign && p.contract.remaining >= 1);
  if (!target) { console.log('대상 없음'); process.exit(1); }

  const fee = severanceFee(target!.contract.salary, target!.contract.remaining);
  if (fee <= 0) fails.push(`위약금이 0 (salary=${target!.contract.salary} rem=${target!.contract.remaining})`);

  // (1) 방출 → cash 차감
  const cash0 = G().cash;
  const ok = G().release(target!.id);
  if (!ok) fails.push('방출 실패(정원/지갑 충분한데)');
  const cash1 = G().cash;
  if (cash0 - cash1 !== fee) fails.push(`차감액 ${cash0 - cash1} ≠ 위약금 ${fee}`);

  // (2) 당일 철회 → 환불
  G().unrelease(target!.id);
  const cash2 = G().cash;
  if (cash2 !== cash0) fails.push(`철회 환불 후 ${cash2} ≠ 원복 ${cash0}`);

  // (3) 지갑 부족 → 방출 불가 (A/B 게이트)
  useGameStore.setState({ cash: Math.max(0, fee - 1) });
  const blocked = G().release(target!.id);
  if (blocked) fails.push('지갑 부족인데 방출 성공(게이트 무력)');
  // 차단됐으니 released에 없어야
  if (G().released.includes(target!.id)) fails.push('차단됐는데 released에 들어감');

  // (4) severanceFee 단조성: 잔여연수↑ → 위약금↑
  const f1 = severanceFee(5000, 1), f3 = severanceFee(5000, 3);
  if (!(f3 > f1)) fails.push(`잔여연수 단조성 깨짐 f1=${f1} f3=${f3}`);

  console.log('=== 방출 위약금 검증 ===');
  console.log(`  대상 ${target!.name} · 연봉 ${target!.contract.salary} · 잔여 ${target!.contract.remaining}년 → 위약금 ${fee}`);
  console.log(`  (1) 방출 차감 ${cash0}→${cash1} (−${cash0 - cash1})`);
  console.log(`  (2) 철회 환불 → ${cash2} (원복 ${cash0})`);
  console.log(`  (3) 지갑 부족(${Math.max(0, fee - 1)}) 방출 시도 → ${blocked ? '성공(❌)' : '차단(✓)'}`);
  console.log(`  (4) 단조성 f(1)=${f1} < f(3)=${f3}`);
  console.log(`\nRESULT: ${fails.length === 0 ? 'PASS' : 'FAIL — ' + fails.join(' / ')}`);
  if (fails.length) process.exit(1);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
