// 측정·가드 — 오프시즌 결산 뉴스(NEWS_SYSTEM 슬라이스6, §3.7). 실제 store.endSeason을 N시즌 구동해
//   seasonDraftLog·seasonForeignLog·transfers를 쌓고, 개막 피드가 "누가 왔고 갔나"를 항상 알려주는지 검사.
//   npx tsx tools/_ev_offseasonnews.ts [시즌=32]
// 통과 기준(오프시즌마다): (a) 내 팀 결산 종합 기사 1건(조용한 오프시즌 포함=리브니스) (b) 내 팀 드래프트 픽 전원 기사화
//   (c) 외인 교체 기사 ↔ 로그 정합(누락·날조 0) (d) 결정론(재빌드 동일) (e) 신인 기사 OVR 누수 0(안개) (f) A/B teeth.
import './_gt_mock';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, SEASON, getPlayer } = await import('../data/league');
  const { buildNewsFeed, newsKey } = await import('../data/news');
  const { overall } = await import('../engine/overall');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const N = Math.max(3, Number(process.argv[2]) || 32);
  const myFix = SEASON.filter((f: any) => f.homeTeamId === my || f.awayTeamId === my);

  const build = (st: any, cs: number) => buildNewsFeed(
    st.archive, st.milestones, st.hallOfFame, cs, st.expelledLog, [], -1, my,
    st.transfers, st.retirements, st.seasonDraftLog, st.seasonForeignLog,
  );

  const fails: string[] = [];
  let offseasonsChecked = 0, quietRecaps = 0, draftTotal = 0, foreignTotal = 0, ovrChecked = 0;

  // 단일 런(in-process 다중 resetSave는 레지스트리 누수로 비결정 — 결정론은 뉴스 재빌드로 검사, _ev_transfernews와 동일).
  G().resetSave(); G().selectTeam(my);
  for (let s = 0; s < N; s++) {
    for (const f of myFix) G().recordResult({ fixtureId: f.id, homeSets: 3, awaySets: 1 } as any);
    G().setDay(164); G().endSeason();
    const st = G();
    const cs = st.season;        // 방금 시작된 새 시즌 S+1
    const off = cs - 1;          // 직전 오프시즌 = 종료된 시즌 S
    if (off < 0) continue;
    offseasonsChecked++;
    const feed = build(st, cs);

    // (a) 내 팀 결산 종합 — 정확히 1건(오프시즌마다 항상)
    const recaps = feed.filter((n) => n.kind === 'offseason' && n.teamId === my);
    if (recaps.length !== 1) fails.push(`S${off}: 결산 종합 ${recaps.length}건(1이어야)`);
    else if (/조용한 오프시즌/.test(recaps[0].headline)) quietRecaps++;

    // (b) 내 팀 드래프트 픽 전원 기사화
    const myDraft = st.seasonDraftLog.filter((d: any) => d.season === off && d.teamId === my);
    draftTotal += myDraft.length;
    const draftItems = feed.filter((n) => n.kind === 'draft');
    for (const d of myDraft) if (!draftItems.some((n) => n.ref === d.playerId)) fails.push(`S${off}: 내 드래프트 ${d.name} 무기사`);

    // (c) 외인 교체 기사 ↔ 로그 정합(누락·날조 0)
    const fEntries = st.seasonForeignLog.filter((f: any) => f.season === off);
    foreignTotal += fEntries.length;
    const fItems = feed.filter((n) => n.kind === 'foreign');
    for (const f of fEntries) { const ref = f.inId ?? f.outId; if (!fItems.some((n) => n.ref === ref)) fails.push(`S${off}: 외인교체 ${f.teamId} 무기사`); }
    for (const n of fItems) if (!fEntries.some((f: any) => (f.inId ?? f.outId) === n.ref)) fails.push(`S${off}: 외인 기사 날조(로그 없음) ${n.ref}`);

    // (e) 신인 기사 OVR 누수 0(안개) — 정확 OVR도, "OVR" 라벨도 본문/헤드에 없어야
    for (const n of draftItems) {
      const text = `${n.headline} ${n.body ?? ''}`;
      if (/OVR/i.test(text)) { fails.push(`S${off}: 드래프트 기사에 OVR 라벨 누수`); continue; }
      const d = st.seasonDraftLog.find((x: any) => x.playerId === n.ref);
      const p = d && getPlayer(d.playerId);
      if (p) { ovrChecked++; const o = overall(p);
        // OVR 값이 본문에 토큰으로 등장하면 누수(단, round·overallPick과 우연히 같은 값은 정상 허용)
        if (o !== d.round && o !== d.overallPick && new RegExp(`(^|[^0-9])${o}([^0-9]|$)`).test(text)) fails.push(`S${off}: 드래프트 기사에 OVR값 ${o} 누수`);
      }
    }

    // (d) 결정론 — 같은 상태로 재빌드 == 동일 키(오프시즌 3종)
    const feed2 = build(st, cs);
    const keyOf = (fd: any[]) => JSON.stringify(fd.filter((n) => ['offseason', 'draft', 'foreign'].includes(n.kind)).map(newsKey));
    if (keyOf(feed) !== keyOf(feed2)) fails.push(`S${off}: 결정론 위반(재빌드 상이)`);
  }

  // (a-quiet) 리브니스 — 변동 0 오프시즌도 결산 종합이 나온다(텅 빈 피드 원천 차단). 합성 빈 로그.
  const quietFeed = buildNewsFeed([], [], [], 1, [], [], -1, my, [], [], [], []);
  const quietRecap = quietFeed.find((n) => n.kind === 'offseason' && n.teamId === my);
  if (!quietRecap) fails.push('조용한 오프시즌 결산 종합 없음(리브니스 실패)');
  else if (!/조용한 오프시즌/.test(quietRecap.headline)) fails.push('빈 로그인데 "조용한 오프시즌" 변형 아님');

  // (f) A/B teeth — ① 팀 없으면 결산 종합 미발행(발행 조건 검출력) ② OVR-누수 정규식이 실제 누수 문자열을 잡는가
  const noTeamFeed = buildNewsFeed([], [], [], 1, [], [], -1, '', [], [], [], []);
  const teethTeam = noTeamFeed.every((n) => n.kind !== 'offseason'); // 팀 없으면 결산 0 → A/B로 발행이 조건부임 실증
  if (!teethTeam) fails.push('A/B 실패: 팀 미선택인데 결산 종합 발행됨');
  const leakSample = '전체 3순위로 아포짓 홍길동을 지명했다. OVR 82의 특급 기대주.';
  const teethOvr = /OVR/i.test(leakSample) && /(^|[^0-9])82([^0-9]|$)/.test(leakSample); // 누수 문자열을 잡음
  if (!teethOvr) fails.push('A/B 실패: OVR 누수 정규식이 누수 문자열을 못 잡음(허위 오라클)');

  // ── 리포트 + 실 기사 샘플 ──
  const st = G(); const feed = build(st, st.season);
  console.log(`=== 오프시즌 결산 뉴스 (${N}시즌, 엔진 실측) ===`);
  console.log(`  오프시즌 검사 ${offseasonsChecked} · 조용한결산 ${quietRecaps} · 드래프트 픽(내팀 누적) ${draftTotal} · 외인교체 누적 ${foreignTotal} · OVR안개검사 ${ovrChecked}`);
  const samp = (k: string) => feed.find((n) => n.kind === k);
  for (const k of ['offseason', 'draft', 'foreign']) { const n = samp(k); if (n) console.log(`  예)[${k}] ${n.headline}\n         ${(n.body ?? '').slice(0, 90)}`); }
  if (quietRecap) console.log(`  예)[조용] ${quietRecap.headline}\n         ${(quietRecap.body ?? '').slice(0, 90)}`);
  console.log(`  A/B: 조용한결산 발생=${quietRecaps > 0} · 팀없음→결산0=${teethTeam} · OVR정규식 teeth=${teethOvr}`);

  const pass = fails.length === 0 && offseasonsChecked >= 3 && draftTotal > 0;
  console.log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}${fails.length ? ' — ' + fails.slice(0, 8).join(' / ') : ''}`);
  if (!pass) process.exit(1);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
