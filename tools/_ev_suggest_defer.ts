// 건의 반영 시점 가드 (OWNER_SYSTEM 2.3, 옵션 A — 2026-06-28)
//   관전 중(이어보기 대기, watchProgress 비어있지 않음) 경기엔 건의가 적용되지 않고 다음 경기부터:
//   benchDirective.fromDay = (watchProgress 있으면 currentDay+1, 없으면 currentDay).
//   A/B 자가검증: 같은 (day, player)에서 이어보기 유무만 바꿔 fromDay 델타가 정확히 1인지 — 0이면 옛 동작(미적용) 검출.
//   왜 필요: 관전 중 라인업 변경 → 저장된 이어보기가 바뀐 경기로 이어져 어긋남(시간차) + 리롤 가능. fromDay 분리로 차단.
//   npx tsx tools/_ev_suggest_defer.ts
import './_gt_mock';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, currentRosters, evolveOnDay, getPlayer } = await import('../data/league');
  const { availableTeamPlayers } = await import('../data/injury');
  const { setOwnerContext } = await import('../data/dynamics');
  const { buildLineup } = await import('../engine/lineup');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;

  let pass = 0, fail = 0;
  const check = (name: string, ok: boolean, detail = '') => { (ok ? pass++ : fail++); console.log(`  ${ok ? '✅' : '❌ FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
  const fresh = (day: number) => { G().resetSave(); G().selectTeam(my); setOwnerContext([]); G().setDay(day); };
  const lastDir = () => G().benchDirectives[G().benchDirectives.length - 1];

  // ── suggestBench: 수락되는 (day, player) 한 쌍 탐색 ──
  let bDay = -1, bPid = '';
  outer:
  for (let day = 0; day < 80; day++) {
    fresh(day);
    for (const pid of currentRosters()[my] ?? []) {
      fresh(day);
      if (G().suggestBench(pid, 'noResign')) { bDay = day; bPid = pid; break outer; }
    }
  }
  console.log('═══ suggestBench 건의 시점 ═══');
  if (bDay < 0) {
    check('B0 수락 케이스 발견', false, '80일 스캔에도 수락 0 — 시나리오 점검 필요');
  } else {
    // 대조군(이어보기 없음) → fromDay == currentDay
    fresh(bDay); const okA = G().suggestBench(bPid, 'noResign'); const fromA = lastDir()?.fromDay;
    check('B1 이어보기 없음 → fromDay = currentDay', okA && fromA === bDay, `fromDay=${fromA} day=${bDay}`);
    // 처치군(이어보기 대기) → fromDay == currentDay + 1
    fresh(bDay); G().saveWatchProgress('fixture-x', 7); const okB = G().suggestBench(bPid, 'noResign'); const fromB = lastDir()?.fromDay;
    check('B2 이어보기 대기 → fromDay = currentDay+1', okB && fromB === bDay + 1, `fromDay=${fromB} day+1=${bDay + 1}`);
    // A/B 민감도: 델타가 정확히 1 (0이면 옛 동작 = 미적용 회귀)
    check('B3 A/B 델타=1 (옛 미적용 검출)', okA && okB && (fromB! - fromA!) === 1, `Δ=${(fromB ?? NaN) - (fromA ?? NaN)}`);
  }

  // ── suggestStart: 동포지션 주전 ≥1 있는 비주전 후보로 수락 케이스 탐색 ──
  let sDay = -1, sPid = '';
  outer2:
  for (let day = 0; day < 80; day++) {
    fresh(day);
    const starters = buildLineup(availableTeamPlayers(my, day)).six;
    for (const cand of currentRosters()[my] ?? []) {
      const cp = evolveOnDay(cand, day); if (!cp) continue;
      if (starters.some((p) => p.id === cand)) continue;                       // 후보는 비주전
      if (!starters.some((p) => p.position === cp.position && p.id !== cand)) continue; // 동포지션 주전 존재
      fresh(day);
      if (G().suggestStart(cand)) { sDay = day; sPid = cand; break outer2; }
    }
  }
  console.log('\n═══ suggestStart 건의 시점 ═══');
  if (sDay < 0) {
    check('S0 수락 케이스 발견', false, '80일 스캔에도 수락 0');
  } else {
    fresh(sDay); const okA = G().suggestStart(sPid); const fromA = lastDir()?.fromDay;
    check('S1 이어보기 없음 → fromDay = currentDay', okA && fromA === sDay, `fromDay=${fromA} day=${sDay}`);
    fresh(sDay); G().saveWatchProgress('fixture-x', 7); const okB = G().suggestStart(sPid); const fromB = lastDir()?.fromDay;
    check('S2 이어보기 대기 → fromDay = currentDay+1', okB && fromB === sDay + 1, `fromDay=${fromB} day+1=${sDay + 1}`);
    check('S3 A/B 델타=1', okA && okB && (fromB! - fromA!) === 1, `Δ=${(fromB ?? NaN) - (fromA ?? NaN)}`);
  }

  console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — pass ${pass} / fail ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
})();
