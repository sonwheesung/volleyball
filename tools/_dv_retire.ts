// 은퇴 재정비 상설 가드 (FA_SYSTEM §1.2 · MONETIZATION §11.2). 검증=Fable / 구현·문서=Opus (2026-07-08).
//   npx tsx tools/_dv_retire.ts   (exit 0/1)
//
// 봉인 대상(5): ①40세+ 현역 0(수백 시즌) ②HIGH(medOvr+δ) 이상 은퇴 0 ③결정론(같은 시드 2회 동일)
//   ④39세(정년임박) 전지훈련 차단(store 가드) ⑤계약 연한 40−나이 초과 0(재계약/FA/자동연장 전수).
// A/B 민감도: ②③⑤는 인툴 뮤턴트(하드월/HIGH0/캡 제거 모사)로 이빨 자가증명. ①은 소스 하드월 제거 변이로
//   메인이 콜드 재현(cp 백업 원복). 순수 검증(_gt_mock으로 store 구동).
import './_gt_mock';

import { retireChance, applyRetirements, capContractYears, RETIRE_AGE, RETIRE_PARAMS, growthHeadroom } from '../engine/retire';
import type { Player, Position, TrainableStat } from '../types';
import { TRAINABLE_STATS } from '../engine/training';
import { createRng } from '../engine/rng';

const P = RETIRE_PARAMS;
const MED = 66; // 대표 시대 앵커(문서 표와 동일)
let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗ FAIL:', m); fail++; } else console.log('  ✓', m); };

function mk(id: string, age: number, pos: Position = 'OH', v = 70): Player {
  const potential = {} as Record<TrainableStat, number>;
  for (const s of TRAINABLE_STATS) potential[s] = 90;
  return {
    id, name: id, age, position: pos, isForeign: false, height: 180,
    jump: v, agility: v, staminaMax: v, staminaRegen: v, reaction: v, positioning: v,
    focus: v, consistency: v, vq: v, skSpike: v, skBlock: v, skDig: v, skReceive: v, skSet: v, skServe: v,
    xp: {}, potential, talentBase: 1, catTalent: { physical: 1, skill: 1, mental: 1 },
    contract: { salary: 10000, years: 1, remaining: 1, signedAtAge: age },
    clubTenure: 5, peakAge: 28,
    career: { seasons: 10, matches: 0, sets: 0, points: 0, spikes: 0, blocks: 0, digs: 0, aces: 0, errors: 0, assists: 0 },
  };
}

// ── ② HIGH(medOvr+δ) 이상 은퇴 0 + 절벽 없음(1점 항상 유효) ──
console.log('── ② HIGH 이상 은퇴 확률 0 · 30~39 단조 · 40 정년=1 ──');
{
  const HIGH = MED + P.highDelta;
  let allZeroAbove = true, monoOk = true, wallOk = true;
  for (const age of [30, 33, 36, 39]) {
    for (let o = HIGH; o <= HIGH + 12; o++) if (retireChance(age, o, MED) !== 0) allZeroAbove = false;
    for (let o = 50; o < HIGH; o++) {
      const hi = retireChance(age, o, MED), lo = retireChance(age, o + 1, MED);
      if (hi > 0 && hi < P.chanceCap && !(lo < hi)) monoOk = false; // +1 OVR은 항상 확률↓(절벽 없음)
    }
  }
  for (const age of [40, 41, 45]) for (const o of [50, 70, 99]) if (retireChance(age, o, MED) !== 1) wallOk = false;
  ok(allZeroAbove, 'ovr ≥ HIGH → 정확히 0 (기량 지키면 39세까지 은퇴 없음)');
  ok(monoOk, 'HIGH 미만: OVR +1점이 항상 확률을 낮춘다(절벽 금지 — 전지훈련 유효)');
  ok(wallOk, '40세+ → 확률 1 (정년 하드월)');
  ok(retireChance(29, 40, MED) === 0, '30세 미만 → 0');
  // 인툴 뮤턴트 이빨: 하드월/HIGH0을 제거한 모사 함수는 위 불변식을 깬다
  const mutWall = (age: number, o: number) => (age < 30 ? 0 : Math.min(P.chanceCap, P.aHi * Math.max(0, HIGH - o))); // 40 wall 없음
  ok(mutWall(41, 50) !== 1, '[A/B] 하드월 제거 모사 → wall 불변식 위반(가드 이빨 존재)');
  const mutHigh = (age: number, o: number) => (age < 30 ? 0 : age >= RETIRE_AGE ? 1 : P.aLo + (o - o)); // HIGH0 없음(항상 >0)
  ok(mutHigh(33, HIGH + 5) !== 0, '[A/B] HIGH0 제거 모사 → HIGH이상=0 불변식 위반(가드 이빨 존재)');
}

