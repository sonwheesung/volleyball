// 상비 가드 — 라이브 인터랙티브 드래프트(FA_SYSTEM §3.2.1 조정 E) resolveDraft(mySelections) 불변식.
//   npx tsx tools/_dv_draftlive.ts   ; echo $?
// 검사:
//   (a) 결정론 — 같은 ctx + 같은 mySelections → 동일 전체 시퀀스(×2, 50시즌 ctx).
//   (b) mySelections 존중(가용 시) / 폴백(앞선 픽에 소진 시) — 충돌 구성으로 중복 배정 0·풀 무결.
//   (c) 재개 등가 — [s1]로 계산한 시퀀스가 [s1,s2]로 한 번에 계산한 것과 2번째 내 픽 전까지 동일(fast-forward 정확).
//   (d) 0-내픽 / 총0 형태.
//   (e) A/B — mySelections 무시(빈 배열=옛 폴백)면 (b)의 존중이 재현 안 됨(민감도, 허위 오라클 방지).
import './_gt_mock';
import type { Player } from '../types';

(async () => {
  const { buildDraftContext } = await import('../data/draftSetup'); // import 시 AI 밸류어 등록
  const { resolveDraft } = await import('../engine/draft');
  const { getTeam, teamScoutReveal, LEAGUE } = await import('../data/league');
  const styleOf = (tid: string) => getTeam(tid)?.coachStyle ?? 'balanced';
  const fails: string[] = [];
  const log = (m: string) => process.stdout.write(m + '\n');
  const seqKey = (s: { teamId: string; playerId: string; reason: string }[]) => JSON.stringify(s.map((x) => [x.teamId, x.playerId, x.reason]));

  const myTeam = LEAGUE.teams[0].id;

  // ── (a) 결정론 — 50시즌 ctx × (빈/비어있지 않은 selections) 각각 ×2 동일 ──
  let detChecks = 0;
  for (let s = 1; s <= 50; s++) {
    const ctx = buildDraftContext(myTeam, {}, {}, [], false, [], s);
    const lk = (id: string) => ctx.snapshot[id];
    // 비어있지 않은 selections(내 픽이 있으면 첫 슬롯에 임의 가용 유망주 지정)
    const sel = ctx.myPickSlots.length ? [ctx.cls[0].id] : [];
    for (const ms of [[], sel]) {
      const a = resolveDraft(ctx.order, ctx.cls, ctx.rosters, lk, myTeam, [], styleOf, teamScoutReveal, ms);
      const b = resolveDraft(ctx.order, ctx.cls, ctx.rosters, lk, myTeam, [], styleOf, teamScoutReveal, ms);
      detChecks++;
      if (seqKey(a.sequence) !== seqKey(b.sequence)) { fails.push(`(a) 결정론 위반 season=${s} selLen=${ms.length}`); break; }
    }
  }

  // ── 통제 시나리오: 내 팀 'ME'가 2개 슬롯(order idx 1·3) ──
  const rctx = buildDraftContext(myTeam, {}, {}, [], false, [], 7);
  const pool: Player[] = [...rctx.cls].slice(0, 10);
  const ME = 'ME';
  const order = ['A', ME, 'B', ME, 'C'];
  const rosters: Record<string, string[]> = { A: [], B: [], C: [], ME: [] };
  const lookup = (id: string) => rctx.snapshot[id]; // 로스터 비어있어 cls 외 조회 없음(clsById가 cls 커버)
  const myPositions = (seq: { teamId: string }[]) => seq.reduce<number[]>((acc, x, k) => (x.teamId === ME ? [...acc, k] : acc), []);
  // s1/s2 = 순수 AI 진행이 **전혀 뽑지 않는** 저평가 유망주 2명(경험적 — AI는 포텐도 보므로 '최저 실력'≠비선호).
  //   이러면 AI(폴백)는 절대 이들을 안 뽑아 '존중'이 관측 가능하고, 이웃 슬롯(B)도 이들을 소진하지 않는다.
  const pureAI = resolveDraft(order, pool, rosters, lookup, ME, [], styleOf, teamScoutReveal, []);
  const aiPicked = new Set(pureAI.sequence.map((x) => x.playerId));
  const unpicked = pool.filter((p) => !aiPicked.has(p.id));
  if (unpicked.length < 2) fails.push(`통제 구성 불량 — 미지명 유망주 ${unpicked.length}<2`);
  const s1 = (unpicked[0] ?? pool[0]).id, s2 = (unpicked[1] ?? pool[1]).id;
  const noDup = (seq: { playerId: string }[]) => new Set(seq.map((x) => x.playerId)).size === seq.length;

  // (b) 존중(가용) — [s1, s2] 둘 다 존중
  {
    const r = resolveDraft(order, pool, rosters, lookup, ME, [], styleOf, teamScoutReveal, [s1, s2]);
    const mp = myPositions(r.sequence);
    const ok = mp.length === 2 && r.sequence[mp[0]].playerId === s1 && r.sequence[mp[1]].playerId === s2;
    if (!ok) fails.push(`(b) 존중 실패 — 내 픽=${mp.map((k) => r.sequence[k].playerId)} 기대 [${s1},${s2}]`);
    if (!noDup(r.sequence)) fails.push('(b) 존중 시퀀스 중복 배정');
  }
  // (b) 폴백(소진) — [s1, s1]: 2번째는 이미 내가 가져가 소진 → 폴백(AI). 중복 0.
  {
    const r = resolveDraft(order, pool, rosters, lookup, ME, [], styleOf, teamScoutReveal, [s1, s1]);
    const mp = myPositions(r.sequence);
    const first = r.sequence[mp[0]].playerId, second = r.sequence[mp[1]].playerId;
    if (first !== s1) fails.push(`(b) 폴백 1픽=${first} 기대 ${s1}`);
    if (second === s1) fails.push('(b) 폴백 실패 — 소진된 선택을 중복 배정');
    if (!noDup(r.sequence)) fails.push('(b) 폴백 시퀀스 중복 배정(풀 무결 위반)');
    const s1Count = r.sequence.filter((x) => x.playerId === s1).length;
    if (s1Count !== 1) fails.push(`(b) s1 등장 ${s1Count}회(1 기대 — 풀 무결)`);
  }
  // (c) 재개 등가 — [s1]로 계산 vs [s1,s2] 한 번에 → 2번째 내 픽 전까지 동일
  {
    const rA = resolveDraft(order, pool, rosters, lookup, ME, [], styleOf, teamScoutReveal, [s1]);
    const rB = resolveDraft(order, pool, rosters, lookup, ME, [], styleOf, teamScoutReveal, [s1, s2]);
    const secondMyPos = myPositions(rB.sequence)[1];
    const eq = seqKey(rA.sequence.slice(0, secondMyPos)) === seqKey(rB.sequence.slice(0, secondMyPos));
    if (!eq) fails.push('(c) 재개 등가 실패 — [s1] 리드인 ≠ [s1,s2] 리드인');
  }
  // (d) 0-내픽 / 총0
  {
    const orderNoMe = ['A', 'B', 'C'];
    const r0 = resolveDraft(orderNoMe, pool, { A: [], B: [], C: [] }, lookup, ME, [], styleOf, teamScoutReveal, []);
    if (r0.sequence.some((x) => x.teamId === ME)) fails.push('(d) 0-내픽인데 ME 픽 등장');
    if (!noDup(r0.sequence)) fails.push('(d) 0-내픽 시퀀스 중복');
    const rEmpty = resolveDraft([], pool, {}, lookup, ME, [], styleOf, teamScoutReveal, []);
    if (rEmpty.sequence.length !== 0 || rEmpty.picked.length !== 0) fails.push('(d) 총0인데 시퀀스/픽 비어있지 않음');
  }
  // (e) A/B — mySelections 무시(빈)면 존중 재현 안 됨: 실제[s1,s2]는 s1 존중, 폴백[]는 s1 아님
  {
    const real = resolveDraft(order, pool, rosters, lookup, ME, [], styleOf, teamScoutReveal, [s1, s2]);
    const mutant = resolveDraft(order, pool, rosters, lookup, ME, [], styleOf, teamScoutReveal, []); // 무시 = 옛 폴백
    const realFirst = real.sequence[myPositions(real.sequence)[0]].playerId;
    const mutFirst = mutant.sequence[myPositions(mutant.sequence)[0]].playerId;
    if (realFirst !== s1) fails.push('(e) 실제 엔진이 s1 존중 안 함');
    if (mutFirst === s1) fails.push('(e) A/B 둔감 — 무시 변종도 s1을 뽑음(허위 오라클)');
  }

  log('=== 라이브 인터랙티브 드래프트 가드(_dv_draftlive) ===');
  log(`  (a) 결정론 ${detChecks} 케이스(50시즌×selections)`);
  log(`  (b) 존중/폴백 · (c) 재개등가 · (d) 0픽/총0 · (e) A/B 민감도`);
  const pass = fails.length === 0;
  log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}${fails.length ? ' — ' + fails.join(' / ') : ''}`);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
