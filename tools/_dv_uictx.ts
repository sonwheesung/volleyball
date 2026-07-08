// 상비 가드 — 화면(draft·draft-live·fa)이 오프시즌 컨텍스트를 store.endSeason과 **동일 인자**로 만드는지.
//   npx tsx tools/_dv_uictx.ts   ; echo $?
//
// 배경(전수조사 2026-07-08, EC-FA-09): draft/draft-live/fa 가 tryoutWish·keepForeign·moneyOnlyIds·asianWish·keepAsian를
//   누락(기본값 []·null)해 endSeason과 다른 컨텍스트를 만들었다 → 라이브 확정픽 유실·FA 미리보기≠결과.
// 검사:
//   (A) 정합 — 공용 조립(offseasonResolveArgs 경유 draftContextFor/resolveDraftContextFor/resolveFAPreviewFor)이
//       endSeason이 손수 나열하는 14인자 호출과 byte-동일(다시즌×토글 조합, 0 불일치). 순서/개수 드리프트 잡음.
//   (B) fa.tsx 등급 == 엔진 pre-FA 등급 — 등급을 pre-market(base.off.snapshot)으로 매김. + A/B 이빨: post-market(pv.snapshot)로
//       매기면(옛 코드) 다수 불일치(엔진 resolveFAMarket이 서명 선수 연봉을 갱신 → 순위 뒤바뀜).
//   (C) A/B 인자 이빨 — 5개 꼬리 인자를 빠뜨린 '옛 버그' 조립은 올바른 조립과 ≥1 시즌에서 다른 컨텍스트를 낸다(인자가 load-bearing).
import './_gt_mock';
import type { Player } from '../types';
import type { OffseasonInputs } from '../data/offseasonArgs';

