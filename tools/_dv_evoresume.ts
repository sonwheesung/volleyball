// 독립 검증 — §7.9 진화 점진 캐시(c1): evolveSpan 부분구간 재개 + evolveOnDay 체크포인트.
//   오라클(절대 기준): evolveSpan(0→d1)∘evolveSpan(d1→d2) == 풀 evolveSpan(0→d2) == evolvePlayer(0→d2)
//     — 전 스탯 + xp 바 전부 + **rngState**까지 deep-equal. 은닉상태(Player·RNG위치)를 다 잇는가.
//   이빨(A/B, 허위오라클 차단): "순진 재시드"(재개 시 rng 새 시작)와 "상대일 focus"(R3) 변이가 오라클을 FAIL시킴.
//   시퀀스: evolveOnDay 오름차순+중간 내림차순 질의가 전부 base-콜드(evolvePlayer)와 byte-동일(체크포인트 재개·역행 폴백).
//   실행: npx tsx tools/_dv_evoresume.ts
import './_gt_mock';
import type { Player, TrainableStat, TrainingFocus, TrainingId } from '../types';
import { evolveSpan, evolvePlayer, initialEvoRngState, type FocusInput } from '../engine/progression';
import type { StaffEffects } from '../engine/staff';
import { NO_EFFECTS } from '../engine/staff';

