// 전지훈련 아웃박스·campLog 재적용 상설 가드 (BACKEND §13.12 P0-4 · MONETIZATION §11.2).
//   발견·검증 = Fable 5 / 가드·문서 = Opus 에이전트 (2026-07-07).
//
// 왜 이 가드인가: 전지훈련 코어(spend↔로컬적용 아웃박스, campLog 시드 재적용, 게이트)는 로직은 건강하나
//   **상설 가드가 없었다**(DOC_DISCIPLINE — 배터리 등록돼야 완료). 이 파일은 **실제 store 액션**
//   (trainingCamp/reconcilePendingCamp/persist.rehydrate)을 구동하고 lib/server를 제어형 스텁으로 갈아끼워
//   ok/offline/dup 시나리오를 재현한다. 순수 로직(_dv_diamonds·_dv_walletauth)이 못 덮는 "store 왕복·아웃박스·재수화"를 봉인.
//
// A/B 자가검증(허위 오라클 차단): 시나리오 ④의 campTrained 게이트를 **무력화한 대조**(applyCampCourse 재호출)가
//   실제로 이중적용(+4/+14)을 만드는지 실측 → 오라클이 +2/+7만 통과시키는 이빨을 증명.
//
//   npx tsx tools/_dv_campoutbox.ts
import './_gt_mock';
import Module from 'module';
import type { CampCourse } from '../engine/diamonds';

// ── 제어형 lib/server 스텁 (spend/earn/getWallet만; login/setServerToken은 실 모듈 유지 → useAuthStore 정상) ──
type SpendRes = { ok: true; balance: number; applied: boolean } | { ok: false; reason: string };
const ctl: { spend: (a: number, r: string, k: string, ref?: string) => Promise<SpendRes> } = {
  spend: async () => ({ ok: false, reason: 'offline' }),
};
const spendCalls: Array<{ amount: number; reason: string; key: string; ref?: string }> = [];

const origReq = (Module.prototype as any).require;
(Module.prototype as any).require = function (id: string) {
  if (id === '../lib/server') {
    const real = origReq.apply(this, arguments as any); // 실 모듈(login·setServerToken·isServerConfigured 유지)
    return {
      ...real,
      spendDiamonds: async (amount: number, reason: string, key: string, ref?: string) => {
        spendCalls.push({ amount, reason, key, ref });
        return ctl.spend(amount, reason, key, ref);
      },
      earnDiamonds: async () => ({ ok: false, reason: 'offline' }),
      getWallet: async () => ({ ok: false, reason: 'offline' }),
    };
  }
  return origReq.apply(this, arguments as any);
};

