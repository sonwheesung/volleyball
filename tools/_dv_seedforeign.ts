// 가드 — 시드 리그 수입선수 계약 1년 고정 (FOREIGN_SYSTEM §1 "계약: 1년 고정" 시드 정합, 2026-07-24 사용자 결정)
//
// 봉인하는 드리프트: `data/seed.ts makePlayer`가 `rng.int(1,3)`을 국적 구분 없이 적용해 **수입선수(외인 OP·아시아쿼터)가
//   2~3년 계약으로 태어나던 것**(실측 generateLeague(12345) 14명 = {1:3, 2:4, 3:7}). 문서·화면 안내("1년 계약이라
//   방출·재계약 대상이 아닙니다")·현실 V리그가 전부 1년인데 데이터만 어긋나 있었다 → 매년 트라이아웃이라는 핵심 레버가
//   시작부터 흐려진다.
//
// 검사:
//   ① 여러 시드에서 수입선수 100%가 contract.years === 1 && contract.remaining === 1
//   ② 국내 대조군은 1~3 분포 유지(과교정 아님 — 전부 1이면 FAIL)
//   ③ 파급 봉인: 수입선수는 remaining=1이 돼도 계약 만료 흐름에 안 샌다(willBeFA=false · recapBriefing.expiring/faSoon 0명)
//   ④ A/B 자가검증: 구로직(수입선수도 rng.int(1,3))을 재현한 뮤턴트 배열에서 ①이 반드시 FAIL — 오라클이 비어있지 않음 증명
//
//   npx tsx tools/_dv_seedforeign.ts   (exit 0=PASS / 1=FAIL)
import './_gt_mock';

const SEEDS = [12345, 777, 2024, 99991, 4242, 31337];

(async () => {
  const { generateLeague } = await import('../data/seed');
  const { createRng } = await import('../engine/rng');
  const { willBeFA } = await import('../engine/faMarket');
  const fails: string[] = [];

  /** 오라클 — 수입선수 전원이 1년 계약인가. 위반 목록 반환(빈 배열=통과). */
  const checkImports = (players: { id: string; isForeign?: boolean; contract: { years?: number; remaining: number } }[]): string[] =>
    players.filter((p) => p.isForeign)
      .filter((p) => p.contract.remaining !== 1 || p.contract.years !== 1)
      .map((p) => `${p.id}(${p.contract.years}년·잔여${p.contract.remaining})`);

  console.log('=== 시드 수입선수 계약 1년 고정 가드 ===');

  let totalImports = 0;
  const domDist: Record<number, number> = {};
  for (const seed of SEEDS) {
    const lg = generateLeague(seed);
    const imports = lg.players.filter((p) => p.isForeign);
    const dom = lg.players.filter((p) => !p.isForeign);
    totalImports += imports.length;
    for (const p of dom) domDist[p.contract.remaining] = (domDist[p.contract.remaining] ?? 0) + 1;

    // ① 수입선수 1년 고정
    const bad = checkImports(lg.players as never);
    if (bad.length) fails.push(`seed ${seed}: 수입선수 ${bad.length}명이 다년 계약 — ${bad.slice(0, 4).join(', ')}`);
    // 외인 OP·아시아쿼터가 실제로 존재해야 검사가 공허하지 않다
    const fgn = imports.filter((p) => !p.isAsianQuota).length;
    const asn = imports.filter((p) => p.isAsianQuota).length;
    if (fgn === 0 || asn === 0) fails.push(`seed ${seed}: 표본 공허(외인 ${fgn}·아시아 ${asn})`);
    console.log(`  seed ${seed}: 수입 ${imports.length}명(외인 ${fgn}·아시아 ${asn}) 전원 1년=${bad.length === 0}`);
  }

  // ② 국내 대조군 분포 유지(과교정 방지)
  const domKeys = Object.keys(domDist).map(Number).sort();
  const domOk = domKeys.length >= 3 && domKeys.every((k) => k >= 1 && k <= 3) && (domDist[2] ?? 0) > 0 && (domDist[3] ?? 0) > 0;
  if (!domOk) fails.push(`국내 계약 분포가 무너짐 ${JSON.stringify(domDist)} — 과교정(수입선수만 1년이어야)`);
  console.log(`  국내 대조군 remaining 분포 = ${JSON.stringify(domDist)} (2·3년 존재 필요)`);

  // ③ 파급 봉인 — remaining=1이어도 계약 만료 흐름(FA·만료 임박)에 수입선수가 새지 않는다
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, evolveOnDay } = await import('../data/league');
  const { rosterIdsOnDay } = await import('../data/dynamics');
  const { recapBriefing } = await import('../data/recapBriefing');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  G().resetSave(); G().selectTeam(my); G().setDay(0);
  const ros = rosterIdsOnDay(my, 0).map((id) => evolveOnDay(id, 0)).filter(Boolean) as never[];
  const myImports = (ros as { isForeign?: boolean; contract: { remaining: number } }[]).filter((p) => p.isForeign);
  const faLeak = myImports.filter((p) => willBeFA(p as never)).length;
  const br = recapBriefing(my, 0, {}, []);
  const brLeak = [...br.expiring, ...br.faSoon, ...br.retireSoon].filter((p) => p.isForeign).length;
  if (myImports.length === 0) fails.push('③ 표본 공허 — 내 팀 수입선수 0명');
  if (faLeak > 0) fails.push(`③ willBeFA(수입선수)=true ${faLeak}명 — 국내 FA 예정에 누수`);
  if (brLeak > 0) fails.push(`③ 결산 브리핑(만료/FA/정년)에 수입선수 ${brLeak}명 누수`);
  console.log(`  ③ 파급: 내 팀 수입 ${myImports.length}명 · willBeFA 누수 ${faLeak}(기대 0) · 결산 브리핑 누수 ${brLeak}(기대 0)`);

  // ④ A/B 자가검증 — 구로직(수입선수도 rng.int(1,3)) 재현 뮤턴트에서 오라클이 FAIL을 내야 한다
  const lg = generateLeague(SEEDS[0]);
  const mrng = createRng(SEEDS[0]);
  const mutant = lg.players.map((p) => {
    if (!p.isForeign) return p;
    const yearsAgo = mrng.int(0, 3);
    const rem = mrng.int(1, 3);
    return { ...p, contract: { ...p.contract, years: yearsAgo + rem, remaining: rem } };
  });
  const mutantBad = checkImports(mutant as never);
  const mutantMultiYear = (mutant as { isForeign?: boolean; contract: { remaining: number } }[])
    .filter((p) => p.isForeign && p.contract.remaining !== 1).length;
  const abOk = mutantBad.length > 0;
  if (!abOk) fails.push('④ A/B 실패 — 구로직 뮤턴트인데도 오라클이 통과(허위 오라클)');
  console.log(`  ④ A/B: 구로직 뮤턴트 다년 ${mutantMultiYear}명 → 오라클 검출 ${mutantBad.length}건(기대 >0) · 현행 검출 0건`);

  const pass = fails.length === 0;
  console.log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'} — 시드 ${SEEDS.length}개 · 수입선수 ${totalImports}명 전원 1년 계약${fails.length ? '\n  ' + fails.join('\n  ') : ''}`);
  if (!pass) process.exit(1);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
