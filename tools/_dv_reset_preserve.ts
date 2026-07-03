// 구단 초기화 계정 필드 유지 가드 (BACKEND §13.19) — selectTeam/resetSave가 다이아·업적수령·광고상태를
// **유지**하고 saveId만 새로 발급하는지. 회귀(누가 ...freshSave로 되돌려 재화 날림) 차단. A/B는 값 대조.
import './_gt_mock';

(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE } = await import('../data/league');
  const G = () => useGameStore.getState();
  let fail = 0;
  const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

  console.log('── selectTeam(구단 재선택): 계정 재화 유지 · saveId 새로 · 진행 리셋 ──');
  G().selectTeam(LEAGUE.teams[0].id);
  useGameStore.setState({ diamonds: 777, claimedAch: ['first-title', 'x'], adState: { dayIdx: 5, count: 3, lastAdAt: 12345 }, season: 9 });
  const sid1 = G().saveId;
  G().selectTeam(LEAGUE.teams[1].id);
  ok(G().diamonds === 777, '다이아 유지(777)');
  ok(JSON.stringify(G().claimedAch) === JSON.stringify(['first-title', 'x']), '업적수령(claimedAch) 유지');
  ok(G().adState.count === 3 && G().adState.lastAdAt === 12345, '광고 상태(쿨다운/횟수) 유지');
  ok(G().season === 0, '시즌 진행은 리셋(0)');
  ok(G().saveId !== sid1 && G().saveId !== '', 'saveId 새로 발급(camp 재과금 정당·무료강화 차단)');

  console.log('── resetSave(전체 초기화): 동일 ──');
  useGameStore.setState({ diamonds: 555, claimedAch: ['y'], adState: { dayIdx: 6, count: 2, lastAdAt: 999 }, season: 4 });
  const sid2 = G().saveId;
  G().resetSave();
  ok(G().diamonds === 555, '다이아 유지(555)');
  ok(JSON.stringify(G().claimedAch) === JSON.stringify(['y']), '업적수령 유지');
  ok(G().adState.count === 2 && G().adState.lastAdAt === 999, '광고 상태 유지');
  ok(G().season === 0, '시즌 리셋(0)');
  ok(G().saveId !== sid2 && G().saveId !== '', 'saveId 새로 발급');
  ok(G().selectedTeamId === null, '구단 선택 해제(전체 초기화)');

  console.log(fail === 0 ? '\n✅ PASS _dv_reset_preserve' : `\n❌ FAIL ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
})();
