// 가드 — 외인 방출 FA 풀 오염 (FOREIGN_SYSTEM 3장 "외인은 방출/교체되면 리그를 떠난다 — FA 풀·드래프트에 절대 섞이지 않음").
// 버그(2026-06-25 독립 코드세션 발견): availableFAsOnDay(셀렉터)가 applyTx(정본 forward-pass)와 달리
//   방출 tx를 isForeign 무관 전부 add → 옛 외인이 FA 풀로 샘. replaceForeign(시즌중 교체)이 옛 외인
//   release tx를 남기므로 정상 플레이로 도달. 소비처 signInSeason은 isForeign 가드 없이 풀 멤버십만 봄 → 재영입 누수.
// 근본 수정: availableFAsOnDay에 applyTx(line 145)와 동일한 !isForeign 가드.
//   npx tsx tools/_dv_foreign_fa_leak.ts   (exit 0=PASS / 1=FAIL)
//
// A/B 자가검증: 같은 txLog에 (구)로직(전부 add)을 적용하면 외인이 잡혀야(도구 민감) — 안 잡히면 허위 오라클.
import './_gt_mock';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, evolveOnDay, getPlayer } = await import('../data/league');
  const { rosterIdsOnDay, availableFAsOnDay, seasonTxLog } = await import('../data/dynamics');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const fails: string[] = [];

  // ── 트리거: 외인 방출(매뉴얼 release 경로 — replaceForeign도 동일 release tx를 남김) ──
  G().resetSave(); G().selectTeam(my); G().setDay(0);
  const ros = rosterIdsOnDay(my, 0).map((id) => evolveOnDay(id, 0));
  const fgn = ros.find((p) => p?.isForeign && !p?.isAsianQuota);
  const dom = ros.find((p) => p && !p.isForeign);
  if (!fgn || !dom) { console.error('시드에 외인/국내가 없음 — abort'); process.exit(1); }
  G().release(fgn!.id);
  G().release(dom!.id);

  const pool = availableFAsOnDay(0);
  // ── A/B 자가검증(소비처 mutation 전에 고정): 같은 txLog에 (구)버그 로직 재현 → 외인이 잡혀야 도구가 민감 ──
  const buggy = new Set<string>();
  for (const tx of seasonTxLog()) { if (tx.day > 0) continue; if (tx.kind === 'release') buggy.add(tx.playerId); else buggy.delete(tx.playerId); }
  const abDetects = buggy.has(fgn!.id);   // 구로직은 외인을 넣어야(버그 재현) → true면 도구가 차이를 본다
  // 1) 외인은 FA 풀에 없어야(정본 = 리그 떠남)
  if (pool.includes(fgn!.id)) fails.push(`외인 ${fgn!.id} 가 availableFAsOnDay에 잔존(FA 풀 오염)`);
  // 2) 국내 방출자는 FA 풀에 있어야(대조군 — 도메스틱 FA는 정상 동작)
  if (!pool.includes(dom!.id)) fails.push(`국내 방출자 ${dom!.id} 가 FA 풀에 없음(과교정 — 도메스틱 FA가 깨짐)`);
  // 3) 풀 안에 외인이 한 명도 없어야(전수)
  const foreignInPool = pool.filter((id) => getPlayer(id)?.isForeign);
  if (foreignInPool.length) fails.push(`FA 풀에 외인 ${foreignInPool.length}명: ${foreignInPool.slice(0, 3).join(',')}`);

  // 4) 소비처 신뢰 — signInSeason은 풀 멤버십만 보므로, 캐시를 풀어도 외인 재영입 거부여야 / 국내는 허용
  useGameStore.setState({ cash: 9_999_999 });
  const reSignForeign = G().signInSeason(fgn!.id);
  if (reSignForeign) fails.push(`signInSeason(외인)=true — 방출 외인 재영입 누수(2외인 가능)`);
  const reSignDom = G().signInSeason(dom!.id);
  if (!reSignDom) fails.push(`signInSeason(국내)=false — 도메스틱 인시즌 FA가 깨짐(과교정)`);

  console.log('=== 외인 FA 풀 오염 가드 ===');
  console.log(`  availableFAsOnDay(0) 외인 포함=${pool.includes(fgn!.id)} (기대 false) · 국내 포함=${pool.includes(dom!.id)} (기대 true) · 풀내 외인수=${foreignInPool.length}`);
  console.log(`  signInSeason 외인재영입=${reSignForeign} (기대 false) · 국내영입=${reSignDom} (기대 true)`);
  console.log(`  A/B: (구)전부-add 로직은 외인 포함=${abDetects} (기대 true — 도구 민감성 입증)`);
  const pass = fails.length === 0 && abDetects;
  console.log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}${fails.length ? ' — ' + fails.join(' / ') : ''}${!abDetects ? ' — A/B 둔감(허위 오라클 의심)' : ''}`);
  if (!pass) process.exit(1);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
