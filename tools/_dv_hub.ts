// _dv_hub — 오프시즌 "완전 허브" IA 회귀 가드 (SEASON_SYSTEM §5.6 · UI_RULES UI-50)
//
// 봉인하는 사고: 2026-07-24 FA 센터 렌더 크래시(P0 a04c0bc)로 **오프시즌에서 영구히 빠져나갈 수 없는 소프트락**.
//   근본 원인은 크래시가 아니라 "전진 경로가 단일 사슬 = 우회로 0"이라는 구조. 이 가드는 그 구조가 되돌아오는 걸 막는다.
//
// 검사(A=정적 소스 · B=런타임 스토어):
//   A1 앞단 체인 push 잔재 0 (season-recap→tryout→asian→fa→draft 간선이 코드에 없다)
//   A2 앞단 화면 전부 + 라이브 드래프트에 일정 복귀 출구(useOffseasonExit) 존재
//   A3 오프시즌 라우트 전체 + 루트 레이아웃에 ErrorBoundary(폴백 = 일정으로 나가기 + diag 기록)
//   A4 일정 탭이 **두 위상** 허브를 그리고 최종 버튼이 조건부 게이트 없이 노출
//   A5 endSeason 진입점이 공용 훅 하나(showSeasonStartAd 직접 호출 0 · 모듈 레벨 래치)
//   B1 draftSelections 무효화 **대칭**(FA·재계약 + 외국인/아시아쿼터 레버까지 전부 clear)
//   B2 허브 목록(위상별 라우트·순서) = 정본
//   B3 offseasonUntouched(레버 부재 판정)가 실제 레버에 반응
//   B4 개막 경로 상시 도달(전지훈련 화면을 안 거쳐도 finishCamp로 개막 가능)
//   B5 앞단 최종 경로 도달(endSeason 1회 진행 · 더블탭 2전진 없음)
//   B6 성장 리포트 모달이 오프시즌 반복 포커스에서 재발화하지 않음(R-I)
//   B7 확정 픽 경고 게이트: 0건이면 조용히 통과, 1건 이상이면 즉시 실행 안 함
//
// A/B 자가검증(허위 오라클 금지): 구조를 되돌린 뮤턴트에서 반드시 FAIL 해야 한다 —
//   ① fa.tsx에 `router.push('/draft')` 복원 → A1 FAIL
//   ② store.toggleTryoutWish의 `draftSelections: []` 제거 → B1 FAIL
//   ③ fa.tsx의 ErrorBoundary export 제거 → A3 FAIL
//   ④ schedule.tsx 개막 버튼을 `campDone ? ... : null`로 게이트 → A4 FAIL
import './_gt_mock';
import Module from 'module';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// @expo/vector-icons 스텁 — B7이 components/draftPickGuard(→AppDialog)를 실제로 import해 **동작**을 검사하는데,
// 그 그래프가 아이콘 패키지의 .js(JSX 포함)를 끌어와 Node transform이 깨진다. _gt_mock의 react-native 스텁과 같은 패턴.
// (공유 파일 _gt_mock을 건드리지 않으려고 이 가드 안에서만 가로챈다.)
{
  const origReq = (Module.prototype as unknown as { require: (id: string) => unknown }).require;
  const stub: unknown = new Proxy(function () { /* noop */ } as unknown as object, {
    get: () => stub, apply: () => null, construct: () => ({}),
  });
  (Module.prototype as unknown as { require: (id: string) => unknown }).require = function (this: unknown, id: string) {
    if (id === '@expo/vector-icons' || id.startsWith('@expo/vector-icons/')) return stub;
    // eslint-disable-next-line prefer-rest-params
    return origReq.apply(this, arguments as never);
  };
}

const ROOT = join(__dirname, '..');
const read = (p: string): string => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : '');

let fails = 0;
const ok = (cond: boolean, tag: string, detail = '') => {
  if (!cond) { fails++; console.log(`  FAIL ${tag}${detail ? ' — ' + detail : ''}`); }
  return cond;
};

