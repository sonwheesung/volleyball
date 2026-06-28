// 외국인 연고(hometown) 성향 가드 (EC-DOM-01, 2026-06-28)
//   버그: 외국인/아시아쿼터가 "연고 애착 / 고향 팀에서 뛰고 싶다"(국내 전용 성격) — V리그 연고 개념 없음.
//   근본: makePlayer→rollFAPref가 외국인에도 hometown 아키타입+preferredTeamId 부여.
//   수정: rollFAPref(isForeign) 게이트(생성) + discontentOf/effectiveArchetypeOf 외국인 게이트(기존 세이브 표시).
//   A/B: 국내는 hometown 도달가능(대조군>0)이어야 — 외국인 0인데 국내도 0이면 "그냥 hometown이 안 나오는 것"(허위 통과) 검출.
//   npx tsx tools/_dv_foreign_archetype.ts
import './_gt_mock';
(async () => {
  const { makePlayer } = await import('../data/seed');
  const { createRng } = await import('../engine/rng');
  const { discontentNow, effectiveArchetypeOf } = await import('../data/owner');
  const { LEAGUE, currentRosters, getPlayer } = await import('../data/league');
  const POS = ['S', 'OH', 'OP', 'MB', 'L'] as const;
  let pass = 0, fail = 0;
  const check = (n: string, ok: boolean, d = '') => { (ok ? pass++ : fail++); console.log(`  ${ok ? '✅' : '❌ FAIL'} ${n}${d ? ' — ' + d : ''}`); };

  // ── 1) 생성(rollFAPref via makePlayer): 외국인 hometown/preferredTeamId 0 · 국내 hometown 도달가능(대조군) ──
  const N = 1500;
  let fHome = 0, fPref = 0, dHome = 0;
  for (let i = 0; i < N; i++) {
    const fp = makePlayer(createRng(i + 1), `fgn-t${i}`, POS[i % 5], true);
    if (fp.faPref?.archetype === 'hometown') fHome++;
    if (fp.faPref?.preferredTeamId) fPref++;
    const dp = makePlayer(createRng(i + 9_000_001), `dom-t${i}`, POS[i % 5], false);
    if (dp.faPref?.archetype === 'hometown') dHome++;
  }
  console.log('═══ 생성(makePlayer/rollFAPref) ═══');
  check('외국인 hometown 아키타입 0', fHome === 0, `${fHome}/${N}`);
  check('외국인 preferredTeamId 0', fPref === 0, `${fPref}/${N}`);
  check('국내 hometown 도달가능(대조군>0 = 테스트 민감)', dHome > 0, `${dHome}/${N}`);

  // ── 2) 표시 게이트 effectiveArchetypeOf: 외국인 hometown→비연고 매핑 · 국내는 유지 ──
  console.log('\n═══ 표시 게이트(effectiveArchetypeOf) ═══');
  const legacyForeign = { isForeign: true, faPref: { archetype: 'hometown', w: { money: 0, win: 0, loyalty: 0, play: 0, home: 1, rel: 0 }, preferredTeamId: 't3' } } as any;
  const legacyDom = { isForeign: false, faPref: { archetype: 'hometown', w: { money: 0, win: 0, loyalty: 0, play: 0, home: 1, rel: 0 }, preferredTeamId: 't3' } } as any;
  check('외국인 legacy hometown → 비연고 표시', effectiveArchetypeOf(legacyForeign) !== 'hometown', `→ ${effectiveArchetypeOf(legacyForeign)}`);
  check('국내 hometown은 유지(대조군)', effectiveArchetypeOf(legacyDom) === 'hometown');

  // ── 3) discontent 게이트(기존 세이브): 실제 로스터 선수에 legacy hometown faPref 주입 → 외국인은 topic≠hometown, 국내는 가능(A/B) ──
  console.log('\n═══ discontent 게이트(discontentNow, legacy 주입) ═══');
  const myTeam = LEAGUE.teams[0].id;
  const otherTeam = LEAGUE.teams[1].id; // preferredTeamId ≠ myTeam 보장용
  const roster = currentRosters()[myTeam] ?? [];
  const baseP = roster.map((id) => getPlayer(id)).find((p) => !!p);
  if (!baseP) {
    check('로스터 기준선수 확보', false, '없음');
  } else {
    const inject = (isForeign: boolean) => ({ ...baseP, isForeign, faPref: { archetype: 'hometown', w: { money: 0.1, win: 0.1, loyalty: 0.1, play: 0.1, home: 0.5, rel: 0.1 }, preferredTeamId: otherTeam } });
    const fTopic = discontentNow(inject(true) as any, myTeam, 60).topic;
    const dTopic = discontentNow(inject(false) as any, myTeam, 60).topic;
    check('외국인 legacy → discontent topic ≠ hometown', fTopic !== 'hometown', `topic=${fTopic}`);
    check('국내 동일 입력 → hometown 가능(A/B 민감 = 게이트가 원인 증명)', dTopic === 'hometown', `topic=${dTopic}`);
  }

  console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — pass ${pass} / fail ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
})();