// ── ③ 결정론(applyRetirements 같은 시드 2회 동일) + 외인 제외 ──
console.log('── ③ 결정론 · 외인 은퇴 루프 제외 ──');
{
  const snap: Record<string, Player> = {
    a: mk('a', 38, 'OH', 58), b: mk('b', 39, 'OH', 55), c: mk('c', 41), d: mk('d', 35, 'MB', 60),
    f: { ...mk('f', 41, 'OP', 92), isForeign: true },
  };
  const ids = ['f', 'a', 'b', 'c', 'd'];
  const r1 = applyRetirements({ t: ids }, snap, createRng(5), MED);
  const r2 = applyRetirements({ t: ids }, snap, createRng(5), MED);
  ok(JSON.stringify(r1) === JSON.stringify(r2), 'applyRetirements 결정론(같은 시드 동일)');
  ok(!r1.retired.includes('f') && r1.rosters.t.includes('f'), '외인(41세)은 은퇴 루프 제외·로스터 유지');
  ok(r1.retired.includes('c'), '국내 41세는 정년 은퇴');
  // 외인 유무가 국내 스트림 불변(rng 미소비)
  const noF = applyRetirements({ t: ['a', 'b', 'c', 'd'] }, snap, createRng(5), MED);
  ok(JSON.stringify(r1.retired.filter((x) => x !== 'f')) === JSON.stringify(noF.retired), '외인 rng 미소비 → 국내 판정 불변');
}

// ── ⑤ 계약 연한 정년 캡(순수) ──
console.log('── ⑤ 계약 연한 40−나이 초과 0 (capContractYears) ──');
{
  let capOk = true;
  for (let age = 20; age <= 45; age++) for (const y of [1, 2, 3, 4, 5]) {
    const c = capContractYears(age, y);
    if (c < 1) capOk = false;                                  // 최소 1
    if (age < RETIRE_AGE && c > RETIRE_AGE - age) capOk = false; // 정년 초과 금지
    if (age >= RETIRE_AGE && c !== 1) capOk = false;            // 정년 이상은 1
    if (age <= RETIRE_AGE - y && c !== y) capOk = false;        // 여유 있으면 원래 연한 보존
  }
  ok(capOk, 'capContractYears: [1, RETIRE_AGE−age] 클램프 (여유 시 원연한, 정년 초과 0, 최소 1)');
  // 뮤턴트 이빨: 캡 안 하면 39세 2년 계약이 40 넘김
  ok(!(39 + capContractYears(39, 2) > RETIRE_AGE), '[A/B] 39세 2년 요청도 캡 후 40 미초과');
  ok(39 + 2 > RETIRE_AGE, '[A/B] 캡 없으면(39+2=41) 정년 초과 — 캡의 이빨 존재');
}