(async () => {
  const { LEAGUE, currentRosters, evolveOnDay, getPlayer, focusOf, effectsOf } = await import('../data/league') as any;
  const { SEASON_DAYS } = await import('../engine/calendar');
  const { useGameStore } = await import('../store/useGameStore');

  let pass = 0, fail = 0;
  const check = (name: string, ok: boolean, detail = '') => { (ok ? pass++ : fail++); console.log(`  ${ok ? '✅' : '❌ FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
  // A/B(이빨): 변이가 오라클을 **깨야** 유효(민감). 안 깨면 오라클을 못 믿음.
  let abFail = 0;
  const teeth = (name: string, mismatches: number, samples: number) => {
    const sensitive = mismatches > 0;
    if (!sensitive) abFail++;
    console.log(`     ${sensitive ? '🔬AB' : '⚠️ AB무효'} ${name}: 변이가 ${mismatches}/${samples} 샘플에서 오라클 깨뜨림 ${sensitive ? '(민감)' : '(무변화 — 오라클 못 믿음)'}`);
  };

  const ser = (p: Player): string => JSON.stringify(p);
  const DEFAULT_FOCUS: TrainingFocus = { primary: [4, 6], secondary: [1, 10, 12] };
  const ALT_FOCUS: TrainingFocus = { primary: [2, 3], secondary: [5, 7, 9] };

  // 합성 스태프 효과(성장·포텐·노쇠·나이바이어스 전부 non-trivial) — evolveSpan effects 경로 커버
  const EFFECTS: StaffEffects = {
    trainBoost: { 1: 1.4, 4: 1.3, 8: 1.25 } as Partial<Record<TrainingId, number>>,
    boostBias: { 1: 'young', 4: 'prime' } as Partial<Record<TrainingId, 'young' | 'prime'>>,
    potBonus: { skSpike: 3, jump: 2, focus: 1 } as Partial<Record<TrainableStat, number>>,
    ageSlow: 0.3,
  };

  // 시나리오: base 변형 + focus + effects + skip. skip 스트래들 확인 위해 skip=20.
  type Scenario = { label: string; base: Player; focus: FocusInput; effects: StaffEffects; skip: number; hasBoundary: boolean };
  const boundaryResolver = (d1cut: number): FocusInput => (day: number) => (day < d1cut ? DEFAULT_FOCUS : ALT_FOCUS);

  const scenariosFor = (p: Player): Scenario[] => [
    { label: 'S1 상수focus·무효과·skip0(FA센티넬)', base: p, focus: DEFAULT_FOCUS, effects: NO_EFFECTS, skip: 0, hasBoundary: false },
    { label: 'S2 어린선수(peak前·노쇠0)', base: { ...p, age: 19, peakAge: 27 }, focus: DEFAULT_FOCUS, effects: NO_EFFECTS, skip: 0, hasBoundary: false },
    { label: 'S3 노장(peak+6·노쇠4+회)', base: { ...p, age: 33, peakAge: 27 }, focus: DEFAULT_FOCUS, effects: NO_EFFECTS, skip: 0, hasBoundary: false },
    { label: 'S4 시즌중 방침경계(day40)', base: p, focus: boundaryResolver(40), effects: NO_EFFECTS, skip: 0, hasBoundary: true },
    { label: 'S5 스태프효과', base: { ...p, age: 30, peakAge: 27 }, focus: DEFAULT_FOCUS, effects: EFFECTS, skip: 0, hasBoundary: false },
    { label: 'S6 skip>0(출장정지 프런트로드)', base: p, focus: DEFAULT_FOCUS, effects: NO_EFFECTS, skip: 20, hasBoundary: false },
  ];

  // (d1<d2) 격자 — skip=20 스트래들(d1<20<d2) 및 경계(day40) 스트래들 포함
  const GRID = [5, 15, 30, 50, 80, 120];
  const pairs: [number, number][] = [];
  for (let i = 0; i < GRID.length; i++) for (let j = i + 1; j < GRID.length; j++) pairs.push([GRID[i], GRID[j]]);

  // 샘플 선수 — 로스터 전 선수(다양한 포지션·나이·외인). N 채우려 그대로 사용.
  const allIds: string[] = [];
  for (const t of LEAGUE.teams) for (const id of currentRosters()[t.id] ?? []) allIds.push(id);
  const samplePlayers: Player[] = allIds.map((id) => getPlayer(id)).filter((p: Player | undefined): p is Player => !!p);

  // ══════════════════════════════════════════════════════════════════
  // (1) 합성 오라클 — 분할 == 풀 == evolvePlayer (player + rngState)
  // ══════════════════════════════════════════════════════════════════
  console.log('═══ (1) 합성 오라클: evolveSpan∘evolveSpan == 풀 evolveSpan == evolvePlayer (player+xp+rngState) ═══');
  let N = 0, splitMism = 0, pubMism = 0, rngMism = 0;
  let teethReseed = 0, teethReseedSamples = 0, teethRel = 0, teethRelSamples = 0;
  const firstMism: string[] = [];
  for (const p of samplePlayers) {
    for (const sc of scenariosFor(p)) {
      const s0 = initialEvoRngState(sc.base.id);
      for (const [d1, d2] of pairs) {
        N++;
        // 풀(오라클 기준)
        const full = evolveSpan(sc.base, s0, sc.focus, sc.effects, sc.skip, 0, d2);
        // 분할 재개
        const r1 = evolveSpan(sc.base, s0, sc.focus, sc.effects, sc.skip, 0, d1);
        const split = evolveSpan(r1.player, r1.rngState, sc.focus, sc.effects, sc.skip, d1, d2);
        // 공개 래퍼(=evolvePlayer, skip은 skipTrainDays 인자)
        const pub = evolvePlayer(sc.base, sc.focus, d2, sc.effects, sc.skip);

        if (ser(split.player) !== ser(full.player)) { splitMism++; if (firstMism.length < 4) firstMism.push(`${sc.label} ${sc.base.id} ${d1}→${d2}(player)`); }
        if (split.rngState !== full.rngState) { rngMism++; if (firstMism.length < 4) firstMism.push(`${sc.label} ${sc.base.id} ${d1}→${d2}(rngState ${split.rngState}!=${full.rngState})`); }
        if (ser(full.player) !== ser(pub)) { pubMism++; if (firstMism.length < 4) firstMism.push(`${sc.label} ${sc.base.id} ${d1}→${d2}(pub)`); }

        // ── 이빨A: 순진 재시드(재개 시 rng를 초기상태로 리셋) → 깨져야 함 ──
        teethReseedSamples++;
        const bad1 = evolveSpan(r1.player, s0 /* ← 틀림: 이어달려야 하는데 재시드 */, sc.focus, sc.effects, sc.skip, d1, d2);
        if (ser(bad1.player) !== ser(full.player) || bad1.rngState !== full.rngState) teethReseed++;

        // ── 이빨B(R3): 상대일 focus(경계 시나리오에서만 유의미) → 깨져야 함 ──
        if (sc.hasBoundary) {
          teethRelSamples++;
          const relFocus: FocusInput = (day: number) => (sc.focus as (d: number) => TrainingFocus)(day - d1);
          const bad2 = evolveSpan(r1.player, r1.rngState, relFocus, sc.effects, sc.skip, d1, d2);
          if (ser(bad2.player) !== ser(full.player)) teethRel++;
        }
      }
    }
  }
  check(`(1a) 분할 재개 == 풀 (player, N=${N})`, splitMism === 0, splitMism ? `불일치 ${splitMism}: ${firstMism.join(' | ')}` : 'byte-동일');
  check(`(1b) 분할 재개 == 풀 (rngState, N=${N})`, rngMism === 0, rngMism ? `rng불일치 ${rngMism}` : 'byte-동일');
  check(`(1c) 풀 evolveSpan == evolvePlayer 공개래퍼 (N=${N})`, pubMism === 0, pubMism ? `불일치 ${pubMism}` : 'byte-동일');
  check(`(1d) N≥10,000`, N >= 10000, `N=${N}`);
  teeth('(1e) 순진 재시드 변이', teethReseed, teethReseedSamples);
  teeth('(1f) 상대일 focus 변이(R3, 경계 시나리오)', teethRel, teethRelSamples);

  // ══════════════════════════════════════════════════════════════════
  // (2) evolveOnDay 시퀀스 — 오름차순(재개)+내림차순(폴백)+반복(정확일치) 전부 base-콜드와 byte-동일
  // ══════════════════════════════════════════════════════════════════
  console.log('═══ (2) evolveOnDay 시퀀스 == base-콜드(evolvePlayer) byte-동일 ═══');
  const G = () => useGameStore.getState();
  const my = LEAGUE.teams[0].id;
  G().resetSave(); G().selectTeam(my);

  const cold = (id: string, day: number): string => {
    const b = getPlayer(id);
    if (!b) return 'nil';
    return ser(evolvePlayer(b, focusOf(b), Math.min(day, SEASON_DAYS), effectsOf(b)));
  };
  // 오름차순(재개 유발) → 내림차순 섞임(역행 폴백) → 재전진(체크포인트 넘어서) → 반복(정확일치) → 클램프(>SEASON_DAYS)
  const seq = [3, 8, 20, 45, 90, 140, 164, 140, 60, 130, 30, 164, 90, 200, 5];
  const seqIds = allIds; // 전 로스터 선수
  let seqN = 0, seqMism = 0; const seqDet: string[] = [];
  for (const id of seqIds) {
    for (const day of seq) {
      seqN++;
      const got = evolveOnDay(id, day);
      const want = cold(id, day);
      if ((got ? ser(got) : 'nil') !== want) { seqMism++; if (seqDet.length < 5) seqDet.push(`${id}@${day}`); }
    }
  }
  check(`(2a) evolveOnDay 시퀀스 == 콜드 (${seqIds.length}선수 × ${seq.length}질의 = ${seqN})`, seqMism === 0, seqMism ? `불일치 ${seqMism}: ${seqDet.join(',')}` : 'byte-동일');

  // (2b) NO_EVORESUME 폴백도 동일 결과(재개 무력화해도 콜드 정확) + A/B: 레버가 실제 경로를 가름
  process.env.NO_EVORESUME = '1';
  G().resetSave(); G().selectTeam(my);
  let seqN2 = 0, seqMism2 = 0;
  for (const id of seqIds) for (const day of seq) { seqN2++; const got = evolveOnDay(id, day); if ((got ? ser(got) : 'nil') !== cold(id, day)) seqMism2++; }
  delete process.env.NO_EVORESUME;
  check(`(2b) NO_EVORESUME(재개 무력화) 폴백도 == 콜드 (${seqN2})`, seqMism2 === 0, seqMism2 ? `불일치 ${seqMism2}` : 'byte-동일');

  console.log(`\n═══ 결과: ${pass} PASS · ${fail} FAIL | A/B 이빨: ${teethReseedSamples + teethRelSamples - abFail >= 0 ? '' : ''}무효 ${abFail} ═══`);
  const ok = fail === 0 && abFail === 0;
  console.log(ok ? '✅ §7.9 진화 점진 캐시 정확성 + 재개 오라클 이빨 통과' : '❌ 위반/무효 있음');
  process.exit(ok ? 0 : 1);
})();
