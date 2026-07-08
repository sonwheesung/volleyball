// 시나리오 테스트 — 재계약(reSign 스토어 게이트) + FA 영입(signFA 큐·FA시장 함수·endSeason 불변식).
// 결정론 스토어를 직접 구동해 각 시나리오의 기대 결과(적용/거부/불변식)를 단언한다. A/B는 거부 시나리오가
// "정상 입력은 통과·비정상은 거부"로 양방향 검증. EDGE_CASES 2.1(FA)·캡/연봉 불변식 가드.
//   npx tsx tools/_gt_facontract.ts
import './_gt_mock';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, currentRosters, evolveOnDay } = await import('../data/league');
  const { LEAGUE_CAP, MAX_SALARY, FRANCHISE_MAX, maxSalaryFor, isFranchise } = await import('../engine/cap');
  const { isFAEligible, assignFAGrades, askingPrice } = await import('../engine/faMarket');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;

  let pass = 0, fail = 0;
  const check = (name: string, ok: boolean, detail = '') => { (ok ? pass++ : fail++); console.log(`  ${ok ? '✅' : '❌ FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
  const setup = () => { G().resetSave(); G().selectTeam(my); return currentRosters()[my] ?? []; };
  const applied = (id: string) => G().contractOverrides[id] !== undefined;
  const domSalary = (ids: string[], exclude?: string) => ids.reduce((a, id) => { const p = evolveOnDay(id, 0); if (!p || p.isForeign || id === exclude) return a; return a + (G().contractOverrides[id]?.salary ?? p.contract.salary); }, 0);
  const firstDom = (ids: string[]) => ids.find((id) => { const p = evolveOnDay(id, 0); return p && !p.isForeign; })!;
  const firstForeign = (ids: string[]) => ids.find((id) => { const p = evolveOnDay(id, 0); return p && p.isForeign; });
  const C = (salary: number, over: Partial<{ years: number; remaining: number; signedAtAge: number }> = {}) => ({ salary, years: over.years ?? 3, remaining: over.remaining ?? 3, signedAtAge: over.signedAtAge ?? 28 });

  console.log('═══ 재계약(reSign) 시나리오 ═══');
  // S1 정상(현 연봉 유지 → 캡 내) → 적용
  { const ids = setup(); const id = firstDom(ids); const p = evolveOnDay(id, 0)!; G().reSign(id, C(p.contract.salary)); check('S1 정상 재계약(캡 내)', applied(id)); }
  // S2 로스터 외 선수 → 무시
  { setup(); const other = currentRosters()[LEAGUE.teams[1].id]?.[0]!; G().reSign(other, C(30000)); check('S2 타팀 선수 재계약 거부', !applied(other)); }
  // S3 음수 연봉 → 무시
  { const ids = setup(); const id = firstDom(ids); G().reSign(id, C(-50000)); check('S3 음수 연봉 거부', !applied(id)); }
  // S4 0 연봉 → 무시
  { const ids = setup(); const id = firstDom(ids); G().reSign(id, C(0)); check('S4 0 연봉 거부', !applied(id)); }
  // S5 NaN/Infinity 연봉 → 무시
  { const ids = setup(); const id = firstDom(ids); G().reSign(id, C(NaN)); G().reSign(id, C(Infinity)); check('S5 NaN/Infinity 연봉 거부', !applied(id)); }
  // S6 years<1 → 무시
  { const ids = setup(); const id = firstDom(ids); G().reSign(id, C(30000, { years: 0, remaining: 0 })); check('S6 years=0 거부', !applied(id)); }
  // S7 remaining>years → 무시
  { const ids = setup(); const id = firstDom(ids); G().reSign(id, C(30000, { years: 2, remaining: 5 })); check('S7 잔여>계약연수 거부', !applied(id)); }
  // S8 비프랜차이즈 8억 초과 → 무시
  { const ids = setup(); const id = ids.find((x) => { const p = evolveOnDay(x, 0); return p && !p.isForeign && !isFranchise(p); })!; G().reSign(id, C(MAX_SALARY + 10000)); check('S8 비프랜차이즈 8억 초과 거부', !applied(id), `시도 ${MAX_SALARY + 10000}>${MAX_SALARY}`); }
  // S9 캡 가드(비프랜차이즈 하드캡): 프랜차이즈 없는 팀서 국내 전원 8억 재계약해도 국내 payroll ≤ 35억(초과분 거부).
  //   ※ 프랜차이즈 재계약은 팀캡 예외(canAfford franchise=true = 전액 면제 — FA_SYSTEM §2.4)라, 프랜차이즈가 있는 팀은
  //     그 예외로 payroll이 캡을 넘을 수 있어 하드캡 단언 대상이 아니다(S16에서 별도 검증). 그래서 프랜차 0인 팀으로 측정.
  { const noFr = LEAGUE.teams.find((x) => !(currentRosters()[x.id] ?? []).some((id) => { const p = evolveOnDay(id, 0); return p && isFranchise(p); }))?.id ?? my;
    G().resetSave(); G().selectTeam(noFr); const ids = currentRosters()[noFr] ?? [];
    let attempted = 0; for (const id of ids) { const p = evolveOnDay(id, 0); if (!p || p.isForeign) continue; attempted++; G().reSign(id, C(MAX_SALARY)); }
    const pay = domSalary(ids); check('S9 캡 가드(비프랜차 팀 전원 8억 → payroll ≤ 35억)', pay <= LEAGUE_CAP, `팀 ${noFr} 국내payroll ${pay} ≤ ${LEAGUE_CAP} · 시도 ${attempted}명`); }
  // S10 외인은 국내 reSign 비대상(트라이아웃 전용, 2026-06-25 — FOREIGN_SYSTEM 3장·EDGE_CASES §3.9). reSign(외인)은 거부(override 미생성).
  { const ids = setup(); const fid = firstForeign(ids); if (fid) { G().reSign(fid, C(2_000_000)); check('S10 외인 reSign 거부(트라이아웃 전용)', !applied(fid), '외인은 국내 재계약 비대상 — keepForeign으로만'); } else check('S10 외인 reSign 거부', true, '로스터에 외인 없음 — skip'); }
  // S11 프랜차이즈 개인상한 11억(8억 초과 적용·11억 초과 거부) — 팀 캡과 분리하려 다른 선수를 최저로 재계약해 캡 여유 확보
  { const ids = setup(); const fr = ids.find((x) => { const p = evolveOnDay(x, 0); return p && isFranchise(p); });
    if (fr) {
      const frP = evolveOnDay(fr, 0)!;
      for (const id of ids) { const p = evolveOnDay(id, 0); if (!p || p.isForeign || id === fr) continue; G().reSign(id, C(10000)); } // 다른 국내 최저로 → 캡 여유
      G().reSign(fr, C(MAX_SALARY + 10000)); // 9억: 비프랜차면 거부, 프랜차면 적용(개인상한 11억)
      const above = G().contractOverrides[fr]?.salary === MAX_SALARY + 10000;
      G().reSign(fr, C(FRANCHISE_MAX + 10000)); // 12억: 프랜차도 거부 → override가 9억 그대로 유지
      const overRej = G().contractOverrides[fr]?.salary === MAX_SALARY + 10000;
      check('S11 프랜차이즈 개인상한(8억 초과 적용·11억 초과 거부)', maxSalaryFor(frP) === FRANCHISE_MAX && above && overRej, `9억적용=${above}·12억거부=${overRej}`);
    } else { const dp = evolveOnDay(firstDom(ids), 0)!; check('S11 프랜차이즈(maxSalaryFor 단위)', maxSalaryFor(dp) === MAX_SALARY && FRANCHISE_MAX > MAX_SALARY, '로스터 프랜차이즈 없음 — 비프랜차 상한=8억·프랜차 상한 11억 확인'); } }

  // ── S16/S17 프랜차이즈 팀캡 예외 A/B(FA_SYSTEM §2.4) — reSign 팀캡 게이트에 isFranchise 예외 도입 ──
  //   canAfford(franchise=true)=전액 면제와 통일. UI(app/contracts.tsx)는 통과시키는데 store가 하드캡으로 조용히 거부하던 회귀 수정.
  //   A(프랜차)=팀캡 초과 재계약 적용 · B(비프랜차)=동일 상황 거부. 둘 다 참이어야 예외가 "프랜차이즈에만" 적용됨을 증명(허위 오라클 방지).
  { // 프랜차이즈 1명+ & 비프랜차 국내 1명+ 팀
    const t = LEAGUE.teams.find((x) => { const r = currentRosters()[x.id] ?? [];
      return r.some((id) => { const p = evolveOnDay(id, 0); return p && isFranchise(p); }) && r.some((id) => { const p = evolveOnDay(id, 0); return p && !p.isForeign && !isFranchise(p); }); });
    if (t) {
      const tid = t.id;
      const loadT = () => { G().resetSave(); G().selectTeam(tid); return currentRosters()[tid] ?? []; };
      // 비프랜차 국내만 8억으로 채워 팀캡을 가득(프랜차/외인/대상 제외 — 프랜차 예외 loophole로 캡이 부푸는 것 방지).
      const fillNonFr = (exclude: string) => { for (const id of currentRosters()[tid] ?? []) { const p = evolveOnDay(id, 0); if (!p || p.isForeign || isFranchise(p) || id === exclude) continue; G().reSign(id, C(MAX_SALARY)); } };
      // S16(A): 프랜차이즈 — 팀캡을 넘기는 금액(개인상한 11억 이내)으로 재계약 → 적용(예외).
      { const ids = loadT(); const fr = ids.find((id) => { const p = evolveOnDay(id, 0); return p && isFranchise(p); })!;
        const frP = evolveOnDay(fr, 0)!; fillNonFr(fr);
        const before = domSalary(ids); // fr 현 연봉 포함
        const wouldExceed = before - frP.contract.salary + FRANCHISE_MAX > LEAGUE_CAP;
        G().reSign(fr, C(FRANCHISE_MAX));
        const applied16 = G().contractOverrides[fr]?.salary === FRANCHISE_MAX;
        check('S16 프랜차이즈 팀캡 초과 재계약 적용(예외)', wouldExceed && applied16, `팀캡초과=${wouldExceed}·적용=${applied16}`); }
      // S17(B): 비프랜차이즈 — 동일 팀캡 초과 상황서 8억 재계약 → 거부(하드캡 유지).
      { const ids = loadT(); const nf = ids.find((id) => { const p = evolveOnDay(id, 0); return p && !p.isForeign && !isFranchise(p); })!;
        const nfP = evolveOnDay(nf, 0)!; fillNonFr(nf);
        const before = domSalary(ids);
        const wouldExceed = before - nfP.contract.salary + MAX_SALARY > LEAGUE_CAP;
        G().reSign(nf, C(MAX_SALARY));
        const rejected17 = G().contractOverrides[nf]?.salary !== MAX_SALARY;
        check('S17 비프랜차이즈 팀캡 초과 재계약 거부(대조)', wouldExceed && rejected17, `팀캡초과=${wouldExceed}·거부=${rejected17}`); }
    } else { check('S16/S17 프랜차이즈 팀캡 예외', true, '적격 팀 없음 — skip'); }
  }

  console.log('\n═══ FA 영입 시나리오 ═══');
  // S12 signFA/unsignFA 큐
  { setup(); const fa = LEAGUE.teams.flatMap((t) => currentRosters()[t.id] ?? []).find((id) => isFAEligible(evolveOnDay(id, 0)!)) ?? currentRosters()[LEAGUE.teams[1].id]![0]; G().signFA(fa); const q1 = G().faSignings.includes(fa); G().signFA(fa); const noDup = G().faSignings.filter((x) => x === fa).length === 1; G().unsignFA(fa); const q2 = !G().faSignings.includes(fa); check('S12 signFA 큐 추가·중복없음·unsignFA 제거', q1 && noDup && q2); }
  // S13 askingPrice 등급 단조: A > B > C (같은 market)
  { const m = 50000; const a = askingPrice(m, 'A'), b = askingPrice(m, 'B'), c = askingPrice(m, 'C'); check('S13 요구연봉 A>B>C', a > b && b > c, `A${a}>B${b}>C${c}`); }
  // S14 등급 배정: 연봉 상위=A, 하위=C
  { const pool = LEAGUE.teams.flatMap((t) => (currentRosters()[t.id] ?? []).map((id) => evolveOnDay(id, 0)!)).filter(Boolean).slice(0, 20); const g = assignFAGrades(pool); const top = [...pool].sort((x, y) => y.contract.salary - x.contract.salary)[0]; const bot = [...pool].sort((x, y) => x.contract.salary - y.contract.salary)[0]; check('S14 FA 등급(상위연봉=A·하위=C)', g.get(top.id) === 'A' && g.get(bot.id) === 'C', `top=${g.get(top.id)} bot=${g.get(bot.id)}`); }
  // S15 endSeason FA 영입 불변식: 정원 [10,18]·국내캡 ≤ 35억 유지
  { setup(); const fas = LEAGUE.teams.flatMap((t) => currentRosters()[t.id] ?? []).filter((id) => isFAEligible(evolveOnDay(id, 0)!)).slice(0, 2); for (const f of fas) G().signFA(f); G().endSeason(); const roster = currentRosters()[my] ?? []; const size = roster.length; const pay = roster.reduce((a, id) => { const p = evolveOnDay(id, G().currentDay); return a + (p && !p.isForeign ? p.contract.salary : 0); }, 0); check('S15 endSeason 후 정원[10,18]·국내캡 유지', size >= 10 && size <= 18 && pay <= LEAGUE_CAP, `정원 ${size} · 국내payroll ${pay}`); }

  console.log(`\n═══ 결과: ${pass} PASS · ${fail} FAIL ═══`);
  console.log(fail === 0 ? '✅ 전 시나리오 통과' : '❌ 실패 시나리오 있음 — 위 ❌ 확인');
  process.exit(fail === 0 ? 0 : 1);
})();
