// 마이페이지 탭 **빨간 점**(미수령 업적) 배선 가드 — ACHIEVEMENT §입력 배선 (2026-08-08 운영 버그).
//
// 무엇을 봉인하나: `_gt_achmid`는 **함수**(achTotals)만 봉인했고 **배선**(어느 화면이 그 함수를 쓰나)은 안 봤다.
//   그 사각으로, 나중에 추가된 탭 빨간 점(`app/(tabs)/_layout.tsx`)이 스토어 raw `careerTotals`를 그대로 먹여
//   **시즌 하나 통째로 0** → 첫 시즌 내내 점이 안 켜졌다(통산 업적이 열리는 건 첫 시즌뿐 = 신규 유저 디스커버리 0).
//   실측: 1경기 시점 탭 0 / 카드 6. 운영 유저가 수동으로 업적 화면에 들어가 6건 60💎을 뒤늦게 수령.
//   → 이 가드는 **실제 스토어를 구동**해 탭 계산(하한)과 카드 계산(정확)을 같이 뽑아 계약을 단언한다(재구현 오라클 금지).
//
// 계약
//   C1 거짓양성 금지 : 모든 n에 대해 tabIds ⊆ cardIds (없는 점이 켜지면 "눌러도 못 받는 점")
//   C2 실피해 봉인 ★ : n ≥ 1 ⇒ tabIds.length ≥ 1   ← 이 한 줄이 이번 버그를 잡았을 것
//   C3 오프시즌 일치 : results = {} ⇒ tabIds === cardIds (하한==정확, 진행분 0)
//   C4 고아키 내성   : results 에 없는 fixtureId 주입 → 하한 totals 불변 + C1 유지
//   C5 claimed 정합  : claimedAch 에 전부 넣으면 tabIds = [] (+ resetSave 후 재시작 유저도 claimed 점 안 뜸)
//   C6 캐시 신선도   : 정확값 캐시(noteAchTotals) 기록 직후엔 tabIds == cardIds · 경기 1개 더 진행하면 stale → 하한 폴백(C1 유지)
//   C7 배선 정적강제 : 5개 호출부가 전부 셀렉터(data/achSelect) 경유 · 탭은 'floor' + 캐시 인자 · 탭에서 achTotals 직접 호출 0
//
// A/B 자가검증(허위 오라클 금지)
//   --mutant : 탭 입력을 **구 배선(raw careerTotals)** 으로 되돌려 계산 → C2가 FAIL 로 뒤집히는지 증명(비공허 오라클).
//   민감도   : careerTotals.points 0 vs 1 → 미수령 개수가 실제로 변함(측정이 입력에 반응).
//   반증     : 오프시즌(0경기)에선 하한==정확 → 아무 데서나 FAIL 내지 않음.
//
// Usage: npx tsx tools/_gt_achdot.ts            ; echo $?
//        npx tsx tools/_gt_achdot.ts --mutant   ; echo $?   (A/B — C2 뒤집힘 증명, exit 0 = 증명 성공)
import './_gt_mock';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const MUTANT = process.argv.includes('--mutant');

