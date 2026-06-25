// 측정·가드 — AI 드래프트 3티어 픽(FA_SYSTEM 3.1). 통제 시나리오로 세 티어를 모두 발화시켜 불변식 + 사유를 검증,
//   실제 드래프트 클래스에도 불변식 위반 0 확인, 성격(tier3) A/B 자가검증, 결정론.
//   npx tsx tools/_ev_draftpick.ts
// 불변식: I1 super=특급 / I2 비-super 픽엔 특급 잔존 0(특급 항상 먼저=BPA) / I3 need=부족포지션 / I4 best=부족없음.
// A/B: 부족 없는 팀 + 동일 포지션·OVR·성격만 다름 → 좋은 성격 선발(뒤집으면 반대).
import './_gt_mock';
import type { Position } from '../types';
(async () => {
  const { buildDraftContext } = await import('../data/draftSetup');
  const { resolveDraft, pickWithReason, isSuperProspect } = await import('../engine/draft');
  const { positionGap, ROSTER_IDEAL } = await import('../engine/aiGM');
  const { getTeam, teamScoutReveal } = await import('../data/league');
  const styleOf = (tid: string) => getTeam(tid)?.coachStyle ?? 'balanced';
  const ctx = buildDraftContext('', {}, {}, [], false, [], 1);
  const baseP = ctx.cls[0];
  const mk = (id: string, pos: string, ovr: number, pot: number, traits: any[] = [], mental = ovr): any => ({
    ...baseP, id, name: id, position: pos, traits,
    jump: ovr, agility: ovr, staminaMax: ovr, staminaRegen: ovr, reaction: ovr, positioning: ovr,
    focus: mental, consistency: mental, vq: mental,
    skSpike: ovr, skBlock: ovr, skDig: ovr, skReceive: ovr, skSet: ovr, skServe: ovr,
    potential: Object.fromEntries(Object.keys(baseP.potential).map((k) => [k, pot])),
  });
  const fails: string[] = [];

  // ── 통제 시나리오: 세 티어 모두 발화 ──
  const snap: Record<string, any> = {};
  const put = (p: any) => { snap[p.id] = p; return p.id; };
  // 클래스: 특급 1(OP pot90) + 비특급 다수
  const cls = [mk('sup', 'OP', 75, 90), mk('s1', 'S', 70, 80), mk('s2', 'S', 60, 78), mk('oh1', 'OH', 72, 82), mk('mb1', 'MB', 68, 80)];
  cls.forEach((p) => (snap[p.id] = p));
  // b: 이상 구성 가득(부족 0 → tier3 best). a: S 1자리 부족(tier2 need). c: 비어(needs).
  const full: string[] = []; let n = 0;
  for (const [pos, cnt] of Object.entries(ROSTER_IDEAL)) for (let k = 0; k < cnt; k++) full.push(put(mk(`b${n++}`, pos, 60, 70)));
  const aRoster: string[] = []; let m = 0;
  for (const [pos, cnt] of Object.entries(ROSTER_IDEAL)) { const keep = pos === 'S' ? cnt - 1 : cnt; for (let k = 0; k < keep; k++) aRoster.push(put(mk(`a${m++}`, pos, 60, 70))); }
  const rosters = { c: [] as string[], a: aRoster, b: full };
  const get = (id: string) => snap[id];
  const order = ['c', 'c', 'a', 'b'];
  const res = resolveDraft(order, cls, rosters, get, '', [], styleOf);
  const reasons = res.sequence.map((s) => s.reason);
  // 기대: c→특급(super) · c→need · a→need(S) · b→best
  if (reasons[0] !== 'super') fails.push(`1픽 reason=${reasons[0]} (super 기대 — 특급 BPA)`);
  if (res.sequence[0].playerId !== 'sup') fails.push(`1픽=${res.sequence[0].playerId} (sup 기대)`);
  if (!reasons.includes('need')) fails.push('need 티어 미발화');
  const bStep = res.sequence.find((s) => s.teamId === 'b');
  if (!bStep || bStep.reason !== 'best') fails.push(`b 픽 reason=${bStep?.reason} (best 기대 — 부족 없음)`);
  const aStep = res.sequence.find((s) => s.teamId === 'a');
  if (aStep && get(aStep.playerId).position !== 'S') fails.push(`a 픽 포지션=${get(aStep.playerId).position} (S 기대 — 부족)`);

  // 불변식 재생(통제 시나리오)
  const rep: Record<string, string[]> = { c: [], a: [...aRoster], b: [...full] };
  const avail = new Set(cls.map((p) => p.id));
  let i1 = 0, i2 = 0, i3 = 0, i4 = 0;
  for (const step of res.sequence) {
    const p = snap[step.playerId];
    const gap = positionGap(rep[step.teamId], get);
    const supersLeft = [...avail].map((id) => snap[id]).filter(isSuperProspect);
    if (step.reason === 'super' && !isSuperProspect(p)) i1++;
    if (step.reason !== 'super' && step.reason !== 'wish' && supersLeft.length) i2++;
    if (step.reason === 'need' && gap[p.position as Position] <= 0) i3++;
    if (step.reason === 'best' && Object.values(gap).some((g) => g > 0)) i4++;
    avail.delete(step.playerId); rep[step.teamId].push(step.playerId);
  }
  if (i1 || i2 || i3 || i4) fails.push(`불변식 위반 I1=${i1} I2=${i2} I3=${i3} I4=${i4}`);

  // ── 실제 시즌1 드래프트에도 불변식 위반 0(작아도 정합) ──
  const realR = resolveDraft(ctx.order, ctx.cls, ctx.rosters, (id) => ctx.snapshot[id], '', [], styleOf, teamScoutReveal);
  const clsById = new Map(ctx.cls.map((p) => [p.id, p]));
  const getR = (id: string) => ctx.snapshot[id] ?? clsById.get(id);
  const repR: Record<string, string[]> = {}; for (const k of Object.keys(ctx.rosters)) repR[k] = [...ctx.rosters[k]];
  const availR = new Set(ctx.cls.map((p) => p.id)); let rv = 0;
  for (const step of realR.sequence) {
    const gap = positionGap(repR[step.teamId] ?? [], getR);
    const supersLeft = [...availR].map((id) => clsById.get(id)!).filter(isSuperProspect);
    if (step.reason !== 'super' && step.reason !== 'wish' && supersLeft.length) rv++;
    if (step.reason === 'need' && gap[clsById.get(step.playerId)!.position] <= 0) rv++;
    availR.delete(step.playerId); (repR[step.teamId] ??= []).push(step.playerId);
  }
  if (rv) fails.push(`실제 드래프트 불변식 위반 ${rv}`);

  // ── A/B 성격(tier3) ──
  const goodChar = mk('gc', 'OH', 70, 70, ['leader', 'clutch'], 80);
  const badChar = mk('bc', 'OH', 70, 70, ['choke', 'glass'], 80);
  const get2 = (id: string) => ({ gc: goodChar, bc: badChar } as any)[id] ?? snap[id];
  const pg = pickWithReason([goodChar, badChar], full, get2, 'balanced');
  const abGood = pg?.player.id === 'gc' && pg?.reason === 'best';
  const pf = pickWithReason([mk('gc', 'OH', 70, 70, ['choke'], 80), mk('bc', 'OH', 70, 70, ['leader'], 80)], full, get2, 'balanced');
  const abFlip = pf?.player.id === 'bc';
  if (!abGood) fails.push('A/B 좋은성격 선발 실패');
  if (!abFlip) fails.push('A/B 뒤집기 실패(도구 둔감)');

  // ── 결정론 ──
  const res2 = resolveDraft(order, cls, rosters, get, '', [], styleOf);
  if (JSON.stringify(res.sequence) !== JSON.stringify(res2.sequence)) fails.push('결정론 위반');

  console.log('=== AI 드래프트 3티어 픽 검증 ===');
  console.log(`  통제 시나리오 사유: [${reasons.join(', ')}] (기대 super,need,need,best)`);
  console.log(`  불변식 통제 I1=${i1} I2=${i2} I3=${i3} I4=${i4} · 실제 드래프트 위반 ${rv}`);
  console.log(`  A/B 성격: 좋은성격 선발=${abGood}(${pg?.reason}) · 뒤집기=${abFlip}`);
  const pass = fails.length === 0;
  console.log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}${fails.length ? ' — ' + fails.join(' / ') : ''}`);
  if (!pass) process.exit(1);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
