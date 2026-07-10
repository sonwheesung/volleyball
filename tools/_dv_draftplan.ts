// 상비 가드 — 드래프트 지명권 계획(보유 vs 행사 예정, UI_RULES DL-1·DL-2, 2026-07-10).
//   npx tsx tools/_dv_draftplan.ts   ; echo $?
// 검사:
//   (A) 불변식 — slots==DRAFT_ROUNDS(4) · 예상지명+예상PASS==slots · slotNos.length==slots (실 리그 40시즌).
//   (B) prefix 교차검증 — myDraftPlan.passRounds가 order↔sequence ground truth(내 실 지명 라운드=[1..M])의 여집합과 일치.
//   (C) 데이터 구동 — 표본 전체에서 예상지명>0 시즌과 예상PASS>0 시즌이 모두 존재(상수 아님 = 실제 로스터 판정 반영).
//   (D) 결정론 — 같은 ctx → 같은 plan ×2.
//   (E) passReasonFor A/B 이빨 — 로스터 상태에 따라 사유가 갈린다(빈 로스터=neutral / 목표도달=deep / 상한=full).
//        상수 사유(가짜 드라마)면 이 셋이 안 갈려 FAIL.
import './_gt_mock';
import type { CoachStyle, Player } from '../types';

// order↔sequence로 각 픽의 진짜 라운드(팀별 등장 횟수) 산출 — prefix 불변식 ground truth(_dv_draftsummary와 동일).
function trueRoundsForTeam(order: string[], sequence: { teamId: string; playerId: string }[], team: string): number[] {
  const cnt: Record<string, number> = {};
  let k = 0;
  const rounds: number[] = [];
  for (const t of order) {
    cnt[t] = (cnt[t] ?? 0) + 1;
    if (k < sequence.length && sequence[k].teamId === t) {
      if (t === team) rounds.push(cnt[t]);
      k++;
    }
  }
  return rounds;
}

