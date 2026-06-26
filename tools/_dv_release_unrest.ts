// 가드 — 핵심 동료 방출 → 남은 선수단 동요(TRANSACTION_SYSTEM 0.5④). 재계약 거부 확률에 팀 단위 unrest 가산.
//   A/B: 핵심(명성 높음) 방출 → 만료 선수 refuseProb += releaseUnrestBias([명성]); 무명 방출 → +0(게이트).
//   buildOwnerFx는 getTxContext()의 내 방출자에서 unrest를 도출 → tx 컨텍스트만 바꿔 격리 측정(매치 무관).
//   npx tsx tools/_dv_release_unrest.ts [N=8]
import './_gt_mock';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, SEASON, currentRosters, evolveOnDay } = await import('../data/league');
  const { buildOwnerFx } = await import('../data/owner');
  const { setTxContext, getTxContext } = await import('../data/dynamics');
  const { popularityOf, releaseUnrestBias } = await import('../engine/owner');
  const { affinity } = await import('../engine/relationships');
  const { getPlayer } = await import('../data/league');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const N = Math.max(4, Number(process.argv[2]) || 8);
  const myFix = SEASON.filter((f: any) => f.homeTeamId === my || f.awayTeamId === my);
  const fails: string[] = [];

  // (1) 순수 함수: 단조·상한·게이트
  if (!(releaseUnrestBias([45]) > releaseUnrestBias([30]) && releaseUnrestBias([30]) > releaseUnrestBias([20]) && releaseUnrestBias([5]) === 0)) fails.push('releaseUnrestBias 단조/게이트 깨짐');
  if (releaseUnrestBias([45, 45, 45, 45]) > 0.25 + 1e-9) fails.push('releaseUnrestBias 상한 0.25 초과');

  // 빌드업(8시즌) — 계약 만료자·다양한 명성 확보
  G().resetSave(); G().selectTeam(my);
  for (let s = 0; s < N; s++) { for (const f of myFix) G().recordResult({ fixtureId: f.id, homeSets: 3, awaySets: 1 } as any); G().setDay(164); G().endSeason(); }
  for (const f of myFix) G().recordResult({ fixtureId: f.id, homeSets: 3, awaySets: 1 } as any); G().setDay(164);

  const statOf = (id: string) => { const p = evolveOnDay(id, 164)!; return popularityOf(p.career.points, 0, p.clubTenure, 0); };
  const roster = (currentRosters()[my] ?? []).filter((id) => { const p = evolveOnDay(id, 164); return p && !p.isForeign; });
  const ranked = roster.map((id) => ({ id, stat: statOf(id) })).sort((a, b) => b.stat - a.stat);
  const core = ranked[0];                                  // 핵심(명성 최고)
  const scrub = [...ranked].reverse().find((r) => r.stat < 14) ?? ranked[ranked.length - 1]; // 무명(unrest 0 게이트)

  const pool = G().faPool;
  const fx = (releaseTx: { day: number; teamId: string; playerId: string; kind: 'release' }[]) => {
    setTxContext(releaseTx, pool, my);
    return buildOwnerFx([], G().season, my, 50).refuseProb;
  };
  const rel = (id: string) => [{ day: 164, teamId: my, playerId: id, kind: 'release' as const }];

  const A = fx([]);             // 방출 없음
  const B = fx(rel(core.id));   // 핵심 방출
  const C = fx(rel(scrub.id));  // 무명 방출

  const expiring = Object.keys(A).concat(Object.keys(B)).filter((id, i, a) => a.indexOf(id) === i && id !== core.id && id !== scrub.id);
  const uCore = releaseUnrestBias([core.stat]);
  const uScrub = releaseUnrestBias([scrub.stat]);

  if (uCore <= 0) fails.push(`핵심 명성 ${core.stat} → unrest 0 (빌드업이 명성 낮음 — N↑ 필요)`);
  if (expiring.length === 0) fails.push('만료 선수(거부권자) 0 — A/B 비교 불가');
  // 핵심 방출: 만료 선수 refuseProb가 **최소 uniform unrest만큼** 상승(중립 동료=정확히 uCore, 친한 동료=초과).
  //  RELATIONSHIP §3.2 — uniform unrest 위에 affinity 가산(친구만 더 동요). friendStay는 A/B 동일이라 델타서 상쇄.
  let okUp = 0, friendExceed = 0, friendChecked = 0;
  const coreP = getPlayer(core.id)!;
  for (const id of expiring) {
    const a = A[id] ?? 0, b = B[id] ?? 0, exp = Math.min(0.95, a + uCore);
    if (b < exp - 1e-6) fails.push(`핵심 방출 후 ${id} refuse ${b.toFixed(3)} < ${exp.toFixed(3)}(최소 uniform)`);
    else okUp++;
    // 핵심과 친한(positive affinity) 만료자는 uCore보다 더 오른다(상한 0.95 미만일 때)
    const aff = affinity(getPlayer(id)!, coreP, 0, false);
    if (aff > 0.25 && exp < 0.95 - 1e-6) { friendChecked++; if (b > exp + 1e-9) friendExceed++; }
    // 무명 방출: 최소 uScrub만큼(게이트)
    const c = C[id] ?? 0;
    if (c < a + uScrub - 1e-6) fails.push(`무명 방출 후 ${id} refuse ${c.toFixed(3)} < ${(a + uScrub).toFixed(3)} (게이트)`);
  }
  if (friendChecked > 0 && friendExceed === 0) fails.push(`핵심의 친한 만료자 ${friendChecked}명 — 아무도 uCore 초과 안 함(관계 항 미작동)`);

  console.log('=== 핵심 방출 → 선수단 동요 측정 (N=' + N + ') ===');
  console.log(`  핵심 ${evolveOnDay(core.id, 164)?.name}(명성 ${core.stat}) → unrest +${uCore} · 무명 ${evolveOnDay(scrub.id, 164)?.name}(명성 ${scrub.stat}) → +${uScrub}`);
  console.log(`  만료(거부권) 선수 ${expiring.length}명 · 핵심 방출 시 거부확률 정확상승 ${okUp}/${expiring.length} · 무명 방출 시 불변`);
  console.log(`\nRESULT: ${fails.length === 0 ? 'PASS' : 'FAIL — ' + fails.slice(0, 4).join(' / ')}`);
  if (fails.length) process.exit(1);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
