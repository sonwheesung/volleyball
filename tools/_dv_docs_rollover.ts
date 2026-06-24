// 독립검증(문서만) — 시즌 롤오버 불변식 + 레지스트리 누수.
// 도출 출처(문서):
//  SEASON_SYSTEM §0 "결정론: 선수별 RNG는 id 해시로 고정 → 같은 날=같은 결과", §6 endSeason(롤오버: 나이+1·경력+1·은퇴).
//  CLAUDE.md §11 "결정론 유지: 모든 시스템은 시드 기반 순수 함수. 상태는 currentDay+results에서 재계산(리플레이)."
//  EDGE_CASES §0-5 "만료=명단 이탈"(좀비 없음), §0-6 "같은 시드·같은 입력 → 같은 결과", §0-7 정원 10~18.
//  FOREIGN_SYSTEM §1 외인 1팀 1명·멸종0, §2 "자금 바닥 구단은 외인 공석"(내 팀 캐시 게이트 = WAI).
//
// 불변식:
//  I1. 살아남은 선수 age 단조 +1 (시즌 경계)
//  I2. 모든 팀 로스터 ROSTER_MIN(10)≤n≤ROSTER_MAX(18)
//  I3. AI 팀(내 팀 제외)은 외인 1·아시아쿼터 1 정확히 유지(멸종0). 내 팀은 캐시 게이트로 0 가능(WAI — 검사 제외)
//  I4. 좀비 없음 — 로스터 선수 계약 remaining ≥ 1
//  I5(핵심). 결정론 — 동일 시드/입력으로 재현. **세이브 리플레이는 cross-process 결정론(진짜 게임)**.
//      그러나 단일 프로세스에서 resetSave 후 재플레이 시 레지스트리 누수로 깨질 수 있음(이게 발견점).
//
// A/B: 모든 검사기를 일부러 깬 입력으로 FAIL 확인(허위 오라클 차단).
import './_gt_mock';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, SEASON, currentRosters, evolveOnDay, getPlayer } = await import('../data/league');
  const { ROSTER_MIN, ROSTER_MAX } = await import('../engine/transactions');
  const crypto = await import('crypto');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const myFix = SEASON.filter((f: any) => f.homeTeamId === my || f.awayTeamId === my);

  function playSeasonAndRollover() {
    for (const f of myFix) G().recordResult({ fixtureId: f.id, homeSets: 3, awaySets: 1 } as any);
    G().setDay(164);
    G().endSeason();
  }

  type Snap = { ages: Map<string, number>; sizes: number[]; aiForeign: number[]; aiAsian: number[]; zombies: string[] };
  function snapshot(): Snap {
    const ros = currentRosters();
    const ages = new Map<string, number>();
    const sizes: number[] = []; const aiForeign: number[] = []; const aiAsian: number[] = []; const zombies: string[] = [];
    LEAGUE.teams.forEach((t, idx) => {
      const ids = ros[t.id] ?? [];
      sizes.push(ids.length);
      let f = 0, a = 0;
      for (const id of ids) {
        const p = evolveOnDay(id, 0) ?? getPlayer(id);
        if (!p) { zombies.push(`${id}(없음)`); continue; }
        ages.set(id, p.age);
        if (p.isForeign && !p.isAsianQuota) f++;
        if (p.isAsianQuota) a++;
        if (p.contract.remaining < 1) zombies.push(`${id}(rem=${p.contract.remaining})`);
      }
      if (idx !== 0) { aiForeign.push(f); aiAsian.push(a); } // 내 팀(0) 제외 — 캐시 게이트 WAI
    });
    return { ages, sizes, aiForeign, aiAsian, zombies };
  }

  function check(prev: Snap, cur: Snap): string[] {
    const v: string[] = [];
    cur.sizes.forEach((n, i) => { if (n < ROSTER_MIN || n > ROSTER_MAX) v.push(`I2 roster[${i}]=${n}`); });
    cur.aiForeign.forEach((f, i) => { if (f !== 1) v.push(`I3 aiForeign[${i}]=${f}`); });
    cur.aiAsian.forEach((a, i) => { if (a !== 1) v.push(`I3 aiAsian[${i}]=${a}`); });
    if (cur.zombies.length) v.push(`I4 zombies=${cur.zombies.slice(0, 4).join(',')}`);
    let bad = 0;
    for (const [id, age] of cur.ages) {
      const before = prev.ages.get(id);
      if (before === undefined) continue;
      if (age !== before + 1) { bad++; if (bad <= 3) v.push(`I1 ${id} ${before}->${age}`); }
    }
    return v;
  }

  function run(seasons: number) {
    G().resetSave(); G().selectTeam(my);
    let prev = snapshot();
    const viol: string[] = [];
    for (let s = 0; s < seasons; s++) {
      const bs = G().season;
      playSeasonAndRollover();
      if (G().season !== bs + 1) { viol.push(`S${s}:ROLLOVER_NOOP`); break; }
      const cur = snapshot();
      check(prev, cur).forEach((x) => viol.push(`S${s}:${x}`));
      prev = cur;
    }
    const ros = currentRosters(); const parts: string[] = [];
    for (const t of LEAGUE.teams) for (const id of (ros[t.id] ?? [])) { const p = evolveOnDay(id, 0); if (p) parts.push(`${id}:${p.age}`); }
    parts.sort();
    return { viol, hash: crypto.createHash('md5').update(parts.join('|')).digest('hex') };
  }

  const SEASONS = Number(process.argv[2] || 8);

  // ---- 본 검증: I1~I4 ----
  const r1 = run(SEASONS);
  console.log(`\n=== ${SEASONS}시즌 롤오버 (실제 store.endSeason) ===`);
  console.log(`I1~I4 위반 ${r1.viol.length}건` + (r1.viol.length ? `:\n  ${r1.viol.slice(0, 12).join('\n  ')}` : ' (나이+1·정원·AI외인1/아시아1·좀비없음 OK)'));

  // ---- I5: 세이브 리플레이 cross-process 결정론(진짜 게임이 결정론인가) ----
  //   in-process resetSave 재플레이는 레지스트리 누수로 깨지므로 process 단위로 비교한다.
  const { execSync } = await import('child_process');
  const self = __filename.replace(/\.ts$/, '.ts');
  const hashOf = () => {
    const out = execSync(`npx tsx ${JSON.stringify(self)} ${SEASONS} --hashonly`, { encoding: 'utf8' });
    const m = out.match(/HASH=([a-f0-9]+)/); return m ? m[1] : 'ERR';
  };
  if (process.argv.includes('--hashonly')) { console.log(`HASH=${r1.hash}`); return; }
  const h1 = hashOf(), h2 = hashOf();
  console.log(`\nI5 cross-process 결정론(세이브 리플레이 = 진짜 게임): ${h1 === h2 ? 'OK 동일' : 'FAIL 상이'} (${h1.slice(0,8)} / ${h2.slice(0,8)})`);

  // ---- 레지스트리 누수 프로브(in-process resetSave 후 생성선수 잔존) ----
  G().resetSave(); G().selectTeam(my);
  playSeasonAndRollover();             // S0 — 신인/외인/아시아 생성
  const sample = ['d1_1', 'fgn-s1-1', 'asn-s1-1'].filter((id) => getPlayer(id));
  G().resetSave(); G().selectTeam(my); // reset(경기 0)
  const leaked = sample.filter((id) => getPlayer(id));
  console.log(`\n레지스트리 누수: resetSave 직후 잔존 생성선수 ${leaked.length}/${sample.length} ${leaked.length ? `→ 누수 [${leaked.join(',')}] (in-process A/B 오염원)` : '없음(정상)'}`);

  // ---- A/B 자가검증 ----
  const base: Snap = { ages: new Map([['x', 25]]), sizes: [14], aiForeign: [1], aiAsian: [1], zombies: [] };
  const broken: Snap = { ages: new Map([['x', 25]]), sizes: [19], aiForeign: [2], aiAsian: [0], zombies: ['z(rem=0)'] };
  const ab = check(base, broken);
  const ageAB = check({ ages: new Map([['y', 25]]), sizes: [14], aiForeign: [1], aiAsian: [1], zombies: [] },
                      { ages: new Map([['y', 25]]), sizes: [14], aiForeign: [1], aiAsian: [1], zombies: [] });
  const oracleOk = ['I2', 'I3', 'I4'].every((k) => ab.some((s) => s.startsWith(k))) && ageAB.some((s) => s.startsWith('I1'));
  console.log(`\nA/B 오라클 유효(깬입력 전부 검출)=${oracleOk} (expect true)`);

  console.log(`\nRESULT: I1~I4=${r1.viol.length === 0 ? 'PASS' : 'FAIL'} · cross-proc결정론=${h1 === h2 ? 'PASS' : 'FAIL'} · 레지스트리누수=${leaked.length ? 'DETECTED' : 'none'} · 오라클=${oracleOk}`);
})();