(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, SEASON } = await import('../data/league');
  const { buildMatchBox } = await import('../data/matchBox');
  const { achEvalFor, unclaimedAchIds, resultsOnlyTotals } = await import('../data/achSelect');
  const { evalAchievements } = await import('../engine/achievements');
  const { unclaimedReward } = await import('../engine/diamonds');

  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  G().selectTeam(my);

  let fail = 0;
  const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };
  const subset = (a: string[], b: string[]) => { const s = new Set(b); return a.filter((x) => !s.has(x)); };
  const sameSet = (a: string[], b: string[]) => a.length === b.length && subset(a, b).length === 0;

  /** 탭이 계산하는 미수령 id — 하한(시뮬 0) + 신선한 정확값 캐시. --mutant 면 **구 배선**(raw careerTotals)으로. */
  const tabIds = (): string[] => {
    const s = G();
    if (MUTANT) {
      // 구 배선 재현: 스토어 raw careerTotals 를 그대로 evalAchievements 에 먹임(= 2026-08-08 이전 _layout.tsx).
      const st = evalAchievements({ myTeamId: s.selectedTeamId ?? '', archive: s.archive, hof: s.hallOfFame, milestones: s.milestones, cash: s.cash, fanScore: s.fanScore, careerLog: s.careerLog, careerTotals: s.careerTotals });
      return unclaimedReward(st, s.claimedAch).ids;
    }
    return unclaimedAchIds(s, 'floor', s.achTotalsCache);
  };
  /** 업적 화면·수령 경로가 계산하는 미수령 id(정확값). */
  const cardIds = (): string[] => unclaimedAchIds(G(), 'exact');

  const myFix = SEASON.filter((f) => f.homeTeamId === my || f.awayTeamId === my).sort((a, b) => a.dayIndex - b.dayIndex);
  const playOne = (i: number) => {
    const f = myFix[i];
    const { sim } = buildMatchBox(f.homeTeamId, f.awayTeamId, f.dayIndex, f.seed);
    G().recordResult({ fixtureId: f.id, homeSets: sim.homeSets, awaySets: sim.awaySets });
    G().setDay(f.dayIndex);
  };

  console.log(`═══ 탭 빨간 점(미수령 업적) 배선 가드 ${MUTANT ? '[MUTANT: 구 raw 배선]' : ''} ═══`);

  // ── C1·C2: 경기를 하나씩 늘리며 ──
  console.log('\n── C1 거짓양성 금지 · C2 실피해 봉인(n≥1 ⇒ 점 켜짐) ──');
  const N = 6;
  let c1bad = 0, c2bad = 0;
  const trace: string[] = [];
  for (let n = 1; n <= N; n++) {
    playOne(n - 1);
    const t = tabIds(), c = cardIds();
    trace.push(`n=${n}: tab=${t.length} card=${c.length}`);
    const extra = subset(t, c);
    if (extra.length) { c1bad++; console.error(`  ✗ n=${n} 탭에만 있는 업적(거짓양성): ${extra.join(',')}`); }
    if (t.length < 1) { c2bad++; console.error(`  ✗ n=${n} 경기를 ${n}개 치렀는데 탭 미수령 0 (card=${c.length}: ${c.slice(0, 8).join(',')})`); }
  }
  console.log('  ' + trace.join(' | '));
  ok(c1bad === 0, `C1: 전 n(1..${N}) tabIds ⊆ cardIds — 거짓양성 0`);
  ok(c2bad === 0, `C2: 전 n(1..${N}) tabIds ≥ 1 — 첫 경기부터 점이 켜짐`);
  {
    const t = tabIds();
    const must = ['first_set_win', 'first_set_loss', 'first_concede'];
    const covered = must.filter((id) => t.includes(id) || G().claimedAch.includes(id));
    ok(covered.length === must.length, `C2b: 하한이 커버해야 할 통산 업적 포함(${covered.join('·')})`);
    ok(t.includes('first_match_win') || t.includes('first_match_loss'), 'C2c: 첫 승 또는 첫 패가 하한으로 잡힘');
  }

  // ── 민감도 A/B: careerTotals.points 0 vs 1 이 미수령 개수를 실제로 움직이나 ──
  console.log('\n── A/B 민감도: careerTotals.points 0 → 1 이면 first_point 가 하한에서도 열림 ──');
  {
    const base = tabIds();
    const saved = G().careerTotals;
    useGameStore.setState({ careerTotals: { ...saved, points: 1 } });
    const bumped = tabIds();
    useGameStore.setState({ careerTotals: saved });
    const restored = tabIds();
    ok(!base.includes('first_point') && bumped.includes('first_point'), `민감도: points 0(미포함) → 1(포함) 으로 변동 (${base.length} → ${bumped.length})`);
    ok(sameSet(base, restored), '민감도 복원: 원복 후 동일(측정 부작용 없음)');
  }

  // ── C4 고아키 내성 ──
  console.log('\n── C4 고아 fixtureId 내성(시즌 롤오버 잔존 키) ──');
  {
    const before = resultsOnlyTotals(my, G().results);
    const beforeTab = tabIds();
    useGameStore.setState({ results: { ...G().results, __orphan_zzz__: { fixtureId: '__orphan_zzz__', homeSets: 3, awaySets: 0 } } });
    const after = resultsOnlyTotals(my, G().results);
    const afterTab = tabIds();
    ok(JSON.stringify(before) === JSON.stringify(after), `C4a: 고아키 주입해도 하한 totals 불변 (${JSON.stringify(after)})`);
    ok(subset(afterTab, cardIds()).length === 0, 'C4b: 고아키 주입 후에도 tabIds ⊆ cardIds');
    ok(sameSet(beforeTab, afterTab), 'C4c: 고아키가 점 판정을 바꾸지 않음');
    const { __orphan_zzz__: _drop, ...clean } = G().results as Record<string, { fixtureId: string; homeSets: number; awaySets: number }>;
    useGameStore.setState({ results: clean });
  }

  // ── C6 정확값 캐시 신선도 ──
  console.log('\n── C6 정확값 기회주의 캐시(신선하면 정확값 · stale 이면 하한 폴백) ──');
  {
    const ev = achEvalFor(G(), 'exact');
    G().noteAchTotals(ev.key, ev.totals);   // 마이페이지·업적 화면이 하는 일
    const t = tabIds(), c = cardIds();
    if (MUTANT) console.log(`  – C6a 생략(구 배선은 캐시를 안 읽음): tab=${t.length} card=${c.length}`);
    else ok(sameSet(t, c), `C6a: 캐시 신선 → tabIds == cardIds (${t.length}==${c.length})`);
    playOne(N); // cutoff 전진 → 캐시 stale
    const t2 = tabIds(), c2 = cardIds();
    ok(subset(t2, c2).length === 0, `C6b: stale 캐시 → 하한 폴백, 여전히 tabIds ⊆ cardIds (${t2.length}⊆${c2.length})`);
    ok(t2.length >= 1, 'C6c: stale 폴백에서도 점은 켜져 있음(실피해 없음)');
  }

  // ── C5 claimed 정합 ──
  console.log('\n── C5 claimedAch 정합(눌러도 못 받는 점 금지) ──');
  {
    const all = cardIds();
    const prevClaimed = G().claimedAch;
    useGameStore.setState({ claimedAch: [...prevClaimed, ...all] });
    ok(tabIds().length === 0, `C5a: 미수령 전부 claimed 처리 → tabIds = [] (claimed ${all.length}건)`);
    // 재시작 유저: resetSave 는 claimedAch 보존 · careerTotals/results 리셋 → 통산 점이 안 뜨는 게 정상(계정 평생 1회)
    G().resetSave();
    useGameStore.setState({ selectedTeamId: my });
    const t = tabIds();
    ok(subset(t, G().claimedAch).length === t.length || t.every((id) => !G().claimedAch.includes(id)),
      'C5b: resetSave(claimedAch 보존) 후 이미 받은 업적은 점으로 안 뜸');
    ok(subset(t, cardIds()).length === 0, 'C5c: resetSave 후에도 tabIds ⊆ cardIds');
  }

  // ── C3 오프시즌 일치(반증 실험 — 아무 데서나 FAIL 내지 않음) ──
  console.log('\n── C3 오프시즌(results={}) 하한 == 정확 [반증 실험] ──');
  {
    G().selectTeam(my);
    for (let i = 0; i < myFix.length; i++) if (!G().results[myFix[i].id]) playOne(i);
    G().setDay(164);
    G().endSeason();
    const s = G();
    ok(Object.keys(s.results).length === 0 && s.careerTotals.matchWins + s.careerTotals.matchLosses > 0,
      `C3a: 시즌 롤오버 — results 비었고 stored 누적됨(${s.careerTotals.matchWins}승 ${s.careerTotals.matchLosses}패)`);
    const t = tabIds(), c = cardIds();
    ok(sameSet(t, c), `C3b: 오프시즌 tabIds == cardIds (${t.length}==${c.length}) — 하한이 정확값과 동일(반증: 아무 데서나 FAIL 안 냄)`);
  }

  // ── C7 배선 정적 강제(reported-but-unwired · 기법 F) ──
  console.log('\n── C7 배선 정적 강제(5개 호출부 전부 셀렉터 경유) ──');
  {
    // 주석 제거 후 검사 — 설계 근거를 적은 주석에 `evalAchievements`/`achTotals(` 문자열이 들어가도 오탐 안 나게(_dv_arch 동형).
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const read = (rel: string) => strip(readFileSync(join(ROOT, rel), 'utf8'));
    const tabSrc = read('app/(tabs)/_layout.tsx');
    const mySrc = read('app/(tabs)/mypage.tsx');
    const achSrc = read('app/achievements.tsx');
    const storeSrc = read('store/useGameStore.ts');
    ok(/from '\.\.\/\.\.\/data\/achSelect'/.test(tabSrc), 'C7a: 탭이 data/achSelect 셀렉터 import');
    ok(/'floor'/.test(tabSrc) && /achTotalsCache/.test(tabSrc), "C7b: 탭이 'floor' 모드 + 정확값 캐시를 넘김");
    ok(!/\bachTotals\s*\(/.test(tabSrc) && !/\bevalAchievements\b/.test(tabSrc), 'C7c: 탭이 achTotals/evalAchievements 직접 호출 0(앱 루트 동기 프리즈 금지)');
    ok(/achEvalFor\(/.test(mySrc) && /'exact'/.test(mySrc) && !/\bevalAchievements\b/.test(mySrc), 'C7d: 마이페이지가 셀렉터 exact 경유');
    ok(/achEvalFor\(/.test(achSrc) && /'exact'/.test(achSrc) && !/\bevalAchievements\b/.test(achSrc), 'C7e: 업적 화면이 셀렉터 exact 경유');
    const storeCalls = (storeSrc.match(/achEvalFor\(/g) ?? []).length;
    ok(storeCalls >= 2 && !/\bevalAchievements\(/.test(storeSrc), `C7f: 스토어 2곳(수령·구세이브 claim 시드) 셀렉터 경유 · evalAchievements 직접 호출 0 (achEvalFor ${storeCalls}회)`);
    ok(/noteAchTotals\(/.test(mySrc) && /noteAchTotals\(/.test(achSrc), 'C7g: 화면이 정확값 캐시를 기록(탭이 재활용할 소스)');
  }

  if (MUTANT) {
    // A/B: 구 raw 배선이면 C2(그리고 C6a)가 반드시 깨져야 한다 — 안 깨지면 이 가드가 비어 있다는 뜻.
    const proved = c2bad > 0;
    console.log(`\n${proved ? `✅ MUTANT A/B 증명 — 구 raw 배선에서 C2 FAIL ${c2bad}건(=이 가드가 2026-08-08 버그를 잡는다)` : '❌ MUTANT A/B 실패 — 구 배선인데도 C2 통과(가드가 비어 있음/허위 오라클)'}`);
    process.exit(proved ? 0 : 1);
  }

  console.log(fail === 0
    ? '\n✅ ACH_DOT PASS — 거짓양성0 · 첫 경기부터 점 켜짐 · 오프시즌 일치 · 고아키 내성 · claimed 정합 · 캐시 신선도 · 배선 정적강제'
    : `\n❌ ACH_DOT FAIL (${fail})`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