// 오프시즌 표면(라우트 파일 → ErrorBoundary 필수 목록)
const OFFSEASON_ROUTES = [
  'app/season-recap.tsx',
  'app/season-recap-detail/[section].tsx',
  'app/tryout.tsx',
  'app/asian-tryout.tsx',
  'app/fa.tsx',
  'app/draft.tsx',
  'app/draft-live.tsx',
  'app/enshrine.tsx',
  'app/training-camp.tsx',
];
// 앞단(pre-rollover) 결정 화면 — 일정 복귀 출구가 있어야 하고, 다음 단계로 push하면 안 된다.
const PRE_SCREENS = ['app/season-recap.tsx', 'app/tryout.tsx', 'app/asian-tryout.tsx', 'app/fa.tsx', 'app/draft.tsx', 'app/draft-live.tsx'];
// 해체 대상 체인 간선(파일 → 금지된 push 대상)
const CHAIN_EDGES: Array<[string, string]> = [
  ['app/season-recap.tsx', '/tryout'],
  ['app/tryout.tsx', '/asian-tryout'],
  ['app/asian-tryout.tsx', '/fa'],
  ['app/fa.tsx', '/draft'],
];

(async () => {
  console.log('=== _dv_hub — 오프시즌 허브 IA 회귀 가드 ===\n[A] 정적 구조');

  // A1 — 체인 push 잔재 0
  for (const [file, target] of CHAIN_EDGES) {
    const src = read(file);
    ok(src.length > 0, 'A1 소스 없음', file);
    const re = new RegExp(`router\\.(push|navigate|replace)\\(\\s*['"\`]${target}(['"\`?])`);
    ok(!re.test(src), 'A1 체인 push 잔재', `${file} → ${target} (허브에선 일정으로 복귀해야 한다)`);
  }

  // A2 — 일정 복귀 출구
  for (const f of PRE_SCREENS) {
    const src = read(f);
    ok(/useOffseasonExit\s*\(/.test(src), 'A2 출구 없음', `${f} (useOffseasonExit 미사용 — 소프트락 위험)`);
  }
  const exitSrc = read('components/offseasonExit.ts');
  ok(/dismissAll\(\)/.test(exitSrc) && /\/\(tabs\)\/schedule/.test(exitSrc), 'A2 출구 구현', 'dismissAll + 일정 탭 폴백');

  // A3 — ErrorBoundary
  for (const f of OFFSEASON_ROUTES) {
    const src = read(f);
    ok(/export\s*\{\s*ErrorBoundary\s*\}/.test(src), 'A3 ErrorBoundary 없음', f);
  }
  const layout = read('app/_layout.tsx');
  ok(/GlobalErrorBoundary/.test(layout), 'A3 루트 전역 경계 없음', 'app/_layout.tsx');
  const boundary = read('components/RouteErrorBoundary.tsx');
  ok(/\(tabs\)\/schedule/.test(boundary), 'A3 폴백 출구 없음', '폴백에서 일정으로 나갈 수 없다');
  ok(/diag\(/.test(boundary), 'A3 폴백 진단 로그 없음', '에러를 삼키면 안 된다(#44)');

  // A4 — 일정 탭 두 위상 + 게이트 없는 최종 버튼
  const sched = read('app/(tabs)/schedule.tsx');
  ok(/offseasonHubSteps\(\s*'pre'/.test(sched), 'A4 앞단 허브 미렌더');
  ok(/offseasonHubSteps\(\s*'post'/.test(sched), 'A4 뒷단 허브 미렌더');
  ok(/label=\{?\s*['"`]?개막전으로/.test(sched), 'A4 개막 버튼 없음');
  ok(/새 시즌 시작하기/.test(sched), 'A4 새 시즌 시작 버튼 없음');
  // 최종 버튼이 완료 조건으로 게이트되면 새 소프트락 — campDone/ceremony 조건부 렌더 금지
  ok(!/campDone\s*\?[^\n]*개막전으로/.test(sched), 'A4 개막 버튼 완료 게이트', 'campDone 조건부 렌더 금지(UI-50 ②)');
  ok(!/campDone\s*&&[^\n]*개막전으로/.test(sched), 'A4 개막 버튼 완료 게이트', 'campDone && 렌더 금지');

  // A5 — endSeason 진입점 공용화
  for (const f of ['app/draft.tsx', 'app/draft-live.tsx', 'app/(tabs)/schedule.tsx']) {
    const src = read(f);
    ok(!/showSeasonStartAd\s*\(/.test(src), 'A5 광고 직접 호출', `${f} (공용 훅 useSeasonStartEntry 경유해야 함)`);
  }
  const entry = read('lib/seasonStart.ts');
  ok(/^let\s+startingLatch/m.test(entry), 'A5 모듈 레벨 래치 없음', '화면 로컬 ref는 진입점 간 공유 안 됨');
  ok(/finally/.test(entry), 'A5 finally 해제 없음', 'UI-31');

  console.log('\n[B] 런타임 동작');
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, SEASON, currentRosters } = await import('../data/league');
  const { buildMatchBox } = await import('../data/matchBox');
  const { interventionsFor } = await import('../data/dynamics');
  const { planNextAction } = await import('../engine/advance');
  const { POSTSEASON_LAST_DAY } = await import('../engine/calendar');
  const { growthTrigger } = await import('../data/growthReport');
  const { offseasonHubSteps, offseasonUntouched } = await import('../data/offseasonHub');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;

  // B2 — 허브 목록 정본
  const pre = offseasonHubSteps('pre');
  const post = offseasonHubSteps('post', false);
  ok(pre.map((s) => s.route).join(',') === '/season-recap,/tryout,/asian-tryout,/fa,/draft',
    'B2 앞단 목록', pre.map((s) => s.route).join(','));
  ok(post.map((s) => s.route).join(',') === '/enshrine?hub=1,/training-camp', 'B2 뒷단 목록', post.map((s) => s.route).join(','));
  ok(pre.every((s, i) => s.n === i + 1) && post.every((s, i) => s.n === i + 1), 'B2 번호 연속');
  // 앞단은 완료 판정이 없어야 한다(전부 미리보기 — UI-50 ②)
  ok(pre.every((s) => s.done === undefined), 'B2 앞단 완료마커', '앞단엔 ✅/🔒 상태가 없어야 한다');
  ok(offseasonHubSteps('post', true).find((s) => s.key === 'camp')?.done === true, 'B2 전지훈련 완료 판정');

  // ── 세팅: 시즌 완주 → 앞단 오프시즌 ──
  G().resetSave(); G().selectTeam(my);
  for (const f of SEASON) {
    if ((f.homeTeamId === my || f.awayTeamId === my) && !G().results[f.id]) {
      const { sim } = buildMatchBox(f.homeTeamId, f.awayTeamId, f.dayIndex, f.seed, interventionsFor(f.id));
      G().recordResult({ fixtureId: f.id, homeSets: sim.homeSets, awaySets: sim.awaySets });
    }
  }
  G().setDay(POSTSEASON_LAST_DAY);
  ok(planNextAction(SEASON, my, G().results).kind === 'seasonOver', 'setup 앞단 진입');

  // B3 — offseasonUntouched
  ok(offseasonUntouched(G()) === true, 'B3 초기 untouched');
  const poolIds = Object.keys(currentRosters()).length ? [] : [];
  void poolIds;
  G().toggleTryoutWish('probe-p1');
  ok(offseasonUntouched(G()) === false, 'B3 레버 반응', '위시 하나로 touched 되어야 함');
  G().toggleTryoutWish('probe-p1'); // 원복

  // B1 — draftSelections 무효화 대칭
  const LEVERS: Array<[string, () => void]> = [
    ['setOffer', () => G().setOffer('probe-fa', { salary: 10000, years: 2, promises: {} } as never)],
    ['clearOffer', () => { G().setOffer('probe-fa2', { salary: 10000, years: 2, promises: {} } as never); G().setDraftSelections(['a', 'b']); G().clearOffer('probe-fa2'); }],
    ['signFA', () => G().signFA('probe-fa3')],
    ['unsignFA', () => { G().signFA('probe-fa4'); G().setDraftSelections(['a', 'b']); G().unsignFA('probe-fa4'); }],
    ['setAggressive', () => G().setAggressive(true)],
    ['toggleProtect', () => G().toggleProtect((currentRosters()[my] ?? [])[0] ?? 'probe-x')],
    ['toggleMoneyOnly', () => G().toggleMoneyOnly('probe-mo')],
    ['setResign', () => G().setResign('probe-rs', false)],
    ['setKeepForeign', () => G().setKeepForeign(true)],
    ['toggleTryoutWish', () => G().toggleTryoutWish('probe-tw')],
    ['setKeepAsian', () => G().setKeepAsian(true)],
    ['toggleAsianWish', () => G().toggleAsianWish('probe-aw')],
  ];
  for (const [name, run] of LEVERS) {
    G().setDraftSelections(['sel-1', 'sel-2']);
    run();
    ok(G().draftSelections.length === 0, 'B1 무효화 누락', `${name} 후 draftSelections=${G().draftSelections.length}건 (stale-pick)`);
  }

  // B6 — 성장 리포트 반복 포커스(앞단)
  const focus = () => {
    const s = G();
    const t = growthTrigger(SEASON, my, s.results, s.lastGrowthDay, s.currentDay);
    if (t.bumpTo != null) s.setLastGrowthDay(t.bumpTo);
    return t.show;
  };
  let shows = 0;
  for (let i = 0; i < 8; i++) if (focus()) shows++;
  ok(shows <= 1, 'B6 앞단 성장 모달 재발화', `${shows}회 (허브 반복 복귀에 재발화하면 안 됨)`);

  // B7 — 확정 픽 경고 게이트(판정은 순수 함수 needsDraftPickWarning, 배선은 정적으로 확인)
  const { needsDraftPickWarning } = await import('../data/offseasonHub');
  ok(needsDraftPickWarning([]) === false, 'B7 0건 조용히 통과', '확정 픽 0건인데 경고가 뜬다(소음)');
  ok(needsDraftPickWarning(['sel-1']) === true, 'B7 경고 없이 삭제', '확정 픽이 있는데 경고가 안 뜬다');
  const pickGuard = read('components/draftPickGuard.ts');
  ok(/needsDraftPickWarning\(/.test(pickGuard) && /onProceed\(\);\s*return;/.test(pickGuard),
    'B7 게이트 배선', 'draftPickGuard가 판정을 안 쓰거나 0건 즉시 통과가 없다');
  ok(/showAlert\(/.test(pickGuard), 'B7 확인 다이얼로그 없음', 'showAlert 재사용(새 Modal 금지 #129)');
  // 상류 레버 UI가 실제로 게이트를 통과하는지 — 무경고 삭제 재발 방지
  for (const f of ['app/fa.tsx', 'app/tryout.tsx', 'app/asian-tryout.tsx', 'app/contracts.tsx']) {
    ok(/confirmDraftPickReset\(/.test(read(f)), 'B7 레버 미보호', `${f} (경고 없이 확정 픽이 삭제된다)`);
  }

  // B5 — 앞단 최종 경로(endSeason) 도달 + 더블탭 2전진 없음
  const seasonBefore = G().season;
  G().endSeason();
  ok(G().season === seasonBefore + 1, 'B5 endSeason 진행', `season ${seasonBefore} → ${G().season}`);
  ok(G().currentDay === 0, 'B5 롤오버 후 day0', String(G().currentDay));
  const seasonAfter = G().season;
  G().endSeason(); // 더블탭
  ok(G().season === seasonAfter, 'B5 더블탭 2전진', `season ${seasonAfter} → ${G().season} (최종 방어선 = planNextAction 게이트)`);

  // B4 — 뒷단: 전지훈련 화면을 안 거쳐도 개막 도달
  ok(G().campDoneSeason !== G().season, 'B4 뒷단 초기 미완료');
  ok(planNextAction(SEASON, my, G().results).kind === 'match', 'B4 개막전 존재');
  G().finishCamp();
  ok(G().campDoneSeason === G().season, 'B4 캠프 화면 없이 개막 불가', 'finishCamp가 허브에서 직접 호출 가능해야 한다');
  ok(planNextAction(SEASON, my, G().results).kind === 'match', 'B4 개막 경로 도달');

  // B6b — 뒷단 반복 포커스
  shows = 0;
  for (let i = 0; i < 8; i++) if (focus()) shows++;
  ok(shows === 0, 'B6 뒷단 성장 모달', `${shows}회 (롤오버 직후 구간은 diff 대상 아님)`);

  console.log(`\n_dv_hub ${fails === 0 ? 'PASS' : 'FAIL'} — 위반 ${fails}건`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
