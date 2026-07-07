// 구단주/면담(owner) 시스템 퍼저 — requestInterview/suggestBench/suggestStart/unbench를 적대 인자로
// 난사하고 owner 불변식을 매 스텝 검사. _gt_invariants가 안 보는 영역(fanScore·쿨다운·benchDirectives).
import './_gt_mock';
(async () => {
  const { useGameStore } = await import('../store/useGameStore');
  const { LEAGUE, currentRosters } = await import('../data/league');
  const { BENCH_MAX } = await import('../engine/owner');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  const CARDS = ['reinforce', 'starter', 'raise', 'franchise'];
  const REASONS = ['noResign', 'form', 'prospect'];

  // owner 불변식 — 깨지면 위반 문자열 반환
  const checkOwner = (tag: string): string[] => {
    const v: string[] = [];
    const fs = G().fanScore;
    if (!Number.isFinite(fs) || fs < 0 || fs > 100) v.push(`${tag}: fanScore=${fs} (0~100 벗어남)`);
    const bd = G().benchDirectives;
    // A3(2026-07-08): 철회는 삭제가 아니라 종결일(toDay)을 박아 배열에 남는다 → 슬롯·중복 불변식은 **활성(toDay==null)만** 적용.
    //   (종결된 지시가 배열에 누적돼도 슬롯을 안 먹고 재건의를 허용 — 소급 삭제로 본 역사를 다시 쓰지 않기 위함.)
    const active = bd.filter((b) => b.toDay == null);
    if (active.length > BENCH_MAX) v.push(`${tag}: active benchDirectives ${active.length} > ${BENCH_MAX}`);
    const ids = active.map((b) => b.playerId);
    if (new Set(ids).size !== ids.length) v.push(`${tag}: active benchDirectives 중복 ${ids.join(',')}`);
    for (const b of bd) if (!Number.isFinite(b.fromDay)) v.push(`${tag}: fromDay=${b.fromDay}`);
    return v;
  };

  let rs = 20240620;
  const rnd = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const randId = () => (rnd() < 0.5 ? (pick(currentRosters()[my] ?? []) ?? 'x') : `bad${Math.floor(rnd() * 99)}`);

  G().resetSave(); G().selectTeam(my);
  let crashes = 0; const violations: string[] = [];
  for (let i = 0; i < 3000; i++) {
    try {
      const r = rnd();
      if (r < 0.3) G().requestInterview(randId(), (rnd() < 0.8 ? pick(CARDS) : 'badcard') as any);
      else if (r < 0.5) G().suggestBench(randId(), (rnd() < 0.8 ? pick(REASONS) : 'badreason') as any);
      else if (r < 0.65) G().suggestStart(randId());
      else if (r < 0.75) G().unbench(randId());
      else if (r < 0.9) G().setDay(Math.floor(rnd() * 164));
      else G().endSeason();
      const v = checkOwner(`step${i}`);
      if (v.length) violations.push(...v);
    } catch (e: any) { crashes++; if (crashes <= 3) violations.push(`step${i} CRASH ${e?.message}`); }
  }

  // 쿨다운 enforce — 같은 선수 같은 날 연속 면담: 2번째는 met:false여야
  G().setDay(50);
  const target = (currentRosters()[my] ?? [])[0];
  const first = G().requestInterview(target, 'reinforce');
  const second = G().requestInterview(target, 'reinforce');
  const cdOk = first.met && !second.met;

  console.log(`=== OWNER FUZZ (3000 steps) ===`);
  console.log(`crashes=${crashes} · 불변식 위반=${violations.length}`);
  violations.slice(0, 6).forEach((x) => console.log('  · ' + x));
  console.log(`쿨다운 enforce(연속 면담 2번째 차단)=${cdOk} (true여야)`);

  // A/B 자가검증 — 깨진 상태 주입 시 체크가 잡는지
  useGameStore.setState({ fanScore: 150 });
  const abFan = checkOwner('ab').some((x) => x.includes('fanScore'));
  useGameStore.setState({ fanScore: 50, benchDirectives: [{ playerId: 'a', fromDay: 0 }, { playerId: 'b', fromDay: 0 }, { playerId: 'c', fromDay: 0 }] as any });
  const abBench = checkOwner('ab').some((x) => x.includes('benchDirectives'));
  console.log(`[A/B] fanScore=150 검출=${abFan} · benchDirectives>${BENCH_MAX} 검출=${abBench} (둘 다 true여야 신뢰)`);

  const ok = crashes === 0 && violations.length === 0 && cdOk && abFan && abBench;
  console.log(`\nOWNER OK = ${ok}`);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
