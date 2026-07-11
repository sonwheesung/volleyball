// 독립 검증 — 축1(evoOneCache 콘텐츠 시그니처 캐싱) 정확성 + 팀 분할 불변식. REALTIME_SIM §7.2 정정.
//   오라클(절대 기준): 시그니처 기반 캐시 재사용은 **결과를 바꾸지 않는다**(clean 전체 재계산과 byte-동일).
//   자가검증(A/B): 변경이 실제로 값을 바꾸는지(오라클 민감도) + 한 팀만 바꾸면 그 팀만 변하고 나머지는 byte 불변.
//   실행: npx tsx tools/_dv_evosig.ts
import './_gt_mock';
import type { Player } from '../types';
(async () => {
  const {
    LEAGUE, currentRosters, evolveOnDay, hireHeadCoach, availableCoaches,
    assignCoach, setFocusOverride, commitRosters, getStaffState, getCoachTimeline, commitStaff,
  } = await import('../data/league') as any;
  const { seasonResults, setStandingsCacheRaw } = await import('../data/standings');
  const { setProductionCacheRaw } = await import('../data/production');
  const { useGameStore } = await import('../store/useGameStore');
  const { SEASON } = await import('../data/league');
  const MAX = Number.MAX_SAFE_INTEGER;

  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const DAY = 120; // 진화 누적이 보이는 중후반
  const myMatchdays = [...new Set(SEASON.filter((f: any) => f.homeTeamId === my || f.awayTeamId === my).map((f: any) => f.dayIndex))].sort((a, b) => a - b);

  let pass = 0, fail = 0, ab = 0, abFail = 0;
  const check = (name: string, ok: boolean, detail = '') => { (ok ? pass++ : fail++); console.log(`  ${ok ? '✅' : '❌ FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
  const ab_check = (name: string, sensitive: boolean) => { ab++; if (!sensitive) abFail++; console.log(`     ${sensitive ? '🔬AB' : '⚠️ AB무효'} ${name} ${sensitive ? '(변경이 실제로 값 변화 — 오라클 민감)' : '(변경이 값 무변화 — 오라클 못 믿음)'}`); };

  // 선수 진화 결과 직렬화(전 필드 — 노쇠/성장이 바꾸는 스탯·xp 포함, 누락 방지)
  const ser = (p: Player | undefined): string => (p ? JSON.stringify(p) : 'nil');
  const idTeam = new Map<string, string>();
  for (const t of LEAGUE.teams) for (const id of currentRosters()[t.id] ?? []) idTeam.set(id, t.id);
  const allIds = [...idTeam.keys()];
  const evoAll = (day: number): Map<string, string> => { const m = new Map<string, string>(); for (const id of allIds) m.set(id, ser(evolveOnDay(id, day))); return m; };

  // ══════════════════════════════════════════════════════════════════
  // (a) 캐시 재사용 == clean 전체 재계산 (byte-동일) — 감독/훈련 변경 후
  // ══════════════════════════════════════════════════════════════════
  console.log('═══ (a) 시그니처 캐시 재사용 == clean 재계산 (byte-동일) ═══');
  const caseReuseEqualsClean = (label: string, mutate: () => void) => {
    G().resetSave(); G().selectTeam(my);
    evoAll(DAY);                    // 워밍(evoOneCache 시드 — SEED 시그니처)
    const P0 = evoAll(DAY);         // 변경 전 값
    mutate();                       // baseVersion++ + rebuildFocus(새 시그니처), evoOneCache는 안 비움
    const P2 = evoAll(DAY);         // 캐시 경로(시그니처로 재사용/재계산 혼합)
    commitRosters(currentRosters()); // clearEvoOne → 완전 콜드
    const P1 = evoAll(DAY);         // clean 전체 재계산
    let mism = 0; const det: string[] = [];
    for (const id of allIds) if (P2.get(id) !== P1.get(id)) { if (det.length < 3) det.push(`${id}(${idTeam.get(id)})`); mism++; }
    check(`(a) ${label}: 캐시경로 == clean (${allIds.length}선수)`, mism === 0, mism ? `불일치 ${mism}: ${det.join(',')}` : 'byte-동일');
    // 민감도: 내 팀 값이 실제로 바뀌었나(clean 기준 P1 != P0) → P2==P1 이 stale(P0) 재사용이 아님을 보장
    let myChanged = 0; for (const id of allIds) if (idTeam.get(id) === my && P1.get(id) !== P0.get(id)) myChanged++;
    ab_check(`(a) ${label}: 변경이 내 팀 진화를 실제로 바꿈`, myChanged > 0);
  };
  caseReuseEqualsClean('감독 영입(mid-season)', () => {
    const c = availableCoaches(my).slice().sort((a: any, b: any) => a.salary - b.salary)[0];
    const ok = hireHeadCoach(my, c.id, myMatchdays[Math.floor(myMatchdays.length / 3)]);
    if (!ok) throw new Error('hire failed');
  });
  caseReuseEqualsClean('훈련방침 day0', () => {
    setFocusOverride(my, { primary: [2, 3], secondary: [5, 7, 9] });
  });

  // ══════════════════════════════════════════════════════════════════
  // (b) 팀 분할 불변식 — 한 팀 감독만 바꾸면 그 팀 선수 evo만 변하고 나머지 6팀 byte 불변
  //     (축1의 전제: evolvePlayer 는 소속팀 focus/effects 에만 의존. 캐시가 이 분할을 반영해야.)
  // ══════════════════════════════════════════════════════════════════
  console.log('═══ (b) 팀 분할 변이 — 한 팀만 바꾸면 그 팀만 변함 ═══');
  {
    const teamX = LEAGUE.teams[3].id; // 내 팀 아닌 임의 팀
    G().resetSave(); G().selectTeam(my);
    evoAll(DAY); // 워밍
    const before = evoAll(DAY);
    // teamX 감독만 교체(소급 assignCoach). 감독 focus 가 시드와 같아 무변할 수 있으니 focus 오버라이드로도 보강.
    const c = availableCoaches(teamX).slice().sort((a: any, b: any) => a.salary - b.salary)[0];
    if (c) assignCoach(teamX, c.id);
    setFocusOverride(teamX, { primary: [1, 11], secondary: [4, 6, 8] }); // teamX 훈련만 변경(확실한 변화)
    const after = evoAll(DAY);
    let xChanged = 0, otherChanged = 0; const otherDet: string[] = [];
    for (const id of allIds) {
      const changed = before.get(id) !== after.get(id);
      if (idTeam.get(id) === teamX) { if (changed) xChanged++; }
      else if (changed) { otherChanged++; if (otherDet.length < 5) otherDet.push(`${id}(${idTeam.get(id)})`); }
    }
    check('(b) 나머지 6팀 선수 byte 불변', otherChanged === 0, otherChanged ? `누출 ${otherChanged}: ${otherDet.join(',')}` : '무변');
    ab_check('(b) 바꾼 팀(teamX) 선수는 실제로 변함', xChanged > 0);
  }

  // ══════════════════════════════════════════════════════════════════
  // (c) 감독 forward-only 재로드 보존 (축3 영속) — 세이브 timeline 복원 후 결과 byte 불변.
  //     구세이브(timeline 없음) 재로드는 day0 백필=소급 → 과거가 바뀜(A/B: 영속 필드가 실효임을 증명).
  // ══════════════════════════════════════════════════════════════════
  console.log('═══ (c) 감독 forward-only 재로드 보존(축3 영속) ═══');
  {
    const rows = (): string => JSON.stringify(seasonResults(MAX).map((r) => [r.dayIndex, r.homeSets, r.awaySets, r.homeTeamId]));
    G().resetSave(); G().selectTeam(my);
    const hireDay = myMatchdays[Math.floor(myMatchdays.length / 2)];
    const c = availableCoaches(my).slice().sort((a: any, b: any) => a.salary - b.salary)[0];
    hireHeadCoach(my, c.id, hireDay);
    const rowsPre = rows();                 // 영입 후(현 세션) forward-only 결과
    const ss = getStaffState(); const tl = getCoachTimeline(); // partialize 시점 캡처
    // ── 재로드 A: timeline 복원(신세이브) ──
    commitStaff(ss.head, ss.asst, ss.scout, tl);
    setStandingsCacheRaw(null); setProductionCacheRaw(null);
    const rowsWithTl = rows();
    check('(c) 재로드(timeline 복원) == 재로드 전(forward-only 보존)', rowsWithTl === rowsPre);
    // ── 재로드 B: timeline 없음(구세이브 day0 백필=소급) ──
    commitStaff(ss.head, ss.asst, ss.scout);
    setStandingsCacheRaw(null); setProductionCacheRaw(null);
    const rowsNoTl = rows();
    ab_check('(c) timeline 누락 재로드는 forward-only 소실(소급으로 과거 변화)', rowsNoTl !== rowsPre);
  }

  console.log(`\n═══ 결과: ${pass} PASS · ${fail} FAIL | A/B: ${ab - abFail}/${ab} 유효(무효 ${abFail}) ═══`);
  console.log(fail === 0 && abFail === 0 ? '✅ 축1 시그니처 캐시 정확성 + 팀 분할 통과' : '❌ 위반/무효 있음');
  process.exit(fail === 0 && abFail === 0 ? 0 : 1);
})();