(async () => {
  const { buildDraftContext } = await import('../data/draftSetup'); // import 시 AI 밸류어 등록
  const { resolveDraft, DRAFT_ROUNDS } = await import('../engine/draft');
  const { getTeam, teamScoutReveal, LEAGUE } = await import('../data/league');
  const { aiTargetOf } = await import('../data/rosterTarget');
  const { myDraftPlan, passReasonFor } = await import('../data/draftPlan');
  const { generateDraftClass } = await import('../data/draftClass');

  const fails: string[] = [];
  const log = (m: string) => process.stdout.write(m + '\n');
  const my = LEAGUE.teams[0].id;
  const styleOf = (tid: string): CoachStyle => getTeam(tid)?.coachStyle ?? 'balanced';

  let seasons = 0, sumPicks = 0, seasonsWithPick = 0, seasonsWithPass = 0;
  for (let s = 1; s <= 40; s++) {
    // 찜 변형: 절반은 상위 몇 명 찜(위시 폴백 반영), 절반은 무찜(순수 AI 판정).
    const ctx = buildDraftContext(my, {}, {}, [], false, [], s);
    const wishlist = s % 2 === 0 ? ctx.cls.slice(0, (s % 3)).map((p) => p.id) : [];
    const plan = myDraftPlan(ctx, my, wishlist);
    seasons++;
    sumPicks += plan.expectedPicks;
    if (plan.expectedPicks > 0) seasonsWithPick++;
    if (plan.expectedPasses > 0) seasonsWithPass++;

    // (A) 불변식
    if (plan.slots !== DRAFT_ROUNDS) fails.push(`(A) s${s}: slots ${plan.slots}≠${DRAFT_ROUNDS}`);
    if (plan.expectedPicks + plan.expectedPasses !== plan.slots) fails.push(`(A) s${s}: 지명${plan.expectedPicks}+PASS${plan.expectedPasses}≠${plan.slots}`);
    if (plan.slotNos.length !== plan.slots) fails.push(`(A) s${s}: slotNos ${plan.slotNos.length}≠${plan.slots}`);
    if (plan.expectedPicks < 0 || plan.expectedPasses < 0) fails.push(`(A) s${s}: 음수`);

    // (B) prefix 교차검증 — 같은 인자 resolveDraft ground truth
    const lk = (id: string): Player | undefined => ctx.snapshot[id];
    const res = resolveDraft(ctx.order, ctx.cls, ctx.rosters, lk, my, wishlist, styleOf, teamScoutReveal, [], aiTargetOf());
    const gt = trueRoundsForTeam(ctx.order, res.sequence, my);
    const expectedPrefix = Array.from({ length: plan.expectedPicks }, (_, i) => i + 1);
    if (JSON.stringify(gt) !== JSON.stringify(expectedPrefix)) fails.push(`(B) s${s}: 실 지명 라운드 ${JSON.stringify(gt)}≠prefix ${JSON.stringify(expectedPrefix)}`);
    const expectedPass: number[] = [];
    for (let r = 1; r <= plan.slots; r++) if (!gt.includes(r)) expectedPass.push(r);
    if (JSON.stringify(plan.passRounds) !== JSON.stringify(expectedPass)) fails.push(`(B) s${s}: passRounds ${JSON.stringify(plan.passRounds)}≠${JSON.stringify(expectedPass)}`);

    // (D) 결정론
    const plan2 = myDraftPlan(ctx, my, wishlist);
    if (JSON.stringify(plan) !== JSON.stringify(plan2)) fails.push(`(D) s${s}: plan 비결정`);
  }

  // (C) 데이터 구동 — 상수 아님
  if (seasonsWithPick === 0) fails.push('(C) 전 시즌 예상지명 0 — 상수 의심');
  if (seasonsWithPass === 0) fails.push('(C) 전 시즌 예상PASS 0 — 판정 미반영 의심');

  // (E) passReasonFor A/B 이빨 — 합성 로스터 3종이 서로 다른 사유를 낸다(상수 사유면 FAIL)
  {
    const cls = generateDraftClass(1, 40);
    const snapshot: Record<string, Player> = {};
    for (const p of cls) snapshot[p.id] = p;
    const mk = (n: number) => cls.slice(0, n).map((p) => p.id);
    const ctxLike = (roster: string[]) => ({ cls, snapshot, rosters: { ME: roster } } as unknown as import('../data/draftSetup').DraftContext);
    const target = aiTargetOf()('ME'); // 미상 팀 = 중앙값(14)
    const rEmpty = passReasonFor(ctxLike([]), 'ME', []);              // 빈 로스터 → 구멍 많음 → neutral
    const rDeep = passReasonFor(ctxLike(mk(target)), 'ME', []);       // 목표 도달 → deep
    const rFull = passReasonFor(ctxLike(mk(20)), 'ME', []);           // 계약 상한 → full
    if (rEmpty !== 'neutral') fails.push(`(E) 빈 로스터 사유 ${rEmpty}≠neutral`);
    if (rDeep !== 'deep') fails.push(`(E) 목표도달 사유 ${rDeep}≠deep`);
    if (rFull !== 'full') fails.push(`(E) 상한 사유 ${rFull}≠full`);
    if (new Set([rEmpty, rDeep, rFull]).size < 3) fails.push('(E) A/B 둔감 — 로스터 3종이 같은 사유(상수=가짜 드라마)');
  }

  log('=== 드래프트 지명권 계획 가드(_dv_draftplan) ===');
  log(`  (A) 불변식 ${seasons}시즌(slots=DRAFT_ROUNDS·지명+PASS==보유·slotNos)`);
  log(`  (B) prefix 교차검증(order↔sequence ground truth) ${seasons}시즌`);
  log(`  (C) 데이터 구동: 예상지명>0 ${seasonsWithPick}시즌 · 예상PASS>0 ${seasonsWithPass}시즌 · 평균지명 ${(sumPicks / seasons).toFixed(2)}`);
  log(`  (D) 결정론 ×2 · (E) passReasonFor A/B(neutral/deep/full 3분기)`);
  const pass = fails.length === 0;
  log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}${fails.length ? ' — ' + fails.slice(0, 8).join(' / ') : ''}`);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