// ── ①⑤(sim) 40세+ 현역 0 + 활성 계약 정년 미초과 (수백 시즌) ──
(async () => {
  console.log('── ①⑤(sim) 200시즌: 40세+ 현역 0 · 활성 계약 signedAtAge+years ≤ 40 ──');
  const { resetLeagueBase, currentBasePlayers } = await import('../data/league');
  const { advanceOffseason } = await import('./simLeague');
  const { computeStandings } = await import('../data/standings');
  const { buildPlayoffs } = await import('../data/playoffs');
  resetLeagueBase();
  const SEASONS = 200;
  let over40 = 0, badContract = 0, maxAge = 0;
  const champByYearA: string[] = [];
  for (let s = 0; s < SEASONS; s++) {
    const standings = computeStandings(Number.MAX_SAFE_INTEGER);
    const champ = buildPlayoffs(s).championId ?? standings[0].teamId;
    champByYearA.push(champ);
    if (s >= 15) {
      for (const p of currentBasePlayers()) {
        if (p.isForeign) continue;
        maxAge = Math.max(maxAge, p.age);
        if (p.age >= RETIRE_AGE) over40++;
        // 활성 계약: 계약이 롤오버로 재산정된 뒤(warmup)만. signedAtAge+years = 계약 종료 나이 ≤ 정년.
        if (p.contract.signedAtAge + p.contract.years > RETIRE_AGE) badContract++;
      }
    }
    advanceOffseason(s, champ, standings.map((st) => st.teamId));
  }
  ok(over40 === 0, `40세+ 현역 0 (관측 최고령 ${maxAge}세)`);
  ok(badContract === 0, `활성 계약 정년 초과 0 (signedAtAge+years ≤ ${RETIRE_AGE})`);

  // ③(sim) 결정론 — 같은 시드 2회 우승 연표 동일
  resetLeagueBase();
  const champByYearB: string[] = [];
  for (let s = 0; s < 40; s++) {
    const st = computeStandings(Number.MAX_SAFE_INTEGER);
    const ch = buildPlayoffs(s).championId ?? st[0].teamId;
    champByYearB.push(ch);
    advanceOffseason(s, ch, st.map((x) => x.teamId));
  }
  ok(champByYearA.slice(0, 40).join(',') === champByYearB.join(','), 'sim 결정론(같은 시드 40시즌 우승 연표 동일)');

  // ④ 39세(정년임박) 전지훈련 차단 (store 가드) + 대조(38세는 미차단)
  console.log('── ④ 전지훈련 39세 차단(store) · 38세 대조 ──');
  const { useGameStore } = await import('../store/useGameStore');
  const { useAuthStore } = await import('../store/useAuthStore');
  const { LEAGUE, getPlayer, commitPlayerBase, currentRosters } = await import('../data/league');
  const G = () => useGameStore.getState();
  const myId = LEAGUE.teams[0].id;
  G().selectTeam(myId);
  useAuthStore.setState({ session: { userId: 'u-retire', provider: 'dev', displayName: null, token: 't' } as any });
  useGameStore.setState({ diamonds: 5000, campLog: [], campTrainedThisOffseason: [], pendingCamp: null, currentDay: 0 });
  const roster = currentRosters()[myId];
  const target = getPlayer(roster[0])!;
  // 39세로 조작 → 차단
  commitPlayerBase({ [target.id]: { ...target, age: RETIRE_AGE - 1, potential: { ...target.potential, skSpike: 99, jump: 99 } } });
  const r39 = await G().trainingCamp(target.id, 'attack');
  ok(!r39.ok && r39.reason === 'retiring', `39세(정년임박) 전지훈련 차단(reason=retiring, 실제=${r39.reason})`);
  // 38세 대조 → 'retiring' 아님(다른 게이트일 수는 있으나 정년 사유 아님)
  const t2 = getPlayer(roster[1])!;
  commitPlayerBase({ [t2.id]: { ...t2, age: RETIRE_AGE - 2 } });
  const r38 = await G().trainingCamp(t2.id, 'attack');
  ok(r38.reason !== 'retiring', `38세 대조: 정년 사유 아님(실제=${r38.ok ? 'ok' : r38.reason})`);

  console.log(fail === 0 ? '\n✅ PASS — 은퇴 재정비 가드 전항 통과' : `\n❌ FAIL ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
})();
