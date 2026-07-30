// 가드 — campLog 롤링 프룬(무한증가 봉인, MONETIZATION §11.2, 2026-07-27).
//   npx tsx tools/_dv_campprune.ts [시즌=18]
// (P1) 실 store: 다수 시즌 진행 + 선수 은퇴 → endSeason 프룬이 campLog를 리그 잔류 선수로 유계 수렴시키고
//      은퇴/이탈 선수 엔트리를 제거하는지 검증. A/B: 프룬 없는 누적(everInjected)은 시즌수에 비례 무한증가.
// (P2) 유닛: careerGrowthOf(선수별 전 시즌 cur-gain 누적 차감)가 프룬 후에도 정확 — slice cap이면 오답(A/B).
import './_gt_mock';
import { CAMP_COURSES, CAMP_CUR_GAIN, CAMP_POT_GAIN } from '../engine/diamonds';

const fails: string[] = [];
const fail = (m: string) => fails.push(m);
const log = (m: string) => process.stdout.write(m + '\n');

(async () => {
  // ─────────────────────────── (P1) 실 store 프룬 ───────────────────────────
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, SEASON, currentRosters } = await import('../data/league');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const N = Math.max(6, Number(process.argv[2]) || 18);
  const myFix = SEASON.filter((f: any) => f.homeTeamId === my || f.awayTeamId === my);

  G().resetSave();
  G().selectTeam(my);

  const everInjected: { season: number; playerId: string }[] = []; // 프룬 없는 A/B 기준(단조 누적)
  const injectSnapshots: number[] = [];

  for (let s = 0; s < N; s++) {
    // day0(오프시즌 개막): 내 팀 로스터 앞 6명에 전지훈련 엔트리 주입(trainingCamp 서버경로 우회 — 프룬 자체를 검증)
    const roster = (currentRosters()[my] ?? []).slice(0, 6);
    const season = G().season;
    const course = 'attack' as const;
    useGameStore.setState((st: any) => ({
      campLog: [...st.campLog, ...roster.map((playerId: string) => ({ season, playerId, course, cur: CAMP_CUR_GAIN, pot: CAMP_POT_GAIN }))],
    }));
    for (const playerId of roster) everInjected.push({ season, playerId });
    injectSnapshots.push(everInjected.length);
    // 시즌 진행 후 종료(→ endSeason 프룬 발동)
    for (const f of myFix) G().recordResult({ fixtureId: f.id, homeSets: 3, awaySets: 1 } as any);
    G().setDay(164);
    G().endSeason();
  }

  const pruned = G().campLog;
  const base = G().playerBase ?? {};
  const liveIds = new Set(Object.keys(base));
  const injectedIds = new Set(everInjected.map((e) => e.playerId));

  // (a) BOUNDED — 프룬된 모든 엔트리는 현재 playerBase(리그 잔류) 소속
  const orphan = pruned.filter((e: any) => !liveIds.has(e.playerId));
  if (orphan.length) fail(`(P1a) 프룬 후 고아 엔트리 ${orphan.length}건(playerBase에 없는 선수) — BOUNDED 위반`);

  // (b) A/B 민감도 — 주입됐으나 은퇴/이탈로 base에서 사라진 선수: 프룬은 반드시 그 엔트리를 0으로 제거
  const departed = [...injectedIds].filter((id) => !liveIds.has(id));
  const departedStillInLog = departed.filter((id) => pruned.some((e: any) => e.playerId === id));
  if (departed.length === 0) fail('(P1b) N시즌 동안 은퇴/이탈 선수 0 — A/B 민감도 확보 실패(시즌 수 부족?)');
  if (departedStillInLog.length) fail(`(P1b) 이탈 선수 ${departedStillInLog.length}명 엔트리가 프룬 후에도 잔존 — 프룬 미작동`);

  // (c) 무한증가 vs 유계 — 프룬 없음(everInjected)은 시즌비례 증가, 프룬은 리그 잔류로 유계
  if (!(everInjected.length > pruned.length)) fail(`(P1c) everInjected(${everInjected.length}) ≤ pruned(${pruned.length}) — 프룬이 아무것도 줄이지 못함`);
  const prunedDistinct = new Set(pruned.map((e: any) => e.playerId)).size;
  if (prunedDistinct > liveIds.size) fail(`(P1c) 프룬 distinct 선수(${prunedDistinct}) > 리그 base(${liveIds.size}) — 유계 위반`);

  // (P2 제거, 2026-07-30) careerGrowthOf가 campLog를 안 받게 반전(전지훈련 포함=총 성장) → 프룬-성장 결합 검증 무의미.
  //   careerGrowthOf "전지훈련 포함" 자체는 `_dv_growthcamp.ts`(실 선수 캠프 적용 A/B)가 검증. campLog 프룬(P1)은
  //   여전히 시즌0 시드 재적용·저장 크기용이라 유효.

  log('=== _dv_campprune: campLog 롤링 프룬(무한증가 봉인) ===');
  log(`(P1) ${N}시즌 · 주입(프룬없음 기준) ${everInjected.length}건 → 프룬 후 ${pruned.length}건 (distinct ${prunedDistinct} ≤ 리그 ${liveIds.size})`);
  log(`     은퇴/이탈 선수 ${departed.length}명 · 이들 엔트리 프룬 후 잔존 ${departedStillInLog.length}건(0이어야) · 고아 ${orphan.length}건(0이어야)`);
  log(`     A/B 무한증가: 프룬없음 ${everInjected.length} ≫ 프룬 ${pruned.length}  [${(everInjected.length - pruned.length)}건 제거]`);

  const pass = fails.length === 0;
  log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}${fails.length ? '\n  - ' + fails.join('\n  - ') : ''}`);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
