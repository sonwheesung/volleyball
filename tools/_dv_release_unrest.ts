// 가드 — 핵심 동료 방출 → 남은 선수단 동요(TRANSACTION_SYSTEM 0.5④·RELATIONSHIP §3.2). 재계약 거부 확률에 팀 단위 unrest 가산.
//   A/B: 핵심(명성 높음) 방출 → 만료 선수 refuseProb += releaseUnrestBias([명성])(+친구는 relTerm 초과); 무명 방출 → unrest +0(게이트).
//   buildOwnerFx는 getTxContext()의 내 방출자에서 unrest를 도출 → tx 컨텍스트만 바꿔 격리 측정(매치 무관).
//
//   ★ 기대 모델 정정(2026-07-06, 발견·검증=Fable 5 / 진단·수정=Opus 에이전트 — EC-TX-06):
//   구모델 "B[id] ≥ A[id](방출 전 refuse) + uCore"는 **base 불변**을 전제했으나 이는 스테일이었다.
//   방출은 만료자의 **출전 역할**을 바꾼다 — 방출된 핵심과 **같은 포지션에서 밀려 있던(outclassed) 만료자**는
//   핵심이 빠지면 **주전 승격 → 출전 불만(base) 소멸**(discontentNow가 라커룸과 별개로 정당하게 반응).
//   그 만료자는 unrest(+uCore)를 받아도 사라진 base를 못 되살려 total은 오히려 낮아진다(엔진 WAI, 문서 조항 위반 아님 —
//   0.5④는 "unrest 항을 전원에 가산"만 보장, total 단조를 보장하지 않음). 따라서 방출 전 refuse를 기준선으로 쓰면 허위 FAIL.
//   ⇒ 정정 모델: 만료자를 **방출이 출전 역할을 바꿨는지(discontent 불변?)로 두 갈래**로 나눠 검증한다.
//     · base 불변(핵심과 무관한 만료자): B == A + uCore + relTerm 을 **정확히**(문서 "정확히 +uCore"). ← 강한 양성 증인.
//     · base 이동(핵심에게 밀리다 승격된 동포지션 만료자): base가 정당히 이동 → 방출후 base(≥0)+uCore+relTerm 이 **하한**(unrest 항 존재 증명).
//   npx tsx tools/_dv_release_unrest.ts [N=8]
import './_gt_mock';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, SEASON, currentRosters, evolveOnDay } = await import('../data/league');
  const { buildOwnerFx, discontentNow } = await import('../data/owner');
  const { setTxContext, getTxContext } = await import('../data/dynamics');
  const { popularityOf, releaseUnrestBias } = await import('../engine/owner');
  const { affinity, pairKey } = await import('../engine/relationships');
  const { relationBonds } = await import('../data/relationships');
  const { getPlayer } = await import('../data/league');
  const { SEASON_DAYS } = await import('../engine/calendar');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const N = Math.max(4, Number(process.argv[2]) || 8);
  const END = SEASON_DAYS;              // buildOwnerFx 내부 기준일(만료·discontent)과 일치시킨다
  const REL_LEAVE_K = 0.15;             // data/owner.ts REL_LEAVE_K 대조(친구 방출 relTerm 계수 — 읽기 전용)
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
  // discontent 지문(base 결정 요소: topic·weight·playRatio) — 방출이 이 만료자의 출전 역할을 바꿨는지 판정용
  const discAt = (id: string, tx: any[]) => { setTxContext(tx, pool, my); const d = discontentNow(evolveOnDay(id, END)!, my, END); return `${d.topic}|${d.weight.toFixed(4)}|${d.playRatio.toFixed(4)}`; };

  const A = fx([]);             // 방출 없음
  const B = fx(rel(core.id));   // 핵심 방출
  const C = fx(rel(scrub.id));  // 무명 방출

  const expiring = Object.keys(A).concat(Object.keys(B)).filter((id, i, a) => a.indexOf(id) === i && id !== core.id && id !== scrub.id);
  const uCore = releaseUnrestBias([core.stat]);
  const uScrub = releaseUnrestBias([scrub.stat]);

  if (uCore <= 0) fails.push(`핵심 명성 ${core.stat} → unrest 0 (빌드업이 명성 낮음 — N↑ 필요)`);
  if (expiring.length === 0) fails.push('만료 선수(거부권자) 0 — A/B 비교 불가');

  const bonds = relationBonds();
  const coreP = getPlayer(core.id)!;
  const scrubP = getPlayer(scrub.id)!;
  const relTermTo = (id: string, rp: any) => REL_LEAVE_K * Math.max(0, affinity(getPlayer(id)!, rp, bonds[pairKey(id, rp.id)] ?? 0, false));

  let okUp = 0, shifted = 0, invariantWit = 0, friendChecked = 0, friendExceed = 0;
  const rows: string[] = [];
  for (const id of expiring) {
    const a = A[id] ?? 0, b = B[id] ?? 0, c = C[id] ?? 0;
    const rt = relTermTo(id, coreP);                     // 핵심 방출 시 이 만료자의 relTerm(친구면 >0)
    // 방출이 이 만료자의 출전 역할을 바꿨나? (핵심 방출 전/후 discontent 지문 비교)
    const invariant = discAt(id, []) === discAt(id, rel(core.id));

    if (invariant) {
      // base 불변 → 정확히 +uCore(+친구 relTerm). 문서 "정확히 +uCore"의 정본 케이스.
      const exp = Math.min(0.95, a + uCore + rt);
      if (Math.abs(b - exp) > 1e-6) fails.push(`핵심 방출 후 ${id} refuse ${b.toFixed(3)} ≠ ${exp.toFixed(3)}(base불변→정확히 +uCore+rel)`);
      else { okUp++; invariantWit++; }
      // 친구(relTerm>0) 만료자는 중립 동료보다 더 오른다(관계 항 작동, 상한 미만일 때)
      if (rt > 1e-9 && exp < 0.95 - 1e-6) { friendChecked++; if (b > a + uCore + 1e-9) friendExceed++; }
      rows.push(`  ${id.padEnd(8)} base불변 | A ${a.toFixed(3)} → B ${b.toFixed(3)} (=A+uCore${rt > 0 ? '+rel' + rt.toFixed(3) : ''})`);
    } else {
      // base 이동(핵심에게 밀리다 주전 승격 등) → 방출후 base(≥0)+uCore+relTerm 이 하한. unrest 항이 살아있음을 증명.
      shifted++;
      const floor = Math.min(0.95, uCore + rt);          // 방출후 base≥0 이므로 하한
      if (b < floor - 1e-6) fails.push(`핵심 방출 후 ${id}(역할변동) refuse ${b.toFixed(3)} < ${floor.toFixed(3)}(unrest 미가산)`);
      else okUp++;
      rows.push(`  ${id.padEnd(8)} 역할변동 | A ${a.toFixed(3)} → B ${b.toFixed(3)} (≥ uCore+rel ${floor.toFixed(3)}) — 주전 승격으로 출전불만 소멸`);
    }

    // 무명 방출(uScrub=0): unrest 없음. base 불변인 만료자만 검사(무명 방출도 역할 바꾸면 base 이동 가능 → 그건 제외).
    const scrubInvariant = discAt(id, []) === discAt(id, rel(scrub.id));
    if (scrubInvariant) {
      const rtS = relTermTo(id, scrubP);                 // 무명이 친구면 relTerm은 붙을 수 있으나 unrest는 0
      const expS = Math.min(0.95, a + uScrub + rtS);
      if (Math.abs(c - expS) > 1e-6) fails.push(`무명 방출 후 ${id} refuse ${c.toFixed(3)} ≠ ${expS.toFixed(3)} (게이트: unrest 0)`);
    }
  }
  if (invariantWit === 0) fails.push('base 불변 만료자 0 — "정확히 +uCore" 양성 증인 없음(N↑ 필요)');
  if (friendChecked > 0 && friendExceed === 0) fails.push(`핵심의 친한 만료자 ${friendChecked}명 — 아무도 uCore 초과 안 함(관계 항 미작동)`);

  console.log('=== 핵심 방출 → 선수단 동요 측정 (N=' + N + ') ===');
  console.log(`  핵심 ${evolveOnDay(core.id, 164)?.name}(명성 ${core.stat}, ${coreP.position}) → unrest +${uCore} · 무명 ${evolveOnDay(scrub.id, 164)?.name}(명성 ${scrub.stat}) → +${uScrub}`);
  console.log(`  만료(거부권) 선수 ${expiring.length}명 · unrest 정상반영 ${okUp}/${expiring.length} (base불변 ${invariantWit} · 역할변동 ${shifted}) · 무명 방출 시 게이트`);
  for (const r of rows) console.log(r);
  console.log(`\nRESULT: ${fails.length === 0 ? 'PASS' : 'FAIL — ' + fails.slice(0, 4).join(' / ')}`);
  if (fails.length) process.exit(1);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