(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { useAuthStore } = await import('../store/useAuthStore');
  const { LEAGUE, getPlayer, commitPlayerBase, currentRosters } = await import('../data/league');
  const { applyCampCourse, CAMP_COURSES } = await import('../engine/diamonds');
  const { SAVE_VERSION } = await import('../store/saveMigration');
  const { __asyncStorageMem } = await import('./_gt_mock');

  const G = () => useGameStore.getState();
  const COURSE: CampCourse = 'attack'; // stats: skSpike·jump·consistency
  const STATS = CAMP_COURSES[COURSE].stats;
  let fail = 0;
  const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

  const setAuthed = () => useAuthStore.setState({ session: { userId: 'u-camp', provider: 'dev', displayName: null, token: 't' } });
  const snap = (pid: string) => { const p: any = getPlayer(pid)!; return { cur: STATS.map((s) => p[s] as number), pot: STATS.map((s) => (p.potential[s] ?? 0) as number) }; };
  function eqAfter(pid: string, base: { cur: number[]; pot: number[] }, dCur: number, dPot: number): boolean {
    const now = snap(pid);
    return STATS.every((_, i) => now.cur[i] === Math.min(99, base.cur[i] + dCur) && now.pot[i] === Math.min(99, base.pot[i] + dPot));
  }

  // 리그 초기화 + 내 팀 선택(season 0, currentDay 0, playerBase null)
  const myId = LEAGUE.teams[0].id;
  G().selectTeam(myId);
  setAuthed();
  const myRoster = currentRosters()[myId];
  const seedId = myRoster[0];

  // ── ① 정상 전지훈련 (spend ok, applied true) ──
  console.log('── ① 정상: trainingCamp → spend ok(applied true) → 스탯+2/+7·campLog·campTrained·pending null·diamonds=서버잔액 ──');
  {
    useGameStore.setState({ diamonds: 5000, campLog: [], campTrainedThisOffseason: [], pendingCamp: null, currentDay: 0 });
    const base = snap(seedId);
    ctl.spend = async () => ({ ok: true, balance: 4700, applied: true });
    const before = spendCalls.length;
    const r = await G().trainingCamp(seedId, COURSE);
    ok(r.ok, 'trainingCamp ok');
    ok(spendCalls.length === before + 1 && spendCalls[before].reason === 'camp', 'spend 1회 호출(reason=camp)');
    ok(eqAfter(seedId, base, 2, 7), '스탯 현재+2·포텐+7 정확');
    ok(G().campLog.length === 1 && G().campLog[0].playerId === seedId && G().campLog[0].course === COURSE, 'campLog 엔트리 추가');
    ok(G().campTrainedThisOffseason.includes(seedId), 'campTrainedThisOffseason 추가');
    ok(G().pendingCamp === null, 'pendingCamp null(아웃박스 clear)');
    ok(G().diamonds === 4700, 'diamonds = 서버 확정 잔액(4700)');
  }

  // ── ② 아웃박스 크래시 복구 (pending만 남음, 적용 전 크래시) → reconcile → spend dup(applied false) ──
  console.log('── ② 아웃박스 복구: pendingCamp만 존재(미적용) → reconcile → spend dup(applied false) → 스탯 적용·이중과금 없음·pending clear ──');
  {
    const p2 = myRoster[1];
    const base = snap(p2);
    const key = `camp:u-camp:sid:0:${p2}`;
    // 적용 전 크래시 모사: pending만, campTrained 미포함, 스탯 미변경, diamonds는 이미 차감된 서버잔액과 무관한 표시 캐시(999)
    useGameStore.setState({ diamonds: 999, campLog: [], campTrainedThisOffseason: [], pendingCamp: { key, playerId: p2, course: COURSE, season: 0 } as any });
    ctl.spend = async () => ({ ok: true, balance: 700, applied: false }); // dup = 서버가 이미 과금함(재차감 없음)
    const before = spendCalls.length;
    await G().reconcilePendingCamp();
    ok(spendCalls.length === before + 1 && spendCalls[before].key === key, 'reconcile이 같은 멱등키로 spend 재호출(dup)');
    ok(eqAfter(p2, base, 2, 7), '스탯 현재+2·포텐+7 적용(applied false여도 로컬 적용)');
    ok(G().diamonds === 700, '이중과금 없음: diamonds=서버 잔액(700) — 로컬 재차감 안 함');
    ok(G().campTrainedThisOffseason.includes(p2), 'campTrained 추가');
    ok(G().pendingCamp === null, 'pending clear');
  }

  // ── ③ 오프라인 reconcile: spend offline → pending 유지·스탯 미적용 ──
  console.log('── ③ 오프라인 reconcile: spend {ok:false, offline} → pending 유지·스탯 미적용 ──');
  {
    const p3 = myRoster[2];
    const base = snap(p3);
    const key = `camp:u-camp:sid:0:${p3}`;
    useGameStore.setState({ diamonds: 800, campTrainedThisOffseason: [], pendingCamp: { key, playerId: p3, course: COURSE, season: 0 } as any });
    ctl.spend = async () => ({ ok: false, reason: 'offline' });
    await G().reconcilePendingCamp();
    ok(G().pendingCamp !== null && (G().pendingCamp as any).key === key, 'pendingCamp 유지(다음 기회 재시도)');
    ok(eqAfter(p3, base, 0, 0), '스탯 미적용(Δ0)');
    ok(G().diamonds === 800, '캐시 불변(차감 안 됨)');
    ok(!G().campTrainedThisOffseason.includes(p3), 'campTrained 미추가');
  }

  // ── ④ 이미 적용됨(clear 전 크래시): campTrained에 있으면 reconcile은 pending만 clear(스탯 재적용 없음) ──
  console.log('── ④ 이미 적용됨: campTrained 포함 → reconcile은 spend 미호출·pending만 clear(이중적용 없음) ──');
  {
    const p4 = myRoster[3];
    // 이미 1회 적용된 상태(스탯 +2/+7, campTrained 포함) + pending 잔존(clear 전 크래시)
    const base = snap(p4);
    const camped = applyCampCourse(getPlayer(p4)!, COURSE);
    commitPlayerBase({ [p4]: camped });
    const key = `camp:u-camp:sid:0:${p4}`;
    useGameStore.setState({ campTrainedThisOffseason: [p4], pendingCamp: { key, playerId: p4, course: COURSE, season: 0 } as any });
    const appliedOnce = snap(p4); // +2/+7 기준
    ok(appliedOnce.cur[0] === Math.min(99, base.cur[0] + 2), '사전조건: 이미 +2 적용됨');
    const before = spendCalls.length;
    await G().reconcilePendingCamp();
    ok(spendCalls.length === before, 'reconcile이 spend를 호출하지 않음(재과금 없음)');
    ok(eqAfter(p4, base, 2, 7), '스탯 여전히 +2/+7(이중적용 아님 — +4/+14 아님)');
    ok(G().pendingCamp === null, 'pending만 clear');

    // A/B 자가검증: campTrained 게이트를 무력화하면(=applyCampCourse 재호출) 이중적용(+4/+14)이 실제로 생기는가
    const doubled = applyCampCourse(getPlayer(p4)!, COURSE); // 게이트 없는 가상 재적용
    const dblCurOk = STATS.every((s, i) => (doubled as any)[s] === Math.min(99, base.cur[i] + 4));
    const dblPotOk = STATS.every((s, i) => doubled.potential[s] === Math.min(99, base.pot[i] + 14));
    ok(dblCurOk && dblPotOk, 'A/B: 게이트 무력화 대조는 +4/+14(이중적용)를 만든다 → 오라클 민감도 증명');
  }

  // ── ⑤ campLog 시드 재적용 (실제 onRehydrateStorage 경로: persist.rehydrate) ──
  console.log('── ⑤ campLog 시드 재적용: 시즌0(base null) 재수화 → 시드에 +2/+7(1회) · playerBase 있으면 재적용 안 함 ──');
  {
    // (A) 시즌0(playerBase null) + campLog 엔트리 → 재수화 시 시드 레지스트리에 재적용
    const p5 = myRoster[4];
    // 레지스트리를 baseline으로 되돌려(이전 시나리오 오염 방지) 스냅
    // (선택 팀 재선택으로 리그 시드 초기화)
    G().selectTeam(myId);
    setAuthed();
    const base = snap(p5);
    useGameStore.setState({ playerBase: null, campLog: [{ season: 0, playerId: p5, course: COURSE } as any], campTrainedThisOffseason: [] });
    // persist가 저장하는 것과 동일한 블롭을 구성 → 재수화가 실제 onRehydrateStorage(1183-1191)를 탄다
    const opts = useGameStore.persist.getOptions();
    const persisted = { state: (opts.partialize as any)(G()), version: SAVE_VERSION };
    __asyncStorageMem.set('baeknyeon-save', JSON.stringify(persisted));
    await useGameStore.persist.rehydrate();
    ok(eqAfter(p5, base, 2, 7), '(A) base null: 재수화가 시드에 +2/+7 재적용(정확히 1회)');

    // (B) 시즌≥1(playerBase 존재 = 이미 구운 base) → else-if 스킵, 재적용 안 함(이중적용 차단)
    // base 기준 "1회 적용" 선수 객체를 playerBase에 넣고 재수화 → 재적용되면 +4/+14가 되어야(=버그), 스킵이면 +2/+7
    G().selectTeam(myId); // 레지스트리 baseline 복원
    setAuthed();
    const base2 = snap(p5);
    const oneShot = applyCampCourse(getPlayer(p5)!, COURSE); // base2 + 2/+7
    useGameStore.setState({ playerBase: { [p5]: oneShot } as any, campLog: [{ season: 1, playerId: p5, course: COURSE } as any], campTrainedThisOffseason: [] });
    const opts2 = useGameStore.persist.getOptions();
    const persisted2 = { state: (opts2.partialize as any)(G()), version: SAVE_VERSION };
    __asyncStorageMem.set('baeknyeon-save', JSON.stringify(persisted2));
    await useGameStore.persist.rehydrate();
    ok(eqAfter(p5, base2, 2, 7), '(B) base 존재: base 로드만·campLog 재적용 스킵 → +2/+7(1회, +4/+14 아님)');
  }

  // ── ⑥ 게이트: not-mine · maxed · not-offseason · already ──
  console.log('── ⑥ 게이트: not-mine · maxed · not-offseason · already 각 거부(spend 미호출) ──');
  {
    G().selectTeam(myId);
    setAuthed();
    const roster = currentRosters()[myId];
    const mine = roster[0];

    // not-mine: 타 팀 선수
    const otherId = currentRosters()[LEAGUE.teams[1].id][0];
    useGameStore.setState({ currentDay: 0, campTrainedThisOffseason: [], pendingCamp: null });
    let before = spendCalls.length;
    let r = await G().trainingCamp(otherId, COURSE);
    ok(!r.ok && r.reason === 'not-mine', 'not-mine 거부');
    ok(spendCalls.length === before, '  → spend 미호출');

    // maxed: 3 코스 스탯 현재·포텐 전부 99
    const maxed: any = { ...getPlayer(mine)!, potential: { ...getPlayer(mine)!.potential } };
    for (const s of STATS) { maxed[s] = 99; maxed.potential[s] = 99; }
    commitPlayerBase({ [mine]: maxed });
    before = spendCalls.length;
    r = await G().trainingCamp(mine, COURSE);
    ok(!r.ok && r.reason === 'maxed', 'maxed 거부');
    ok(spendCalls.length === before, '  → spend 미호출');
    G().selectTeam(myId); setAuthed(); // 복원

    // not-offseason: currentDay > 0
    const mine2 = currentRosters()[myId][0];
    useGameStore.setState({ currentDay: 5 });
    before = spendCalls.length;
    r = await G().trainingCamp(mine2, COURSE);
    ok(!r.ok && r.reason === 'not-offseason', 'not-offseason 거부');
    ok(spendCalls.length === before, '  → spend 미호출');

    // already: campTrainedThisOffseason 포함
    useGameStore.setState({ currentDay: 0, campTrainedThisOffseason: [mine2] });
    before = spendCalls.length;
    r = await G().trainingCamp(mine2, COURSE);
    ok(!r.ok && r.reason === 'already', 'already 거부');
    ok(spendCalls.length === before, '  → spend 미호출');
  }

  console.log(fail === 0 ? '\n✅ CAMPOUTBOX PASS (아웃박스·campLog 재적용·게이트 봉인)' : `\n❌ CAMPOUTBOX FAIL ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
})();