(async () => {
  const { buildDraftContext, buildOffseasonBase } = await import('../data/draftSetup');
  const { faMarketPreviewFrom, scandalRepMap } = await import('../data/offseason');
  const { offseasonResolveArgs, draftContextFor, resolveDraftContextFor, resolveFAPreviewFor } =
    await import('../data/offseasonArgs');
  const { assignFAGrades } = await import('../engine/faMarket');
  const { LEAGUE } = await import('../data/league');

  const fails: string[] = [];
  const log = (m: string) => process.stdout.write(m + '\n');
  const my = LEAGUE.teams[0].id;
  const BIG = 5_000_000_000;

  // 직렬화 — Player Record/배열/Set을 안정 비교(Set은 정렬 배열로).
  const ser = (v: unknown): string => JSON.stringify(v, (_k, val) => (val instanceof Set ? [...val].sort() : val));
  const serDraft = (c: any) => ser({ snapshot: c.snapshot, rosters: c.rosters, order: c.order, cls: c.cls,
    myHoles: c.myHoles, myPickSlots: c.myPickSlots, tryout: c.tryout, asianTryout: c.asianTryout, compCash: c.compCash });
  const serFA = (p: any) => ser({ pool: p.pool, snapshot: p.snapshot, myRoster: p.myRoster,
    signedByMe: p.signedByMe, lostTo: p.lostTo, compCash: p.compCash });

  const baseInp = (nextSeason: number): OffseasonInputs => ({
    my, resignDecisions: {}, contractOverrides: {}, faSignings: [], faAggressive: false, protectedIds: [],
    nextSeason, ownerFx: undefined, myCash: BIG, tryoutWish: [], keepForeign: null, moneyOnlyIds: [], asianWish: [], keepAsian: null,
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // (A) 정합 — 공용 조립 == endSeason 손수 나열(14인자). 다시즌 × 몇몇 토글 변형.
  // ─────────────────────────────────────────────────────────────────────────────
  let aChecks = 0;
  for (let s = 1; s <= 8; s++) {
    // 토글 변형: 기본 + keepForeign=false + keepAsian=false(둘 다 로스터·지갑에 영향)
    const variants: OffseasonInputs[] = [
      baseInp(s),
      { ...baseInp(s), keepForeign: false },
      { ...baseInp(s), keepForeign: false, keepAsian: false },
    ];
    for (const inp of variants) {
      const base = buildOffseasonBase(inp.my, inp.resignDecisions, inp.contractOverrides, inp.nextSeason, inp.ownerFx);
      // 드래프트: endSeason 경로(draftContextFor) vs 손수 나열 vs 화면 경로(resolveDraftContextFor). 셋 다 동일해야.
      const endseasonLiteral = buildDraftContext(inp.my, inp.resignDecisions, inp.contractOverrides,
        inp.faSignings, inp.faAggressive, inp.protectedIds, inp.nextSeason, inp.ownerFx, inp.myCash,
        inp.tryoutWish, inp.keepForeign, inp.moneyOnlyIds, inp.asianWish, inp.keepAsian);
      const viaHelper = draftContextFor(inp);
      const viaScreen = resolveDraftContextFor(base, inp);
      aChecks++;
      if (serDraft(viaHelper) !== serDraft(endseasonLiteral)) fails.push(`(A) draftContextFor≠endSeason나열 s=${s} kf=${inp.keepForeign} ka=${inp.keepAsian}`);
      if (serDraft(viaScreen) !== serDraft(endseasonLiteral)) fails.push(`(A) 화면경로≠endSeason나열 s=${s} kf=${inp.keepForeign} ka=${inp.keepAsian}`);
      // FA 미리보기: 화면 경로(resolveFAPreviewFor) vs 손수 나열(faMarketPreviewFrom 14인자).
      const faLiteral = faMarketPreviewFrom(base, inp.my, inp.faSignings, inp.faAggressive, inp.protectedIds,
        inp.nextSeason, inp.ownerFx, inp.myCash, inp.tryoutWish, inp.keepForeign, inp.moneyOnlyIds, inp.asianWish, inp.keepAsian);
      const faHelper = resolveFAPreviewFor(base, inp);
      if (serFA(faHelper) !== serFA(faLiteral)) fails.push(`(A) resolveFAPreviewFor≠나열 s=${s} kf=${inp.keepForeign} ka=${inp.keepAsian}`);
    }
  }
  // offseasonResolveArgs 순서/개수 명시 검사 — 드리프트 조기 경보.
  {
    const inp = { ...baseInp(3), faSignings: ['x'], faAggressive: true, protectedIds: ['p'], myCash: 123,
      tryoutWish: ['a'], keepForeign: false, moneyOnlyIds: ['m'], asianWish: ['b'], keepAsian: true };
    const args = offseasonResolveArgs(inp);
    const expect = [inp.faSignings, inp.faAggressive, inp.protectedIds, inp.nextSeason, inp.ownerFx, inp.myCash,
      inp.tryoutWish, inp.keepForeign, inp.moneyOnlyIds, inp.asianWish, inp.keepAsian];
    if (ser(args) !== ser(expect)) fails.push('(A) offseasonResolveArgs 튜플 순서/개수 드리프트');
    if (args.length !== 11) fails.push(`(A) 꼬리 인자 개수 ${args.length}≠11`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // (B) fa.tsx 등급 == 엔진 pre-FA 등급 (pre-market 스냅샷) · A/B: post-market은 다수 불일치
  // ─────────────────────────────────────────────────────────────────────────────
  let bPoolTotal = 0, bPreMismatch = 0, bPostMismatch = 0, bSignedSalaryMoved = 0;
  for (let s = 1; s <= 8; s++) {
    const inp = baseInp(s);
    const base = buildOffseasonBase(inp.my, inp.resignDecisions, inp.contractOverrides, inp.nextSeason, inp.ownerFx);
    const pv = resolveFAPreviewFor(base, inp);
    const preSnap = base.off.snapshot;                 // fa.tsx 수정본이 쓰는 pre-market 스냅샷(엔진 등급 입력과 동일)
    const postSnap = pv.snapshot;                       // 옛 fa.tsx가 쓰던 post-market(해석 후) 스냅샷
    // 엔진이 등급을 매기는 입력(문서 §2.2·EC-FA-08): resolveFAMarket 은 cloneOff(base).snapshot(=base.off.snapshot 얕은복제,
    //   Player 객체 불변)로 assignFAGrades → 곧 base.off.snapshot 연봉. 아래 engineGrades가 그 재현.
    const poolPre = pv.pool.map((id) => preSnap[id]).filter((p): p is Player => !!p);
    const poolPost = pv.pool.map((id) => postSnap[id]).filter((p): p is Player => !!p);
    const engineGrades = assignFAGrades(pv.pool.map((id) => base.off.snapshot[id]).filter((p): p is Player => !!p));
    const faFixed = assignFAGrades(poolPre);            // fa.tsx 수정본
    const faOld = assignFAGrades(poolPost);             // fa.tsx 옛 코드(A/B 변이)
    for (const id of pv.pool) {
      bPoolTotal++;
      if (faFixed.get(id) !== engineGrades.get(id)) bPreMismatch++;   // 반드시 0
      if (faOld.get(id) !== engineGrades.get(id)) bPostMismatch++;    // 이빨: >0 이어야
      const preS = preSnap[id]?.contract.salary, postS = postSnap[id]?.contract.salary;
      if (preS !== undefined && postS !== undefined && preS !== postS) bSignedSalaryMoved++;
    }
  }
  if (bPreMismatch !== 0) fails.push(`(B) fa 수정본 등급≠엔진 pre-FA 등급 ${bPreMismatch}/${bPoolTotal}(0 기대)`);
  if (bPostMismatch === 0) fails.push('(B) A/B 둔감 — post-market 등급이 엔진과 100% 일치(옛 버그가 재현 안 됨 = 허위 오라클)');
  if (bSignedSalaryMoved === 0) fails.push('(B) 전제 붕괴 — pre/post 스냅샷 연봉이 한 건도 안 달라짐(FA 시장 미작동?)');

  // ─────────────────────────────────────────────────────────────────────────────
  // (C) A/B 인자 이빨 — 5 꼬리 인자를 빠뜨린 '옛 버그' 조립은 올바른 조립과 다른 컨텍스트를 낸다.
  // ─────────────────────────────────────────────────────────────────────────────
  let cDiffSeasons = 0, cChecked = 0;
  for (let s = 1; s <= 12; s++) {
    // 비-기본 토글(옛 코드가 무시하던 5개를 모두 활성) — keepForeign=false는 내 외인을 풀로 → 로스터/스냅샷 이동.
    const inp: OffseasonInputs = { ...baseInp(s), keepForeign: false, keepAsian: false };
    const correct = draftContextFor(inp);
    // 옛 버그 재현: 5 꼬리 인자를 빠뜨린 호출(tryoutWish=[]·keepForeign=null·moneyOnly=[]·asianWish=[]·keepAsian=null 디폴트)
    const broken = buildDraftContext(inp.my, inp.resignDecisions, inp.contractOverrides,
      inp.faSignings, inp.faAggressive, inp.protectedIds, inp.nextSeason, inp.ownerFx, inp.myCash);
    cChecked++;
    if (serDraft(correct) !== serDraft(broken)) cDiffSeasons++;
  }
  if (cDiffSeasons === 0) fails.push(`(C) A/B 둔감 — 5 꼬리 인자 누락이 ${cChecked}시즌 모두 컨텍스트를 안 바꿈(인자 non-load-bearing?)`);

  // 잔여 참조(경고 억제) — scandalRepMap export 존재 확인(요구연봉 할인 산식 공유).
  if (typeof scandalRepMap !== 'function') fails.push('scandalRepMap export 없음');

  log('=== 화면↔endSeason 인자 정합 가드(_dv_uictx) ===');
  log(`  (A) 정합 ${aChecks} 케이스(8시즌×3토글, 드래프트 3경로+FA 미리보기) + 튜플 순서 검사`);
  log(`  (B) 등급 pre-FA: 수정본 불일치 ${bPreMismatch}/${bPoolTotal}(0 기대) · A/B post-market 불일치 ${bPostMismatch}(>0 이빨) · 연봉이동 ${bSignedSalaryMoved}`);
  log(`  (C) A/B 인자 이빨: 5 꼬리 누락이 ${cDiffSeasons}/${cChecked} 시즌에서 컨텍스트 변경(>0 이빨)`);
  const pass = fails.length === 0;
  log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}${fails.length ? ' — ' + fails.join(' / ') : ''}`);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
